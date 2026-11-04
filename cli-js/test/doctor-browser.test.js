/**
 * Browser-aware doctor + local-file handling (issue #29).
 *
 * Browser Hand should target whichever browser has the extension connected,
 * distinguish "chrome.debugger unavailable in this browser" from the separate
 * debug-profile (path_b) case, and serve file: URLs through the relay.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDevBrowserDoctor,
  isDebuggerUnavailableError,
  rewriteLocalFileUrl,
} from "../src/tool.js";

test("isDebuggerUnavailableError matches the Search fork message", () => {
  assert.equal(isDebuggerUnavailableError("debugger.attach isn't available in Search"), true);
  assert.equal(isDebuggerUnavailableError("debugger.attach is not available in Foo"), true);
  assert.equal(isDebuggerUnavailableError("Another debugger is already attached"), false);
  assert.equal(isDebuggerUnavailableError(""), false);
});

test("doctor distinguishes debugger_unavailable from path_b_required", () => {
  const unavailable = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    targetCount: 5,
    smoke: { success: false, error: "HTTP 500: debugger.attach isn't available in Search" },
  });
  assert.equal(unavailable.status, "debugger_unavailable");
  assert.match(unavailable.action, /scripting transport/i);

  const pathB = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    targetCount: 5,
    smoke: { success: false, error: "Refusing to keep an uncontrollable tab: about:blank" },
  });
  assert.equal(pathB.status, "path_b_required");
});

test("doctor stays healthy when the smoke tab bootstraps", () => {
  const healthy = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    targetCount: 5,
    smoke: { success: true },
  });
  assert.equal(healthy.status, "tab_bootstrap_works");
});

test("rewriteLocalFileUrl routes file: URLs through the relay", () => {
  const out = rewriteLocalFileUrl("file:///Users/me/brief.html", "http://127.0.0.1:9333");
  assert.equal(out, "http://127.0.0.1:9333/local-file?path=%2FUsers%2Fme%2Fbrief.html");
});

test("rewriteLocalFileUrl leaves http(s) URLs untouched", () => {
  assert.equal(
    rewriteLocalFileUrl("https://example.com/x", "http://127.0.0.1:9333"),
    "https://example.com/x"
  );
  assert.equal(
    rewriteLocalFileUrl("http://127.0.0.1:8799/", "http://127.0.0.1:9333"),
    "http://127.0.0.1:8799/"
  );
});
