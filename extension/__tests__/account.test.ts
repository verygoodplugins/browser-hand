import { describe, expect, it, vi } from "vitest";
import { BROWSER_HAND_COLORS, browserHandAppearance } from "../account/brand";
import {
  BROWSER_HAND_APPLICATION_NAME,
  ClerkPlatformError,
  applicationLogoRequest,
  applicationNameRequest,
  chromeExtensionOrigin,
  logoFormData,
  mergeAllowedOrigins,
  parseOriginList,
  sendPlatformRequest,
  syncAllowedOrigins,
} from "../account/clerk-setup";
import { isConfiguredPublishableKey, readClerkConfig } from "../account/config";
import { isAccountSnapshot, signedOutSnapshot, snapshotFromUser } from "../account/session";

describe("Clerk config", () => {
  it("reads only public WXT variables and treats blanks as unset", () => {
    const config = readClerkConfig({
      WXT_CLERK_PUBLISHABLE_KEY: "  pk_test_abc  ",
      WXT_CLERK_SYNC_HOST: "   ",
      WXT_CLERK_FRONTEND_API: "https://example.clerk.accounts.dev",
      WXT_ORDER_HISTORY_URL: "",
    });
    expect(config).toEqual({
      publishableKey: "pk_test_abc",
      syncHost: undefined,
      frontendApi: "https://example.clerk.accounts.dev",
      orderHistoryUrl: undefined,
    });
    expect(config).not.toHaveProperty("secretKey");
  });

  it("treats the example placeholder key as unconfigured", () => {
    expect(isConfiguredPublishableKey(undefined)).toBe(false);
    expect(isConfiguredPublishableKey("pk_test_replace_me")).toBe(false);
    expect(isConfiguredPublishableKey("not-a-key")).toBe(false);
    expect(isConfiguredPublishableKey("pk_live_real_key")).toBe(true);
  });
});

describe("account snapshot", () => {
  it("mirrors display fields and omits tokens", () => {
    const snapshot = snapshotFromUser(
      {
        id: "user_1",
        fullName: "Ada Lovelace",
        imageUrl: "https://img.example/a.png",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
      },
      new Date("2026-11-08T00:00:00.000Z")
    );
    expect(snapshot).toEqual({
      signedIn: true,
      userId: "user_1",
      email: "ada@example.com",
      name: "Ada Lovelace",
      imageUrl: "https://img.example/a.png",
      updatedAt: "2026-11-08T00:00:00.000Z",
    });
    expect(isAccountSnapshot(snapshot)).toBe(true);
    expect(isAccountSnapshot(signedOutSnapshot())).toBe(true);
    expect(isAccountSnapshot({ signedIn: true })).toBe(false);
  });
});

describe("Browser Hand Clerk appearance", () => {
  it("uses the cyan spark and the glove mark", () => {
    const appearance = browserHandAppearance(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/icons/icon-128.png"
    );
    expect(appearance.variables?.colorPrimary).toBe(BROWSER_HAND_COLORS.cyan);
    expect(appearance.variables?.colorPrimaryForeground).toBe(BROWSER_HAND_COLORS.ink);
    expect(appearance.variables?.colorForeground).toBe(BROWSER_HAND_COLORS.ink);
    expect(appearance.options?.logoImageUrl).toContain("icon-128.png");
    expect(appearance.options?.logoPlacement).toBe("inside");
  });
});

describe("Clerk instance origins", () => {
  it("builds a chrome-extension origin and rejects anything else", () => {
    expect(chromeExtensionOrigin("abcdefghijklmnopabcdefghijklmnop")).toBe(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    );
    expect(chromeExtensionOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop/")).toBe(
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
    );
    expect(() => chromeExtensionOrigin("not-an-id")).toThrow(/CLERK_EXTENSION_ID/);
  });

  it("merges new origins without dropping existing ones", () => {
    expect(
      mergeAllowedOrigins(
        ["https://app.example.com", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        ["chrome-extension://abcdefghijklmnopabcdefghijklmnop", "https://app.example.com"]
      )
    ).toEqual([
      "https://app.example.com",
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    ]);
  });

  it("updates the instance with the merged list", async () => {
    const update = vi.fn(async () => undefined);
    const merged = await syncAllowedOrigins(
      {
        get: async () => ({ allowedOrigins: ["https://kept.example"] }),
        update,
      },
      ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"]
    );
    expect(merged).toEqual([
      "https://kept.example",
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    ]);
    expect(update).toHaveBeenCalledWith({ allowedOrigins: merged });
  });

  it("parses extra origins", () => {
    expect(
      parseOriginList(" https://a.example , chrome-extension://abcdefghijklmnopabcdefghijklmnop ")
    ).toEqual(["https://a.example", "chrome-extension://abcdefghijklmnopabcdefghijklmnop"]);
  });
});

describe("Clerk platform branding", () => {
  it("renames the application to Browser Hand", () => {
    const request = applicationNameRequest("app_123", "platform-token");
    expect(request.url).toBe("https://api.clerk.com/v1/platform/applications/app_123");
    expect(request.init.method).toBe("PATCH");
    expect(request.init.body).toBe(JSON.stringify({ name: BROWSER_HAND_APPLICATION_NAME }));
    expect(new Headers(request.init.headers).get("Authorization")).toBe("Bearer platform-token");
  });

  it("uploads the logo as a file part", () => {
    const form = logoFormData(new Uint8Array([1, 2, 3]), "mark.png");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe("mark.png");
    const request = applicationLogoRequest(
      "app_123",
      "platform-token",
      new Uint8Array([1]),
      "mark.png"
    );
    expect(request.url).toContain("/platform/applications/app_123/logo");
    expect(request.init.method).toBe("POST");
    expect(request.init.body).toBeInstanceOf(FormData);
  });

  it("surfaces platform error status without calling a fallback", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    await expect(
      sendPlatformRequest(
        applicationNameRequest("app_123", "token", "Browser Hand", "https://api.example"),
        fetchImpl
      )
    ).rejects.toMatchObject({ status: 403, name: "ClerkPlatformError" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(Promise.reject(new ClerkPlatformError("no", 401))).rejects.toBeInstanceOf(
      ClerkPlatformError
    );
  });
});
