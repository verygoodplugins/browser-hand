/**
 * Pure helpers for `npm run clerk:brand`.
 *
 * Instance allowed origins go through `@clerk/backend` (`instance.update`,
 * which wraps `PATCH /v1/instance`). Application name and logo go through
 * Clerk's Platform API (`PATCH /platform/applications/{id}` and
 * `POST /platform/applications/{id}/logo`). The Platform API is a separate
 * credential from the instance secret and may need to be enabled on the account.
 */

export const CLERK_API_BASE = "https://api.clerk.com/v1";
export const BROWSER_HAND_APPLICATION_NAME = "Browser Hand";

export interface ClerkInstanceSnapshot {
  allowedOrigins: string[] | null;
}

export interface ClerkInstanceClient {
  get(): Promise<ClerkInstanceSnapshot>;
  update(params: { allowedOrigins: string[] }): Promise<void>;
}

const CHROME_EXTENSION_ID = /^[a-p]{32}$/;

export function chromeExtensionOrigin(extensionId: string): string {
  const id = extensionId
    .trim()
    .replace(/^chrome-extension:\/\//i, "")
    .replace(/\/$/, "");
  if (!CHROME_EXTENSION_ID.test(id)) {
    throw new Error(
      `CLERK_EXTENSION_ID must be the 32-character id from chrome://extensions (letters a-p). Received "${extensionId}".`
    );
  }
  return `chrome-extension://${id}`;
}

export function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Allowed origin is empty.");
  }
  if (trimmed.toLowerCase().startsWith("chrome-extension://")) {
    return chromeExtensionOrigin(trimmed);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not an origin: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Origin must be http(s) or chrome-extension: ${value}`);
  }
  return url.origin;
}

/** Keep existing origins and append any that are missing. Clerk replaces the whole list on update. */
export function mergeAllowedOrigins(
  existing: readonly string[] | null | undefined,
  required: readonly string[]
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const origin of [...(existing ?? []), ...required]) {
    const trimmed = origin.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
  }
  return merged;
}

export function parseOriginList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => normalizeOrigin(part));
}

export async function syncAllowedOrigins(
  client: ClerkInstanceClient,
  originsToAdd: readonly string[]
): Promise<string[]> {
  const current = await client.get();
  const merged = mergeAllowedOrigins(current.allowedOrigins, originsToAdd);
  await client.update({ allowedOrigins: merged });
  return merged;
}

export interface PlatformRequest {
  url: string;
  init: RequestInit;
}

export function applicationNameRequest(
  applicationId: string,
  token: string,
  name: string = BROWSER_HAND_APPLICATION_NAME,
  baseUrl: string = CLERK_API_BASE
): PlatformRequest {
  return {
    url: `${baseUrl}/platform/applications/${encodeURIComponent(applicationId)}`,
    init: {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    },
  };
}

export function logoFormData(bytes: Uint8Array, filename: string): FormData {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const form = new FormData();
  form.set("file", new Blob([copy], { type: "image/png" }), filename);
  return form;
}

export function applicationLogoRequest(
  applicationId: string,
  token: string,
  bytes: Uint8Array,
  filename: string,
  baseUrl: string = CLERK_API_BASE
): PlatformRequest {
  return {
    url: `${baseUrl}/platform/applications/${encodeURIComponent(applicationId)}/logo`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: logoFormData(bytes, filename),
    },
  };
}

export function applicationFaviconRequest(
  applicationId: string,
  token: string,
  bytes: Uint8Array,
  filename: string,
  baseUrl: string = CLERK_API_BASE
): PlatformRequest {
  return {
    url: `${baseUrl}/platform/applications/${encodeURIComponent(applicationId)}/favicon`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: logoFormData(bytes, filename),
    },
  };
}

export class ClerkPlatformError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClerkPlatformError";
    this.status = status;
  }
}

export async function sendPlatformRequest(
  request: PlatformRequest,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl(request.url, request.init);
  if (response.ok) return;
  const detail = (await response.text()).trim().slice(0, 500);
  throw new ClerkPlatformError(
    detail
      ? `Clerk Platform API ${request.init.method} ${request.url} failed (${response.status}): ${detail}`
      : `Clerk Platform API ${request.init.method} ${request.url} failed (${response.status}).`,
    response.status
  );
}
