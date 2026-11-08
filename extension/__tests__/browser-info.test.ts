import { describe, it, expect } from "vitest";
import { pickBrand, parseUserAgent, detectHostBrowser } from "../utils/browser-info";

describe("pickBrand", () => {
  it("prefers the product brand over Chromium and the GREASE placeholder", () => {
    const brands = [
      { brand: "Not=A?Brand", version: "99" },
      { brand: "Chromium", version: "140" },
      { brand: "Search", version: "140.1.2.3" },
    ];
    expect(pickBrand(brands)).toEqual({ brand: "Search", version: "140.1.2.3" });
  });

  it("falls back to Chromium when no product brand is present", () => {
    const brands = [
      { brand: "Not/A)Brand", version: "8" },
      { brand: "Chromium", version: "140" },
    ];
    expect(pickBrand(brands)).toEqual({ brand: "Chromium", version: "140" });
  });

  it("returns null for empty input", () => {
    expect(pickBrand([])).toBeNull();
    expect(pickBrand(undefined)).toBeNull();
  });
});

describe("parseUserAgent", () => {
  it("recognizes Edge before generic Chrome", () => {
    const ua =
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.1";
    expect(parseUserAgent(ua)).toEqual({ name: "Microsoft Edge", version: "140.0.1" });
  });

  it("falls back to Google Chrome", () => {
    const ua = "Mozilla/5.0 AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({ name: "Google Chrome", version: "141.0.0.0" });
  });

  it("returns Unknown for an unrecognized UA", () => {
    expect(parseUserAgent("Lynx/2.9")).toEqual({ name: "Unknown", version: "" });
  });
});

describe("detectHostBrowser", () => {
  it("reads the product brand from userAgentData high-entropy values", async () => {
    const nav = {
      userAgentData: {
        brands: [{ brand: "Chromium", version: "140" }],
        getHighEntropyValues: async () => ({
          fullVersionList: [
            { brand: "Chromium", version: "140.0.7000.1" },
            { brand: "Search", version: "140.0.7000.1" },
          ],
        }),
      },
    };
    expect(await detectHostBrowser(nav)).toEqual({ name: "Search", version: "140.0.7000.1" });
  });

  it("falls back to the UA string when userAgentData is absent", async () => {
    const nav = { userAgent: "Mozilla/5.0 Chrome/139.0.0.0 Safari/537.36" };
    expect(await detectHostBrowser(nav)).toEqual({ name: "Google Chrome", version: "139.0.0.0" });
  });

  it("keeps the low-entropy brands when getHighEntropyValues throws", async () => {
    const nav = {
      userAgentData: {
        brands: [
          { brand: "Not.A/Brand", version: "24" },
          { brand: "Brave", version: "131" },
        ],
        getHighEntropyValues: async () => {
          throw new Error("rejected");
        },
      },
      userAgent: "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36",
    };
    expect(await detectHostBrowser(nav)).toEqual({ name: "Brave", version: "131" });
  });
});
