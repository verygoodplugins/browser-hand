import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_TITLE,
  TAB_GROUP_COLORS,
  normalizeGroupTitle,
  pickTabGroupColor,
  planTabGroup,
} from "../services/tab-group";

describe("tab group session", () => {
  it("keeps Browser Hand when a session has no title", () => {
    expect(planTabGroup(null, null)).toEqual({ reuse: false, title: DEFAULT_GROUP_TITLE });
    expect(planTabGroup("Browser Hand", null)).toEqual({ reuse: true, title: "Browser Hand" });
  });

  it("starts a group from an optional title and reuses that title", () => {
    expect(planTabGroup(null, "DNS records")).toEqual({ reuse: false, title: "DNS records" });
    expect(planTabGroup("DNS records", null)).toEqual({ reuse: true, title: "DNS records" });
    expect(planTabGroup("DNS records", "DNS records")).toEqual({
      reuse: true,
      title: "DNS records",
    });
  });

  it("a different title starts a new group", () => {
    expect(planTabGroup("DNS records", "Invoice review")).toEqual({
      reuse: false,
      title: "Invoice review",
    });
  });

  it("drops a blank title and caps a long one", () => {
    expect(normalizeGroupTitle("  ")).toBeNull();
    expect(normalizeGroupTitle("  DNS   records ")).toBe("DNS records");
    expect(normalizeGroupTitle("x".repeat(80))?.length).toBe(40);
  });

  it("picks a color from the pool and never grey", () => {
    expect(TAB_GROUP_COLORS).not.toContain("grey");
    expect(TAB_GROUP_COLORS).not.toContain("gray");
    const seen = new Set(TAB_GROUP_COLORS.map((_, i) => pickTabGroupColor(() => i / TAB_GROUP_COLORS.length)));
    expect(seen).toEqual(new Set(TAB_GROUP_COLORS));
    expect(pickTabGroupColor(() => 0.99)).toBe("orange");
  });
});
