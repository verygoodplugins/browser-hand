/**
 * Named-tab identity: snapshot/evaluate must not mint tabs, and open may
 * adopt an existing tab at the same URL instead of creating another.
 *
 * Regression for the point.me session (Aug 2026) where three tabs opened
 * under one pageName because snapshot/evaluate called POST /pages with
 * createsTab:true after the relay map was wiped.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  findAdoptTarget,
  namedPageNotFoundMessage,
  planCurrentTargetAccess,
  resolveNamedPageInfo,
} from "../src/tool.js";

test("open with a pageName is allowed to create a tab", () => {
  const plan = planCurrentTargetAccess({
    operation: "open",
    pageName: "work",
    targets: [],
  });
  assert.equal(plan.source, "named_page");
  assert.equal(plan.pageName, "work");
  assert.equal(plan.createsTab, true);
});

test("snapshot with a pageName attaches and never creates", () => {
  const plan = planCurrentTargetAccess({
    operation: "snapshot",
    pageName: "work",
    targets: [{ type: "page", url: "https://point.me/", targetId: "tab-1" }],
  });
  assert.equal(plan.source, "named_page");
  assert.equal(plan.createsTab, false);
});

test("evaluate with a pageName attaches and never creates", () => {
  const plan = planCurrentTargetAccess({
    operation: "evaluate",
    pageName: "work",
  });
  assert.equal(plan.source, "named_page");
  assert.equal(plan.createsTab, false);
});

test("screenshot with a pageName attaches and never creates", () => {
  const plan = planCurrentTargetAccess({
    operation: "screenshot",
    pageName: "work",
  });
  assert.equal(plan.createsTab, false);
});

test("goto with a pageName attaches and never creates", () => {
  const plan = planCurrentTargetAccess({
    operation: "goto",
    pageName: "work",
    targets: [{ type: "page", url: "https://point.me/", targetId: "tab-1" }],
  });
  assert.equal(plan.source, "named_page");
  assert.equal(plan.createsTab, false);
});

test("fill/click/type with a pageName stay attach-only", () => {
  for (const operation of ["fill_fields", "click", "type", "focus", "autofill_profile"]) {
    const plan = planCurrentTargetAccess({ operation, pageName: "work" });
    assert.equal(plan.createsTab, false, `${operation} must not mint a tab`);
  }
});

test("goto without pageName still bootstraps a tab when no http target exists", () => {
  const plan = planCurrentTargetAccess({
    operation: "goto",
    targets: [],
  });
  assert.equal(plan.source, "named_page");
  assert.equal(plan.createsTab, true);
});

test("findAdoptTarget returns the live tab whose URL matches open", () => {
  const hit = findAdoptTarget(
    [
      { type: "page", targetId: "tab-other", url: "https://example.com/" },
      { type: "page", targetId: "tab-point", url: "https://point.me/search" },
      { type: "page", targetId: "tab-blank", url: "about:blank" },
    ],
    "https://point.me/search"
  );
  assert.equal(hit.targetId, "tab-point");
});

test("findAdoptTarget ignores about:blank and unmatched URLs", () => {
  assert.equal(
    findAdoptTarget(
      [{ type: "page", targetId: "tab-blank", url: "about:blank" }],
      "https://point.me/"
    ),
    null
  );
  assert.equal(findAdoptTarget([], "https://point.me/"), null);
});

test("attach-only named-page lookup never calls the tab-creating endpoint", async () => {
  const plan = planCurrentTargetAccess({ operation: "snapshot", pageName: "typo" });
  let opened = false;
  const result = await resolveNamedPageInfo({
    plan,
    pageName: "typo",
    openPage: async () => {
      opened = true;
      return { targetId: "must-not-create" };
    },
    lookupPage: async () => null,
  });

  assert.equal(result, null);
  assert.equal(opened, false);
});

test("open resolves through the create-or-adopt endpoint", async () => {
  const plan = planCurrentTargetAccess({ operation: "open", pageName: "work" });
  const result = await resolveNamedPageInfo({
    plan,
    pageName: "work",
    url: "https://point.me/search",
    targets: [{ type: "page", targetId: "tab-point", url: "https://point.me/search" }],
    openPage: async (name, options) => ({ name, ...options }),
    lookupPage: async () => {
      assert.fail("open must use the create-or-adopt endpoint");
    },
  });

  assert.deepEqual(result, { name: "work", targetId: "tab-point" });
});

test("missing named-page errors stay compact and point to the explicit inventory", () => {
  const message = namedPageNotFoundMessage("typo", 47);
  assert.match(message, /47 named page/);
  assert.match(message, /doctor --verbose/);
  assert.ok(message.length < 220, message);
  assert.ok(!message.includes("named-a"));
});
test("findAdoptTarget does not treat prefix-overlapping URLs as the same tab", () => {
  assert.equal(
    findAdoptTarget(
      [{ type: "page", targetId: "acct", url: "https://example.com/accounting" }],
      "https://example.com/account"
    ),
    null
  );
});

test("findAdoptTarget returns null when two tabs share the exact URL", () => {
  assert.equal(
    findAdoptTarget(
      [
        { type: "page", targetId: "a", url: "https://point.me/search" },
        { type: "page", targetId: "b", url: "https://point.me/search" },
      ],
      "https://point.me/search"
    ),
    null
  );
});
