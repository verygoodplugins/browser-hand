/**
 * Browser-aware doctor + local-file handling (issue #29).
 *
 * Browser Hand should target whichever browser has the extension connected,
 * distinguish "chrome.debugger unavailable in this browser" from the separate
 * debug-profile (path_b) case, and serve file: URLs through the relay.
 */

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
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

test("relay-reported debugger limitation wins even when the smoke tab bootstrapped (P2)", () => {
  // The extension's scripting fallback lets the smoke tab open, so smoke.success is true
  // and there is no error text to match: only the relay's report carries the limitation.
  const reported = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    targetCount: 5,
    smoke: { success: true },
    debuggerState: { available: false, reason: "debugger.attach isn't available in Search" },
  });
  assert.equal(reported.status, "debugger_unavailable");
  assert.match(reported.action, /scripting transport/i);

  for (const debuggerState of [null, undefined, {}, { available: true }]) {
    const healthy = classifyDevBrowserDoctor({
      relayInfo: { extensionConnected: true },
      targetCount: 5,
      smoke: { success: true },
      debuggerState,
    });
    assert.equal(healthy.status, "tab_bootstrap_works", JSON.stringify(debuggerState));
  }

  // The report never masks an earlier, more fundamental state.
  const asleep = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: false },
    debuggerState: { available: false },
  });
  assert.equal(asleep.status, "extension_disconnected");
  const unstable = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    smoke: { success: false, error: "Extension connection replaced" },
    debuggerState: { available: false },
  });
  assert.equal(unstable.status, "extension_unstable");
});

test("doctor stays healthy when the smoke tab bootstraps", () => {
  const healthy = classifyDevBrowserDoctor({
    relayInfo: { extensionConnected: true },
    targetCount: 5,
    smoke: { success: true },
  });
  assert.equal(healthy.status, "tab_bootstrap_works");
});

/** Stub relay recording what the CLI sends; the real relay is covered in relay/src/local-file-server.test.ts. */
async function withStubRelay(reply, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      reply(res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.close();
  }
}

const registered = (res, body) => {
  const name = encodeURIComponent(path.basename(JSON.parse(body).path));
  res.writeHead(201, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: `http://127.0.0.1:41873/local/tok/${name}` }));
};

test("rewriteLocalFileUrl registers the file and keeps directory context (P2)", async () => {
  await withStubRelay(registered, async (relay, requests) => {
    const out = await rewriteLocalFileUrl("file:///tmp/my%20report/index.html", relay);
    assert.equal(out, "http://127.0.0.1:41873/local/tok/index.html");
    // The old query-only /local-file URL sent ./style.css to /style.css (404).
    assert.equal(new URL("./style.css", out).pathname, "/local/tok/style.css");
    assert.equal(new URL("img/a.png", out).pathname, "/local/tok/img/a.png");

    const [req] = requests;
    assert.deepEqual([req.method, req.url], ["POST", "/local-docs"]);
    assert.match(req.headers["content-type"], /^application\/json/);
    assert.equal(
      req.headers.origin,
      undefined,
      "relay refuses registration when Origin is present"
    );
    assert.deepEqual(JSON.parse(req.body), { path: "/tmp/my report/index.html" });
  });
});

test("rewriteLocalFileUrl preserves the query string and hash", async () => {
  await withStubRelay(registered, async (relay, requests) => {
    const out = await rewriteLocalFileUrl(
      "file:///tmp/r/index.html?tab=2&q=a%20b#section-3",
      relay
    );
    const parsed = new URL(out);
    assert.deepEqual([parsed.search, parsed.hash], ["?tab=2&q=a%20b", "#section-3"]);
    assert.deepEqual(JSON.parse(requests[0].body), { path: "/tmp/r/index.html" });
  });
});

test("rewriteLocalFileUrl leaves non-file URLs alone without calling the relay", async () => {
  await withStubRelay(registered, async (relay, requests) => {
    for (const url of ["https://example.com/x", "http://127.0.0.1:8799/", undefined]) {
      assert.equal(await rewriteLocalFileUrl(url, relay), url);
    }
    assert.equal(requests.length, 0);
  });
});

test("rewriteLocalFileUrl fails loudly when the relay refuses or predates local documents", async () => {
  const notFound = (res) => res.writeHead(404).end("404 Not Found");
  const noUrl = (res) => res.writeHead(201, { "content-type": "application/json" }).end("{}");
  for (const [reply, message] of [
    [notFound, /Could not serve \/tmp\/r\/index\.html.*HTTP 404.*browser-hand relay/s],
    [noUrl, /did not return a URL/],
  ]) {
    await withStubRelay(reply, (relay) =>
      assert.rejects(rewriteLocalFileUrl("file:///tmp/r/index.html", relay), message)
    );
  }
});
