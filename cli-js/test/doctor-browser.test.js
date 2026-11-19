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
  cliNameForEnv,
  describeVia,
  isDebuggerUnavailableError,
  otherRelayHint,
  readSafariExtensionState,
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

test("standalone Safari doctor describes its own setup and extension", () => {
  assert.match(classifyDevBrowserDoctor({ safariStandalone: true }).action, /Set up Browser Hand/);
  const disconnected = classifyDevBrowserDoctor({ safariStandalone: true, relayInfo: { extensionConnected: false } });
  assert.equal(disconnected.status, "extension_disconnected");
  assert.match(disconnected.action, /Safari > Settings > Extensions > Browser Hand/);
  assert.doesNotMatch(disconnected.action, /Chrome|unpacked/);
  assert.match(classifyDevBrowserDoctor({ safariStandalone: true, relayInfo: { extensionConnected: false }, recentExtensionDisconnected: true }).action, /Safari/);
});

test("Safari doctor tells a stopped Safari apart from a turned-off extension", () => {
  const stopped = classifyDevBrowserDoctor({
    safariStandalone: true,
    safariRunning: false,
    relayInfo: { extensionConnected: false },
  });
  assert.match(stopped.action, /Safari is not running/);
  const off = classifyDevBrowserDoctor({
    safariStandalone: true,
    safariRunning: true,
    relayInfo: { extensionConnected: false },
  });
  assert.match(off.action, /most likely turned off/);
  assert.match(off.action, /Safari > Settings > Extensions > Browser Hand/);
});

test("Safari doctor uses Safari's reported toggle instead of guessing (#105)", () => {
  const base = { safariStandalone: true, relayInfo: { extensionConnected: false } };
  const off = classifyDevBrowserDoctor({ ...base, safariRunning: true, safariExtension: { enabled: false } });
  assert.equal(off.status, "extension_disabled");
  assert.match(off.action, /turned off in Safari/);
  assert.match(off.action, /Safari > Settings > Extensions > Browser Hand/);
  assert.doesNotMatch(off.action, /most likely/);

  // Opening Safari would not help while the extension is off, so that comes first.
  const offAndClosed = classifyDevBrowserDoctor({ ...base, safariRunning: false, safariExtension: { enabled: false } });
  assert.equal(offAndClosed.status, "extension_disabled");
  assert.match(offAndClosed.action, /then open Safari/);

  const on = classifyDevBrowserDoctor({ ...base, safariRunning: true, safariExtension: { enabled: true } });
  assert.equal(on.status, "extension_disconnected");
  // The Safari checkbox is on, so point at the extension's own Active switch.
  assert.match(on.action, /not connected to the relay/);
  assert.match(on.action, /switch it to Active/);
  // A disabled extension has no toolbar button, so the checkbox stays as the fallback.
  assert.match(on.action, /button is missing, check that it is ticked in Safari > Settings > Extensions > Browser Hand/);
  assert.doesNotMatch(on.action, /most likely/);
  assert.equal(
    classifyDevBrowserDoctor({ ...base, safariRunning: false, safariExtension: { enabled: true } }).action.startsWith("Safari is not running"),
    true
  );

  const unknown = classifyDevBrowserDoctor({ ...base, safariRunning: true, safariExtension: { enabled: null, error: "x" } });
  assert.match(unknown.action, /most likely turned off/);

  const chromium = classifyDevBrowserDoctor({ relayInfo: { extensionConnected: false }, safariStandalone: false, safariExtension: { enabled: false } });
  assert.equal(chromium.status, "extension_disconnected");
});

test("readSafariExtensionState asks the app only when the Safari wrapper names it", () => {
  const calls = [];
  const fake = (stdout, extra = {}) => (bin, args, opts) => {
    calls.push({ bin, args, opts });
    return { stdout, status: 0, ...extra };
  };
  const env = { BROWSER_HAND_SAFARI_APP_BIN: process.execPath };

  assert.equal(readSafariExtensionState({ env: {}, platform: "darwin", run: fake("{}") }), null);
  assert.equal(readSafariExtensionState({ env, platform: "linux", run: fake("{}") }), null);
  assert.equal(calls.length, 0, "an app is never launched unless the wrapper set the variable");

  assert.deepEqual(readSafariExtensionState({ env, platform: "darwin", run: fake('{"enabled":true,"extension":"x"}\n') }), { enabled: true });
  assert.deepEqual(readSafariExtensionState({ env, platform: "darwin", run: fake('{"enabled":false}') }), { enabled: false });
  assert.deepEqual(calls.at(-1).args, ["--extension-state"]);
  assert.ok(calls.at(-1).opts.timeout > 0, "a hung app cannot hang doctor");

  assert.deepEqual(
    readSafariExtensionState({ env, platform: "darwin", run: fake('{"error":"SFErrorDomain error 1"}', { status: 1 }) }),
    { enabled: null, error: "SFErrorDomain error 1" }
  );
  assert.match(
    readSafariExtensionState({ env, platform: "darwin", run: fake("not json", { status: 3 }) }).error,
    /status 3/
  );
  assert.match(
    readSafariExtensionState({ env, platform: "darwin", run: fake("", { status: null, error: new Error("spawnSync ETIMEDOUT") }) }).error,
    /ETIMEDOUT/
  );
  assert.match(
    readSafariExtensionState({ env: { BROWSER_HAND_SAFARI_APP_BIN: "/nonexistent/Browser Hand" }, platform: "darwin", run: fake("{}") }).error,
    /not found/
  );
});

test("an empty default relay points at the relay that has a browser", () => {
  const other = { port: 19334, browser: { name: "Safari", version: "27.0.1" }, cli: "browser-hand-safari" };
  const out = classifyDevBrowserDoctor({ relayInfo: { extensionConnected: false }, otherRelay: other });
  assert.equal(out.status, "extension_disconnected");
  assert.match(out.action, /Safari is connected on 127\.0\.0\.1:19334; run browser-hand-safari/);
  assert.equal(otherRelayHint(null), "");
});

test("via names the browser, CLI and relay a command used", () => {
  const info = { extensionConnected: true, browser: { name: "Safari", version: "27.0.1" } };
  assert.equal(
    describeVia(info, { cli: "browser-hand-safari", host: "127.0.0.1", port: 19334 }),
    "Safari 27.0.1 via browser-hand-safari, relay 127.0.0.1:19334"
  );
  assert.equal(
    describeVia({ extensionConnected: false }, { cli: "browser-hand", host: "127.0.0.1", port: 9333 }),
    "no browser connected via browser-hand, relay 127.0.0.1:9333"
  );
  assert.equal(
    describeVia({ extensionConnected: true }, { cli: "browser-hand", host: "127.0.0.1", port: 9333 }),
    "unknown browser via browser-hand, relay 127.0.0.1:9333"
  );
  assert.equal(cliNameForEnv({ BROWSER_HAND_SAFARI_STANDALONE: "1" }), "browser-hand-safari");
  assert.equal(cliNameForEnv({}), "browser-hand");
});

test("via never names a browser from an earlier probe once the relay is gone", async () => {
  // Same process, two doctor calls: Safari answers the first, then the relay stops.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ extensionConnected: true, browser: { name: "Safari", version: "27" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const toolUrl = new URL("../src/tool.js", import.meta.url).href;
  const script = `
    const { default: tool } = await import(${JSON.stringify(toolUrl)});
    const first = await tool.handler({ mode: "current", operation: "doctor", timeoutMs: 3000 });
    process.stdout.write(JSON.stringify({ first: first.via }) + "\\n");
    await new Promise((r) => process.stdin.once("data", r));
    const second = await tool.handler({ mode: "current", operation: "doctor", timeoutMs: 3000 });
    process.stdout.write(JSON.stringify({ second: second.via ?? null, status: second.status }) + "\\n");
    process.exit(0);
  `;
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, DEV_BROWSER_RELAY_PORT: String(port), LOG_LEVEL: "error" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = [];
  let buffer = "";
  const done = new Promise((resolve) => child.on("exit", resolve));
  child.stdout.on("data", async (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      lines.push(line);
      if (line.first !== undefined) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        child.stdin.write("go\n");
      }
    }
  });
  await done;
  assert.match(lines[0].first, /^Safari 27 via browser-hand, relay 127\.0\.0\.1:/);
  assert.equal(lines[1].status, "relay_down");
  assert.equal(lines[1].second, null);
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
