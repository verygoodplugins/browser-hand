/**
 * Decide when a new tab would duplicate one the user already has open.
 * Blank about:blank targets are not candidates.
 */

export interface AdoptTarget {
  targetId: string;
  sessionId?: string;
  url?: string;
  type?: string;
  focused?: boolean;
  active?: boolean;
}

export function isBlankPageUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const value = String(url);
  return (
    value === "about:blank" ||
    value.startsWith("about:blank?") ||
    value === "about:newtab" ||
    value.startsWith("about:newtab?")
  );
}

/** Exact URL match with a trailing slash ignored. Query and hash stay significant. */
export function normalizePageUrl(url: string | undefined | null): string {
  return String(url || "").replace(/\/$/, "");
}

function rankTarget(target: AdoptTarget): number {
  return (target.focused === true ? 2 : 0) + (target.active === true ? 1 : 0);
}

/**
 * Pick one already-open page for this URL.
 * Several matches reuse the focused tab, then the active one, then the
 * lowest target id. Returning null here is what used to mint another blank.
 */
export function pickExistingPageTarget<T extends AdoptTarget>(
  targets: T[] | undefined,
  url: string | undefined | null,
  options: { excludeTargetId?: string } = {}
): T | null {
  if (!url || !Array.isArray(targets)) return null;
  const wanted = normalizePageUrl(url);
  if (!wanted || isBlankPageUrl(wanted)) return null;
  const hits = targets.filter((target) => {
    if (!target?.targetId) return false;
    if (options.excludeTargetId && target.targetId === options.excludeTargetId) return false;
    if (target.type && target.type !== "page") return false;
    const candidate = normalizePageUrl(target.url);
    if (!candidate || isBlankPageUrl(candidate)) return false;
    return candidate === wanted;
  });
  if (hits.length === 0) return null;
  hits.sort((a, b) => {
    const diff = rankTarget(b) - rankTarget(a);
    if (diff !== 0) return diff;
    return String(a.targetId).localeCompare(String(b.targetId));
  });
  return hits[0];
}

export function planBlankNavigation<T extends AdoptTarget>(input: {
  currentUrl?: string | null;
  currentTargetId?: string;
  navigateUrl?: string | null;
  targets?: T[];
}): { action: "navigate" } | { action: "adopt"; target: T } {
  if (!isBlankPageUrl(input.currentUrl)) {
    return { action: "navigate" };
  }
  const target = pickExistingPageTarget(input.targets, input.navigateUrl, {
    excludeTargetId: input.currentTargetId,
  });
  if (!target) return { action: "navigate" };
  return { action: "adopt", target };
}
