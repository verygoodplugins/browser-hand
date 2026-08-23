/**
 * Tab inventory + current-tab selection.
 *
 * Agents were using `doctor` as a tab list. Doctor sliced to 10, dropped
 * `active`, and hid the tab the user was looking at (e.g. Stripe at index 20).
 * `document.hasFocus()` is also false while the agent has OS focus, so
 * attaching to every tab to guess "current" is both slow and wrong.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTarget,
  filterTabTargets,
  formatTargetCandidates,
  selectCurrentTarget,
  summarizeTabInventory,
} from "../src/tool.js";

function page(partial) {
  return {
    type: "page",
    targetId: partial.id || partial.targetId,
    title: partial.title || "",
    url: partial.url || "https://example.com/",
    active: partial.active === true,
    focused: partial.focused === true,
    windowId: partial.windowId,
  };
}

function manyTabs(count, { activeIndex = 0, focusedIndex = null, titleAt } = {}) {
  return Array.from({ length: count }, (_, i) =>
    page({
      id: `tab-${i + 1}`,
      title: titleAt && titleAt[i] ? titleAt[i] : `Tab ${i + 1}`,
      url: `https://example.com/p${i + 1}`,
      active: i === activeIndex,
      focused: focusedIndex === i,
      windowId: 1,
    })
  );
}

test("compactTarget keeps id/title/url plus active, focused, and windowId", () => {
  assert.deepEqual(
    compactTarget({
      targetId: "tab-9",
      title: "Stripe",
      url: "https://dashboard.stripe.com/test/apikeys",
      active: true,
      focused: true,
      windowId: 12,
    }),
    {
      id: "tab-9",
      title: "Stripe",
      url: "https://dashboard.stripe.com/test/apikeys",
      active: true,
      focused: true,
      windowId: 12,
    }
  );
});

test("compactTarget keeps full title and URL for snapshot/evaluate/focus", () => {
  const title = `X ${"word ".repeat(80)}`;
  const url = `https://billing.stripe.com/p/session?secret=${"a".repeat(300)}`;
  const compact = compactTarget({ targetId: "tab-x", title, url });
  assert.equal(compact.title, title);
  assert.equal(compact.url, url);
});

test("inventory clips oversized titles and URLs so 30-tab dumps stay scannable", () => {
  const compact = compactTarget(
    {
      targetId: "tab-x",
      title: `X ${"word ".repeat(80)}`,
      url: `https://billing.stripe.com/p/session?secret=${"a".repeat(300)}`,
    },
    { clip: true }
  );
  assert.ok(compact.title.length <= 160);
  assert.ok(compact.title.endsWith("..."));
  assert.ok(compact.url.length <= 220);
  assert.ok(compact.url.startsWith("https://billing.stripe.com/"));
  assert.ok(compact.url.endsWith("..."));
});

test("compactTarget omits falsey flags so inventory stays small", () => {
  assert.deepEqual(
    compactTarget({ targetId: "tab-1", title: "Gmail", url: "https://mail.google.com/" }),
    { id: "tab-1", title: "Gmail", url: "https://mail.google.com/" }
  );
});

test("summarizeTabInventory lists every http(s) page, not the first 10", () => {
  const targets = [
    ...manyTabs(24, {
      activeIndex: 20,
      focusedIndex: 20,
      titleAt: { 20: "Stripe API keys" },
    }),
    { type: "iframe", targetId: "iframe-1", title: "", url: "https://example.com/embed" },
    { type: "page", targetId: "chrome-1", title: "Extensions", url: "chrome://extensions" },
  ];

  const summary = summarizeTabInventory(targets);
  assert.equal(summary.targetCount, 26);
  assert.equal(summary.tabCount, 24);
  assert.equal(summary.truncated, false);
  assert.equal(summary.tabs.length, 24);
  assert.equal(summary.active.id, "tab-21");
  assert.equal(summary.active.title, "Stripe API keys");
  assert.equal(summary.active.focused, true);
  assert.equal(summary.tabs[0].id, "tab-21", "current tab must be first");
  assert.ok(
    summary.tabs.some((tab) => tab.title === "Stripe API keys"),
    "active tab must appear in the full list"
  );
});

test("summarizeTabInventory --query filters title or url without dropping the rest of the contract", () => {
  const targets = manyTabs(12, {
    activeIndex: 11,
    focusedIndex: 11,
    titleAt: { 3: "Fly", 11: "API keys" },
  });
  targets[3].url = "https://fly.io/app/sign-in";
  targets[11].url = "https://dashboard.stripe.com/test/apikeys";

  const summary = summarizeTabInventory(targets, { query: "stripe" });
  assert.equal(summary.tabCount, 1);
  assert.equal(summary.tabs[0].url.includes("stripe.com"), true);
  assert.equal(summary.active.id, "tab-12");
});

test("filterTabTargets honors target.name with the same title-or-URL match as selectCurrentTarget", () => {
  const targets = manyTabs(4, { titleAt: { 2: "API keys" } });
  targets[2].url = "https://dashboard.stripe.com/test/apikeys";
  const filtered = filterTabTargets(targets, { name: "stripe" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].targetId, "tab-3");
});

test("filterTabTargets honors target id so tabs --target-id is not a no-op", () => {
  const targets = manyTabs(5, { activeIndex: 0 });
  const filtered = filterTabTargets(targets, { id: "tab-4" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].targetId, "tab-4");
});

test("filterTabTargets ignores non-http pages", () => {
  const filtered = filterTabTargets([
    page({ id: "a", url: "https://ok.example/" }),
    page({ id: "b", url: "http://plain.example/" }),
    { type: "page", targetId: "c", title: "x", url: "chrome://settings" },
    { type: "worker", targetId: "d", title: "", url: "https://example.com/sw.js" },
  ]);
  assert.deepEqual(
    filtered.map((item) => item.targetId),
    ["a", "b"]
  );
});

test("selectCurrentTarget prefers the last-focused tab over other window actives", async () => {
  const targets = [
    page({
      id: "win1",
      title: "Gmail",
      url: "https://mail.google.com/",
      active: true,
      windowId: 1,
    }),
    page({
      id: "win2",
      title: "Stripe",
      url: "https://dashboard.stripe.com/",
      active: true,
      focused: true,
      windowId: 2,
    }),
  ];
  let focusCalls = 0;
  const selected = await selectCurrentTarget(targets, {
    evaluateFocus: async () => {
      focusCalls += 1;
      return false;
    },
  });
  assert.equal(selected.targetId, "win2");
  assert.equal(focusCalls, 0, "must not attach to every tab to guess focus");
});

test("selectCurrentTarget uses a unique active tab without probing document.hasFocus", async () => {
  const targets = manyTabs(24, { activeIndex: 17, titleAt: { 17: "Stripe" } });
  let focusCalls = 0;
  const selected = await selectCurrentTarget(targets, {
    evaluateFocus: async () => {
      focusCalls += 1;
      throw new Error("should not run");
    },
  });
  assert.equal(selected.targetId, "tab-18");
  assert.equal(focusCalls, 0);
});

test("selectCurrentTarget does not guess among multiple window actives without focused", async () => {
  const targets = [
    page({ id: "win1", title: "Gmail", url: "https://mail.google.com/", active: true, windowId: 1 }),
    page({
      id: "win2",
      title: "Stripe",
      url: "https://dashboard.stripe.com/",
      active: true,
      windowId: 2,
    }),
  ];
  await assert.rejects(
    () => selectCurrentTarget(targets),
    /Ambiguous current Chrome tab/
  );
});

test("selectCurrentTarget --query matches title or url", async () => {
  const targets = manyTabs(8, { titleAt: { 5: "API keys" } });
  targets[5].url = "https://dashboard.stripe.com/test/apikeys";
  const selected = await selectCurrentTarget(targets, {
    target: { query: "stripe" },
  });
  assert.equal(selected.targetId, "tab-6");
});

test("ambiguous current tab lists every http candidate, not a 6-item slice", async () => {
  const targets = manyTabs(12, { activeIndex: -1 });
  await assert.rejects(
    () => selectCurrentTarget(targets),
    (err) => {
      assert.match(String(err.message), /Ambiguous current Chrome tab/);
      assert.match(String(err.message), /tab-12/);
      assert.doesNotMatch(String(err.message), /tab-1 tab-2 tab-3 tab-4 tab-5 tab-6$/);
      const listed = String(err.message).match(/tab-\d+/g) || [];
      assert.equal(listed.length, 12);
      return true;
    }
  );
});

test("formatTargetCandidates marks focused/active so agents can spot 'this tab'", () => {
  const text = formatTargetCandidates([
    page({
      id: "tab-9",
      title: "Stripe",
      url: "https://dashboard.stripe.com/",
      active: true,
      focused: true,
    }),
    page({ id: "tab-1", title: "Gmail", url: "https://mail.google.com/" }),
  ]);
  assert.match(text, /tab-9\[focused,active\] Stripe/);
  assert.match(text, /tab-1 Gmail/);
});
