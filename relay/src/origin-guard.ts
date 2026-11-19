/**
 * Who may talk to the relay.
 *
 * The relay drives the user's logged-in browser, and a web page can reach
 * 127.0.0.1 like any other host. Three checks keep pages out:
 *
 *  - Origin: browsers attach `Origin` to every WebSocket handshake and to every
 *    cross-origin POST. No Origin means a non-browser client (the CLI, Node), which
 *    is allowed; otherwise the Origin must be a Browser Hand extension.
 *  - Host: a page that rebinds its DNS name to 127.0.0.1 is same-origin with the
 *    relay and sends no Origin on GETs, but its Host header is still its own name.
 *  - Bind: the relay listens on loopback only unless the operator opts out.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isIPv4, isIPv6 } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MiddlewareHandler } from "hono";

/** Comma- or space-separated origins that replace the built-in allow-list. */
export const ALLOWED_ORIGINS_ENV = "BROWSER_HAND_ALLOWED_ORIGINS";
/** `1` lets the relay bind a non-loopback address. */
export const ALLOW_REMOTE_BIND_ENV = "BROWSER_HAND_ALLOW_REMOTE_BIND";

/**
 * Chrome Web Store extension IDs. None is published yet; add the ID here when
 * one is, so store installs work without BROWSER_HAND_ALLOWED_ORIGINS.
 */
export const WEB_STORE_EXTENSION_IDS: readonly string[] = [];

/**
 * Safari gives each installed extension a random per-install UUID origin, so there
 * is nothing stable to pin. Web pages cannot have this scheme; only installed
 * Safari extensions can. Set BROWSER_HAND_ALLOWED_ORIGINS to pin one UUID.
 */
export const SAFARI_ORIGIN_RULE = "safari-web-extension://*";

/** Where `Load unpacked` points in this checkout, resolved from the relay's own location. */
export function defaultChromeExtensionDir(): string {
  // relay/src/ (tsx) and relay/dist/ (built) sit at the same depth.
  return fileURLToPath(new URL("../../extension/dist/chrome-mv3", import.meta.url));
}

/**
 * The ID Chromium assigns an unpacked extension: SHA-256 of its directory path
 * (realpath, else the absolute path), first 16 bytes, hex digits remapped 0-f -> a-p.
 * This is the POSIX scheme (UTF-8 path bytes). Windows hashes UTF-16, so set
 * BROWSER_HAND_ALLOWED_ORIGINS there.
 */
export function chromeExtensionIdForPath(dir: string): string {
  let normalized: string;
  try {
    normalized = realpathSync(dir);
  } catch {
    normalized = path.resolve(dir);
  }
  return generateChromeExtensionId(normalized);
}

/** Chromium's `GenerateId`: SHA-256 of `seed`, first 16 bytes as hex, digits 0-f remapped to a-p. */
export function generateChromeExtensionId(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
}

/** `scheme://host[:port]`, or `scheme://*` for any host of a non-web scheme. */
const ORIGIN_RULE = /^([a-z][a-z0-9+.-]*):\/\/(\*|[^\s/?#@*]+)$/;

function normalizeOriginRule(entry: string): string {
  const rule = entry.trim().replace(/\/+$/, "").toLowerCase();
  const match = ORIGIN_RULE.exec(rule);
  if (!match || (match[2] === "*" && (match[1] === "http" || match[1] === "https"))) {
    throw new Error(
      `${ALLOWED_ORIGINS_ENV}: "${entry}" is not an origin. Use scheme://host, e.g. chrome-extension://<id>`
    );
  }
  return rule;
}

/**
 * The origins allowed to reach the relay. `BROWSER_HAND_ALLOWED_ORIGINS`, when set,
 * replaces the defaults; otherwise: this checkout's unpacked Chrome extension, any
 * Web Store build, and Safari.
 */
export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
  extensionDir: string = defaultChromeExtensionDir()
): string[] {
  const override = (env[ALLOWED_ORIGINS_ENV] ?? "").split(/[\s,]+/).filter(Boolean);
  if (override.length > 0) return [...new Set(override.map(normalizeOriginRule))];
  return [
    ...[chromeExtensionIdForPath(extensionDir), ...WEB_STORE_EXTENSION_IDS].map(
      (id) => `chrome-extension://${id}`
    ),
    SAFARI_ORIGIN_RULE,
  ];
}

/** Exact match, or `scheme://*` for any non-empty host of that scheme. */
export function isAllowedOrigin(origin: string, rules: readonly string[]): boolean {
  const candidate = origin.trim().toLowerCase();
  return rules.some((rule) => {
    if (rule === candidate) return true;
    if (!rule.endsWith("://*")) return false;
    const prefix = rule.slice(0, -1);
    return candidate.startsWith(prefix) && /^[^\s/]+$/.test(candidate.slice(prefix.length));
  });
}

/** `host` as it appears in a URL authority (IPv6 literals need brackets). */
function authorityHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** Host header values the relay answers to. */
export function allowedHosts(port: number, bindHost: string): Set<string> {
  return new Set(
    ["127.0.0.1", "localhost", "[::1]", authorityHost(bindHost)].map((h) =>
      `${h}:${port}`.toLowerCase()
    )
  );
}

/** A literal IPv4 address in 127.0.0.0/8, or the literal IPv6 ::1. Names never qualify. */
export function isLoopbackLiteral(host: string): boolean {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIPv4(bare)) return bare.startsWith("127.");
  if (!isIPv6(bare)) return false;
  try {
    return new URL(`http://[${bare}]`).hostname === "[::1]";
  } catch {
    return false;
  }
}

/** Throws unless `host` is loopback or the operator set BROWSER_HAND_ALLOW_REMOTE_BIND=1. */
export function assertSafeBind(host: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isLoopbackLiteral(host) || env[ALLOW_REMOTE_BIND_ENV] === "1") return;
  throw new Error(
    `Refusing to bind the relay to "${host}": it drives your logged-in browser, so it only ` +
      `listens on a literal loopback address (127.0.0.0/8 or ::1). ` +
      `Set ${ALLOW_REMOTE_BIND_ENV}=1 to accept the risk.`
  );
}

export interface OriginGuardOptions {
  port: number;
  bindHost: string;
  allowedOrigins: readonly string[];
  /** Called once per distinct rejected Origin/Host (bounded), so a misconfigured extension is diagnosable. */
  onReject?: (message: string) => void;
}

const MAX_REPORTED_REJECTIONS = 20;

export function createOriginGuard(options: OriginGuardOptions): MiddlewareHandler {
  const hosts = allowedHosts(options.port, options.bindHost);
  const reported = new Set<string>();
  const reject = (kind: "Host" | "Origin", value: string | undefined) => {
    // Header values are attacker-controlled: quote and cap them before logging.
    const shown = JSON.stringify((value ?? "").slice(0, 120));
    const key = `${kind}:${shown}`;
    if (options.onReject && !reported.has(key) && reported.size < MAX_REPORTED_REJECTIONS) {
      reported.add(key);
      options.onReject(
        kind === "Origin"
          ? `Rejected request from Origin ${shown}. If this is your Browser Hand extension, set ${ALLOWED_ORIGINS_ENV}.`
          : `Rejected request with Host ${shown} (expected one of ${[...hosts].join(", ")}).`
      );
    }
  };

  return async (c, next) => {
    const host = c.req.header("host");
    if (host === undefined || !hosts.has(host.toLowerCase())) {
      reject("Host", host);
      return c.json({ error: "Forbidden" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && !isAllowedOrigin(origin, options.allowedOrigins)) {
      reject("Origin", origin);
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
  };
}
