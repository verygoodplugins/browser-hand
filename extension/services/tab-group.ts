/**
 * Tab-group title and color for tabs Browser Hand creates.
 *
 * A session is one Chrome tab group. The first created tab starts it. A later
 * open with a different title starts another group. No title keeps the current
 * group, or "Browser Hand" when there isn't one yet.
 */

export const DEFAULT_GROUP_TITLE = "Browser Hand";

/** Chrome's tab-group palette, without grey. */
export const TAB_GROUP_COLORS = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

const MAX_GROUP_TITLE = 40;

export function normalizeGroupTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= MAX_GROUP_TITLE) return text;
  return text.slice(0, MAX_GROUP_TITLE).trimEnd();
}

export function pickTabGroupColor(random: () => number = Math.random): TabGroupColor {
  const index = Math.min(
    TAB_GROUP_COLORS.length - 1,
    Math.max(0, Math.floor(random() * TAB_GROUP_COLORS.length))
  );
  return TAB_GROUP_COLORS[index];
}

export function planTabGroup(
  currentTitle: string | null,
  requestedTitle: string | null
): { reuse: boolean; title: string } {
  if (currentTitle && (!requestedTitle || requestedTitle === currentTitle)) {
    return { reuse: true, title: currentTitle };
  }
  return { reuse: false, title: requestedTitle || DEFAULT_GROUP_TITLE };
}
