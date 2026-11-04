/**
 * Detect the host browser (name + version) the extension is running in.
 *
 * Browser Hand targets whichever Chromium browser currently has the extension
 * connected — not Chrome by assumption. `navigator.userAgentData` exposes the
 * product brand ("Google Chrome", "Microsoft Edge", "Brave", "Search", ...)
 * separately from the shared "Chromium" engine brand, so agents can report the
 * real host browser and never fall back to `open -a "Google Chrome"`.
 */

export interface HostBrowser {
  name: string;
  version: string;
}

interface UaBrand {
  brand: string;
  version: string;
}

interface UaDataLike {
  brands?: UaBrand[];
  getHighEntropyValues?: (hints: string[]) => Promise<{ fullVersionList?: UaBrand[] }>;
}

interface NavigatorLike {
  userAgentData?: UaDataLike;
  userAgent?: string;
}

/**
 * Engine / GREASE placeholder brands that are never the product name. The
 * "Not A;Brand" GREASE entry uses arbitrary punctuation between the words
 * (e.g. "Not=A?Brand", "Not/A)Brand"), so match the words, not the separators.
 */
function isGenericBrand(brand: string): boolean {
  const b = brand.trim();
  return /^(chromium|google chrome crashpad)$/i.test(b) || /not\W*a\W*brand/i.test(b);
}

/**
 * Pick the product brand (Search, Microsoft Edge, Brave, ...) in preference to
 * the shared "Chromium" engine brand and the "Not A;Brand" GREASE placeholder.
 */
export function pickBrand(brands: UaBrand[] | undefined): UaBrand | null {
  if (!Array.isArray(brands) || brands.length === 0) return null;
  const product = brands.find((b) => b?.brand && !isGenericBrand(b.brand));
  if (product) return product;
  const chromium = brands.find((b) => /^chromium$/i.test((b?.brand || "").trim()));
  return chromium ?? brands[0];
}

/** Last-resort parse of the UA string when userAgentData is unavailable. */
export function parseUserAgent(ua: string | undefined): HostBrowser {
  const text = ua || "";
  // Order matters: more specific forks before generic Chrome.
  const patterns: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, "Microsoft Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Brave\/([\d.]+)/, "Brave"],
    [/Chrome\/([\d.]+)/, "Google Chrome"],
  ];
  for (const [re, name] of patterns) {
    const m = text.match(re);
    if (m) return { name, version: m[1] };
  }
  return { name: "Unknown", version: "" };
}

export async function detectHostBrowser(
  nav: NavigatorLike = typeof navigator !== "undefined" ? navigator : {}
): Promise<HostBrowser> {
  const uaData = nav?.userAgentData;
  if (uaData) {
    let brands = uaData.brands;
    if (uaData.getHighEntropyValues) {
      try {
        const high = await uaData.getHighEntropyValues(["fullVersionList"]);
        if (Array.isArray(high?.fullVersionList) && high.fullVersionList.length > 0) {
          brands = high.fullVersionList;
        }
      } catch {
        // Keep the low-entropy brands when the high-entropy query is refused.
      }
    }
    const picked = pickBrand(brands);
    if (picked?.brand) {
      return { name: picked.brand.trim(), version: (picked.version || "").trim() };
    }
  }
  return parseUserAgent(nav?.userAgent);
}
