/**
 * Serve a local file through the relay.
 *
 * `file:` URLs fail in chrome.tabs.create ("Cannot navigate to a file: URL"),
 * so the CLI rewrites them to the relay's /local-file route and this reads the
 * file back over http. Localhost-only — same trust boundary as the relay itself.
 */

import { readFile, stat } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";

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

export interface LocalFileResult {
  status: number;
  contentType?: string;
  /** Plain ArrayBuffer so it drops straight into a web Response body. */
  body?: ArrayBuffer;
  error?: string;
}

/** Read a local file for serving. Returns a status + body or an error payload. */
export async function readLocalFile(requested: string | undefined): Promise<LocalFileResult> {
  if (!requested) {
    return { status: 400, error: "path query parameter is required" };
  }
  const abs = resolvePath(requested);
  try {
    const info = await stat(abs);
    if (!info.isFile()) {
      return { status: 404, error: `Not a regular file: ${abs}` };
    }
    const data = await readFile(abs);
    const body = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer;
    return { status: 200, contentType: contentTypeForPath(abs), body };
  } catch {
    return { status: 404, error: `Cannot read file: ${abs}` };
  }
}
