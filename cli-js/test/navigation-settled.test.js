/**
 * The debugger-free transport (chrome.tabs.update) finishes loading before it
 * replies, so the CLI must not wait for Page.loadEventFired afterwards: that
 * event can already be gone, and the wait would burn the whole timeout on every
 * goto/open.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { navigationSettled } from "../src/tool.js";

test("navigationSettled: the scripting transport reports loadComplete", () => {
  assert.equal(navigationSettled({ frameId: "tab-1", loaderId: "scripting-x", loadComplete: true }), true);
});

test("navigationSettled: a relay-adopted blank tab is already settled", () => {
  assert.equal(navigationSettled({ loaderId: "adopted-abc" }), true);
});

test("navigationSettled: a CDP navigate still waits for Page.loadEventFired", () => {
  assert.equal(navigationSettled({ frameId: "F1", loaderId: "L1" }), false);
});

test("navigationSettled: a scripting navigation that timed out is not settled", () => {
  assert.equal(navigationSettled({ frameId: "tab-1", loaderId: "scripting-x" }), false);
});

test("navigationSettled: tolerates a missing result", () => {
  assert.equal(navigationSettled(undefined), false);
  assert.equal(navigationSettled(null), false);
});
