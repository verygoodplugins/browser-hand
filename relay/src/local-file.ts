/**
 * Serve local documents through the relay without exposing the filesystem.
 * `file:` URLs fail in chrome.tabs.create, so the CLI registers a document and
 * opens the returned http URL. Registration mints an unguessable token; the relay
 * serves `/local/<token>/<relative path>` from that document's directory and
 * nothing else, resolving every read with realpath. No served route accepts a
 * filesystem path from a request.
 */

import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

const LOCAL_FILE_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

/** Content-Type for a local file served through the relay. */
export function contentTypeForPath(filePath: string): string {
  return LOCAL_FILE_CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

/** URL prefix on the document origin: `/local/<token>/<relative path>`. */
export const LOCAL_DOC_ROUTE_PREFIX = "/local/";

/** 24 random bytes = 192 bits of entropy, base64url-encoded to 32 characters. */
const TOKEN_BYTES = 24;
export const LOCAL_DOC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Idle lifetime of a capability. Each successful read slides it forward. */
export const DEFAULT_LOCAL_DOC_TTL_MS = 2 * 60 * 60 * 1000;
/** Upper bound on live capabilities; the least recently used is evicted first. */
export const DEFAULT_LOCAL_DOC_MAX_ENTRIES = 64;

/**
 * Headers for every document-origin response: CSP `connect-src 'self'` confines
 * scripts to their own origin, no-referrer keeps the token out of Referer, and
 * there are deliberately no CORS headers.
 */
export const LOCAL_DOC_SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'self' data: blob: https: 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

/** Registration failed; `status` is the HTTP status the control route should return. */
export class LocalDocError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LocalDocError";
    this.status = status;
  }
}

export interface LocalDocRegistryOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface RegisteredLocalDoc {
  token: string;
  /** Basename of the registered document; the last segment of its URL. */
  name: string;
  expiresAt: number;
}

export interface LocalDocResult {
  status: 200 | 404;
  contentType?: string;
  /** Plain ArrayBuffer so it drops straight into a web Response body. */
  body?: ArrayBuffer;
}

const NOT_FOUND: LocalDocResult = { status: 404 };

interface Entry extends RegisteredLocalDoc {
  /** Realpath of the document's directory: the capability's whole reach. */
  root: string;
  lastUsed: number;
}

/** True when `target` is a strict descendant of `root` (both realpaths). */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Decode a request path per segment; null if it tries anything but walking down (`..`, `%2f`, `%5c`, NUL). */
function toSegments(requestPath: string): string[] | null {
  const segments: string[] = [];
  for (const raw of requestPath.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "" || segment === ".") continue;
    if (segment === ".." || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

export class LocalDocRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: LocalDocRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_LOCAL_DOC_TTL_MS;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_LOCAL_DOC_MAX_ENTRIES);
    this.now = options.now ?? Date.now;
  }

  /**
   * Authorize one document (and the files beneath its directory) and mint its
   * capability token.
   */
  async register(filePath: unknown): Promise<RegisteredLocalDoc> {
    if (typeof filePath !== "string" || !filePath || filePath.includes("\0")) {
      throw new LocalDocError(400, "path must be a non-empty string");
    }
    if (!isAbsolute(filePath)) {
      throw new LocalDocError(400, "path must be absolute");
    }
    const name = basename(filePath);
    let root: string;
    let real: string;
    try {
      root = await realpath(dirname(filePath));
      real = await realpath(filePath);
    } catch {
      throw new LocalDocError(404, "Document not found");
    }
    if (!(await stat(real)).isFile()) {
      throw new LocalDocError(400, "path is not a regular file");
    }
    // A document symlinked to somewhere outside its own directory would hand
    // out a capability over that other directory. Refuse instead.
    if (!isInside(root, real)) {
      throw new LocalDocError(400, "document resolves outside its directory");
    }

    const now = this.now();
    this.pruneExpired();
    while (this.entries.size >= this.maxEntries) {
      let oldest: Entry | undefined;
      for (const entry of this.entries.values()) {
        if (!oldest || entry.lastUsed < oldest.lastUsed) oldest = entry;
      }
      if (!oldest) break;
      this.entries.delete(oldest.token);
    }
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const entry: Entry = { token, name, root, expiresAt: now + this.ttlMs, lastUsed: now };
    this.entries.set(token, entry);
    return { token, name, expiresAt: entry.expiresAt };
  }

  /** Read `requestPath` (encoded remainder of `/local/<token>/…`). Every failure is the same bare 404. */
  async read(token: string, requestPath: string): Promise<LocalDocResult> {
    const entry = this.lookup(token);
    if (!entry) return NOT_FOUND;
    const segments = toSegments(requestPath);
    if (!segments) return NOT_FOUND;
    // Dotfiles (.env, .git, .ssh, …) are the usual exfiltration targets next to
    // a document. Only the registered document itself may be dot-named.
    if (segments.some((s, i) => s.startsWith(".") && !(i === 0 && s === entry.name))) {
      return NOT_FOUND;
    }
    const target = join(entry.root, ...(segments.length ? segments : [entry.name]));
    try {
      const real = await realpath(target);
      if (!isInside(entry.root, real) || !(await stat(real)).isFile()) return NOT_FOUND;
      const data = await readFile(real);
      const now = this.now();
      entry.lastUsed = now;
      entry.expiresAt = now + this.ttlMs;
      const body = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      ) as ArrayBuffer;
      return { status: 200, contentType: contentTypeForPath(real), body };
    } catch {
      return NOT_FOUND;
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private lookup(token: string): Entry | undefined {
    if (!LOCAL_DOC_TOKEN_PATTERN.test(token)) return undefined;
    const entry = this.entries.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return undefined;
    }
    return entry;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}
