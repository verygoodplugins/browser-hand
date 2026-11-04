/**
 * `browser-hand close`: explicit selector, no accidental multi-close, and only
 * tabs Browser Hand opened unless the caller overrides.
 *
 * The relay stamps `browserHandOwned` on every Target.getTargets entry and the
 * extension stamps `groupTitle`; these tests feed planCloseTargets the same
 * shapes without Chrome.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildHandlerInput, parseArgs } from "../src/cli.js";
import {
  buildCloseResult,
  filterTabTargets,
  isControllablePageTarget,
  planCloseTargets,
  waitForTargetsClosed,
} from "../src/tool.js";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/cli.js");

function page(id, partial = {}) {
  return {
    type: "page",
    targetId: id,
    title: partial.title || `Tab ${id}`,
    url: partial.url || `https://example.com/${id}`,
    browserHandOwned: partial.owned === true,
    ...(partial.groupTitle ? { groupTitle: partial.groupTitle } : {}),
  };
}

const ids = (tabs) => tabs.map((tab) => tab.targetId);

test("close needs an explicit selector and never falls back to the active tab", () => {
  const targets = [{ ...page("tab-1", { owned: true }), active: true, focused: true }];
  assert.throws(() => planCloseTargets(targets, {}), /never closes the active tab/);
  assert.throws(() => planCloseTargets(targets, { target: {} }), /never closes the active tab/);
});

test("a page name cannot be mixed with other selectors", () => {
  assert.throws(
    () =>
      planCloseTargets([page("tab-1", { owned: true })], {
        pageName: "work",
        namedTargetId: "tab-1",
        target: { query: "example" },
      }),
    /cannot be combined/
  );
});

test("a named page closes by exact id, including a tab still on about:blank", () => {
  const blank = { ...page("tab-7", { owned: true }), url: "about:blank" };
  const plan = planCloseTargets([blank, page("tab-8", { owned: true })], {
    pageName: "work",
    namedTargetId: "tab-7",
  });
  assert.deepEqual(ids(plan.closable), ["tab-7"]);
});

test("a selector that matches nothing is an error that names the selector", () => {
  assert.throws(
    () => planCloseTargets([page("tab-1", { owned: true })], { target: { query: "stripe" } }),
    /No Chrome tab matched .*stripe/
  );
});

test("a selector matching several tabs is refused unless --all is passed", () => {
  const targets = [
    page("tab-1", { owned: true, title: "Stripe A" }),
    page("tab-2", { owned: true, title: "Stripe B" }),
  ];
  assert.throws(
    () => planCloseTargets(targets, { target: { query: "stripe" } }),
    /Ambiguous Chrome tab target .* matched 2 tabs.*--all/
  );
  const plan = planCloseTargets(targets, { target: { query: "stripe" }, all: true });
  assert.deepEqual(ids(plan.closable), ["tab-1", "tab-2"]);
});

test("ambiguity counts the user's tabs too, not just the ones Browser Hand opened", () => {
  const targets = [
    page("tab-1", { owned: true, title: "Docs" }),
    page("tab-2", { owned: false, title: "Docs" }),
  ];
  assert.throws(() => planCloseTargets(targets, { target: { query: "docs" } }), /Ambiguous/);
});

test("a tab the user had open is refused by default", () => {
  const targets = [page("tab-1", { owned: false, title: "Gmail" })];
  assert.throws(
    () => planCloseTargets(targets, { target: { query: "gmail" } }),
    /Refusing to close a tab Browser Hand did not open.*--include-user-tabs/
  );
});

test("--include-user-tabs closes a tab Browser Hand did not open", () => {
  const targets = [page("tab-1", { owned: false, title: "Gmail" })];
  const plan = planCloseTargets(targets, { target: { query: "gmail" }, includeUserTabs: true });
  assert.deepEqual(ids(plan.closable), ["tab-1"]);
  assert.deepEqual(plan.skipped, []);
});

test("--all closes the tabs Browser Hand opened and reports the user's as skipped", () => {
  const targets = [
    page("tab-1", { owned: true, title: "Docs one" }),
    page("tab-2", { owned: false, title: "Docs two" }),
    page("tab-3", { owned: true, title: "Docs three" }),
  ];
  const plan = planCloseTargets(targets, { target: { query: "docs" }, all: true });
  assert.deepEqual(ids(plan.closable), ["tab-1", "tab-3"]);
  assert.equal(plan.matched, 3);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].id, "tab-2");
  assert.match(plan.skipped[0].reason, /not opened by Browser Hand/);
});

test("--all with only user tabs is refused rather than closing nothing quietly", () => {
  const targets = [page("tab-1", { owned: false }), page("tab-2", { owned: false })];
  assert.throws(
    () => planCloseTargets(targets, { target: { query: "example" }, all: true }),
    /Refusing to close tabs Browser Hand did not open/
  );
});

test("a lone group title closes the whole group without --all", () => {
  const targets = [
    page("tab-1", { owned: true, groupTitle: "DNS records" }),
    page("tab-2", { owned: true, groupTitle: "DNS records" }),
    page("tab-3", { owned: true, groupTitle: "Invoice review" }),
    page("tab-4", { owned: true }),
  ];
  const plan = planCloseTargets(targets, { groupTitle: "  DNS   records " });
  assert.deepEqual(ids(plan.closable), ["tab-1", "tab-2"]);
});

test("a group close leaves the user's tabs in that group open", () => {
  const targets = [
    page("tab-1", { owned: true, groupTitle: "DNS records" }),
    page("tab-2", { owned: false, groupTitle: "DNS records" }),
  ];
  const plan = planCloseTargets(targets, { groupTitle: "DNS records" });
  assert.deepEqual(ids(plan.closable), ["tab-1"]);
  assert.deepEqual(
    plan.skipped.map((tab) => tab.id),
    ["tab-2"]
  );
});

test("close selects Browser Hand tabs that are still on about:blank or file://", () => {
  const blank = { ...page("tab-1", { owned: true }), url: "about:blank" };
  const local = { ...page("tab-2", { owned: true }), url: "file:///tmp/gym/index.html" };
  const targets = [blank, local, page("tab-3", { owned: true })];
  assert.deepEqual(ids(planCloseTargets(targets, { target: { id: "tab-1" } }).closable), ["tab-1"]);
  assert.deepEqual(ids(planCloseTargets(targets, { target: { id: "tab-2" } }).closable), ["tab-2"]);
});

test("a group close takes every tab in the group, including about:blank and file:// ones", () => {
  const group = { owned: true, groupTitle: "DNS records" };
  const targets = [
    { ...page("tab-1", group), url: "about:blank" },
    { ...page("tab-2", group), url: "file:///tmp/gym/index.html" },
    page("tab-3", group),
  ];
  const plan = planCloseTargets(targets, { groupTitle: "DNS records" });
  assert.deepEqual(ids(plan.closable), ["tab-1", "tab-2", "tab-3"]);
  assert.equal(plan.matched, 3);
});

test("a user's about:blank or file:// tab in a group is reported as skipped, not dropped", () => {
  const user = { owned: false, groupTitle: "DNS records" };
  const targets = [
    page("tab-1", { owned: true, groupTitle: "DNS records" }),
    { ...page("tab-2", user), url: "file:///Users/me/notes.html" },
    { ...page("tab-3", user), url: "about:blank" },
  ];
  const plan = planCloseTargets(targets, { groupTitle: "DNS records" });
  assert.deepEqual(ids(plan.closable), ["tab-1"]);
  assert.deepEqual(
    plan.skipped.map((tab) => tab.id),
    ["tab-2", "tab-3"]
  );
});

test("close sees the pages the extension lists, while tabs/snapshot/click stay http(s)-only", () => {
  const targets = [
    { type: "page", targetId: "web", url: "https://example.com/" },
    { type: "page", targetId: "blank", url: "about:blank" },
    { type: "page", targetId: "blank-q", url: "about:blank?x=1" },
    { type: "page", targetId: "local", url: "file:///tmp/a.html" },
    { type: "page", targetId: "chrome", url: "chrome://extensions/" },
    { type: "page", targetId: "ext", url: "chrome-extension://abc/page.html" },
    { type: "page", targetId: "lookalike", url: "about:blankly" },
    { type: "service_worker", targetId: "sw", url: "https://example.com/sw.js" },
  ];
  assert.deepEqual(ids(targets.filter(isControllablePageTarget)), [
    "web",
    "blank",
    "blank-q",
    "local",
  ]);
  assert.deepEqual(ids(filterTabTargets(targets, {})), ["web"]);
  assert.deepEqual(ids(filterTabTargets(targets, {}, { includeNonHttp: true })), [
    "web",
    "blank",
    "blank-q",
    "local",
  ]);
});

test("a group title narrowed by --query still needs --all to close several tabs", () => {
  const targets = [
    page("tab-1", { owned: true, title: "A", groupTitle: "DNS records" }),
    page("tab-2", { owned: true, title: "B", groupTitle: "DNS records" }),
  ];
  const opts = { groupTitle: "DNS records", target: { query: "example.com" } };
  assert.throws(() => planCloseTargets(targets, opts), /Ambiguous/);
  assert.equal(planCloseTargets(targets, { ...opts, all: true }).closable.length, 2);
});

test("an unknown group says when no tab reports a group title at all", () => {
  assert.throws(
    () => planCloseTargets([page("tab-1", { owned: true })], { groupTitle: "DNS records" }),
    /No tab reports a group title; reload the Browser Hand extension/
  );
  assert.throws(
    () =>
      planCloseTargets([page("tab-1", { owned: true, groupTitle: "Other" })], {
        groupTitle: "DNS records",
      }),
    (err) => /No Chrome tab matched/.test(err.message) && !/reload/.test(err.message)
  );
});

test("a relay that never reports ownership fails closed with a restart hint", () => {
  const legacy = [{ type: "page", targetId: "tab-1", title: "Docs", url: "https://example.com/" }];
  assert.throws(
    () => planCloseTargets(legacy, { target: { id: "tab-1" } }),
    /predates ownership tracking.*npm run relay/
  );
  // The explicit override does not depend on ownership data.
  const plan = planCloseTargets(legacy, { target: { id: "tab-1" }, includeUserTabs: true });
  assert.deepEqual(ids(plan.closable), ["tab-1"]);
});

test("waitForTargetsClosed returns once the tabs are gone", async () => {
  const lists = [[{ targetId: "tab-1" }, { targetId: "tab-2" }], [{ targetId: "tab-2" }], []];
  let calls = 0;
  const stillOpen = await waitForTargetsClosed(
    async () => lists[Math.min(calls++, lists.length - 1)],
    ["tab-1", "tab-2"],
    { sleep: async () => {} }
  );
  assert.equal(stillOpen.size, 0);
  assert.equal(calls, 3);
});

test("waitForTargetsClosed reports a tab that never leaves the list", async () => {
  const stillOpen = await waitForTargetsClosed(
    async () => [{ targetId: "tab-1" }, { targetId: "tab-9" }],
    ["tab-1", "tab-2"],
    { timeoutMs: 20, intervalMs: 5 }
  );
  assert.deepEqual([...stillOpen], ["tab-1"]);
});

test("a single close returns { closed, targetId, url, title }", () => {
  const result = buildCloseResult({
    tabs: [{ closed: true, targetId: "tab-1", url: "https://example.com/", title: "Example" }],
    pageName: "demo",
  });
  assert.equal(result.success, true);
  assert.equal(result.operation, "close");
  assert.equal(result.closed, true);
  assert.equal(result.targetId, "tab-1");
  assert.equal(result.url, "https://example.com/");
  assert.equal(result.title, "Example");
  assert.equal(result.pageName, "demo");
});

test("a tab that is still open after close is not reported as closed", () => {
  const result = buildCloseResult({
    tabs: [{ closed: false, targetId: "tab-1", url: "u", title: "t", error: "still open" }],
  });
  assert.equal(result.success, false);
  assert.equal(result.closed, false);
  assert.equal(result.error, "still open");
});

test("a multi close lists every tab and only succeeds when all of them closed", () => {
  const tabs = [
    { closed: true, targetId: "tab-1", url: "u1", title: "t1" },
    { closed: false, targetId: "tab-2", url: "u2", title: "t2", error: "still open" },
  ];
  const partial = buildCloseResult({ tabs, multi: true, groupTitle: "DNS records" });
  assert.equal(partial.success, false);
  assert.equal(partial.closed, false);
  assert.equal(partial.count, 1);
  assert.equal(partial.groupTitle, "DNS records");
  assert.equal(partial.tabs.length, 2);

  const whole = buildCloseResult({ tabs: [tabs[0]], multi: true, skipped: [{ id: "tab-9" }] });
  assert.equal(whole.success, true);
  assert.equal(whole.closed, true);
  assert.deepEqual(whole.skipped, [{ id: "tab-9" }]);
});

test("the CLI parses --all and --include-user-tabs as flags that take no value", () => {
  const args = parseArgs(["close", "--all", "--include-user-tabs", "--query", "docs"]);
  assert.equal(args.all, true);
  assert.equal(args.includeUserTabs, true);
  assert.equal(args.query, "docs");

  const input = buildHandlerInput("close", args);
  assert.equal(input.operation, "close");
  assert.equal(input.all, true);
  assert.equal(input.includeUserTabs, true);
  assert.deepEqual(input.target, { query: "docs" });
});

test("the CLI passes --group-title through to close", () => {
  const input = buildHandlerInput("close", parseArgs(["close", "--group-title", "DNS records"]));
  assert.equal(input.groupTitle, "DNS records");
  assert.equal(input.all, undefined);
  assert.equal(input.includeUserTabs, undefined);
});

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("close with no selector is an argument error", () => {
  const result = runCli(["close"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /close requires --page-name, --query/);
});

test("close --all alone is still an argument error", () => {
  const result = runCli(["close", "--all"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /close requires --page-name, --query/);
});

test("close --page-name cannot be combined with --query", () => {
  const result = runCli(["close", "--page-name", "work", "--query", "docs"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot be combined/);
});

test("close --group-title without a value is an argument error", () => {
  const result = runCli(["close", "--group-title"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--group-title requires a value/);
});
