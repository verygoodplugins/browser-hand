import assert from "node:assert/strict";
import test from "node:test";

import {
  isBlankPageUrl,
  normalizePageUrl,
  pickExistingPageTarget,
  planBlankNavigation,
} from "./adopt-existing-tab.ts";

test("blank urls are not adoptable pages", () => {
  assert.equal(isBlankPageUrl(""), true);
  assert.equal(isBlankPageUrl("about:blank"), true);
  assert.equal(isBlankPageUrl("about:blank?x=1"), true);
  assert.equal(isBlankPageUrl("https://example.com"), false);
});

test("normalizePageUrl keeps a slash that belongs to the query", () => {
  assert.equal(normalizePageUrl("https://example.com/?next=/"), "https://example.com/?next=/");
  assert.equal(normalizePageUrl("https://example.com/a/"), "https://example.com/a");
  assert.equal(
    pickExistingPageTarget(
      [{ type: "page", targetId: "q", url: "https://example.com/?next=/" }],
      "https://example.com/?next="
    ),
    null
  );
});

test("pickExistingPageTarget reuses the focused tab when several share the URL", () => {
  const hit = pickExistingPageTarget(
    [
      { type: "page", targetId: "a", url: "https://example.com/invoice" },
      { type: "page", targetId: "b", url: "https://example.com/invoice", focused: true },
      { type: "page", targetId: "blank", url: "about:blank" },
    ],
    "https://example.com/invoice"
  );
  assert.equal(hit?.targetId, "b");
});

test("pickExistingPageTarget prefers the active tab, then the lowest id", () => {
  const active = pickExistingPageTarget(
    [
      { type: "page", targetId: "b", url: "https://example.com/invoice" },
      { type: "page", targetId: "a", url: "https://example.com/invoice", active: true },
    ],
    "https://example.com/invoice/"
  );
  assert.equal(active?.targetId, "a");

  const first = pickExistingPageTarget(
    [
      { type: "page", targetId: "b", url: "https://example.com/invoice" },
      { type: "page", targetId: "a", url: "https://example.com/invoice" },
    ],
    "https://example.com/invoice"
  );
  assert.equal(first?.targetId, "a");
});

test("pickExistingPageTarget ignores prefix overlaps and blanks", () => {
  assert.equal(
    pickExistingPageTarget(
      [{ type: "page", targetId: "acct", url: "https://example.com/accounting" }],
      "https://example.com/account"
    ),
    null
  );
  assert.equal(
    pickExistingPageTarget(
      [{ type: "page", targetId: "blank", url: "about:blank" }],
      "https://example.com/"
    ),
    null
  );
});

test("navigating a blank tab to an open URL adopts that tab", () => {
  const plan = planBlankNavigation({
    currentUrl: "about:blank",
    currentTargetId: "fresh",
    navigateUrl: "https://example.com/invoice",
    targets: [
      { type: "page", targetId: "fresh", url: "about:blank", sessionId: "blank-session" },
      {
        type: "page",
        targetId: "live",
        url: "https://example.com/invoice",
        sessionId: "live-session",
        focused: true,
      },
    ],
  });
  assert.equal(plan.action, "adopt");
  if (plan.action === "adopt") {
    assert.equal(plan.target.targetId, "live");
  }
});

test("navigating a real tab stays a navigation", () => {
  const plan = planBlankNavigation({
    currentUrl: "https://example.com/other",
    currentTargetId: "live",
    navigateUrl: "https://example.com/invoice",
    targets: [{ type: "page", targetId: "invoice", url: "https://example.com/invoice" }],
  });
  assert.deepEqual(plan, { action: "navigate" });
});
