/**
 * Gym comparison catalog and scoring — widget subset vs upstream
 * `dev-browser --headless`. Live Chrome is not required here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  GYM_COMPARE_SUBSET,
  DEFAULT_UPSTREAM_BIN,
  GYM_COMPARE_DRIVERS,
  parseCliArgs,
  puppeteerAriaSelector,
  gymOriginLooksHealthy,
  assertLoopbackOrigin,
  buildBrowserHandCommands,
  buildHeadlessScript,
  buildPlaywrightScript,
  cliErrorFromOutput,
  parseOracle,
  stepCount,
  summarizeComparison,
} from "../src/gym-compare.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGIN = "http://127.0.0.1:8766";

test("compare subset is the five widget challenges", () => {
  assert.deepEqual(
    GYM_COMPARE_SUBSET.map((item) => item.id),
    ["01", "08", "09", "16", "20"]
  );
  for (const item of GYM_COMPARE_SUBSET) {
    assert.match(item.file, new RegExp(`^${item.id}-`));
    assert.ok(item.pageName.startsWith("gym-"));
    assert.ok(item.steps.length >= 1);
  }
});

test("stepCount includes navigate, actions, and oracle", () => {
  const hello = GYM_COMPARE_SUBSET.find((item) => item.id === "01");
  assert.equal(stepCount(hello), 1 + hello.steps.length + 1);
});

test("stepCount ignores wait ops", () => {
  const combo = GYM_COMPARE_SUBSET.find((item) => item.id === "20");
  const waits = combo.steps.filter((step) => step.op === "wait").length;
  assert.equal(waits, 1);
  assert.equal(stepCount(combo), 1 + (combo.steps.length - waits) + 1);
});

test("GYM_COMPARE_DRIVERS includes puppeteer as a benchmark sibling", () => {
  assert.ok(GYM_COMPARE_DRIVERS.includes("playwright"));
  assert.ok(GYM_COMPARE_DRIVERS.includes("puppeteer"));
});

test("parseOracle reads ok from evaluate JSON and CLI wrappers", () => {
  assert.equal(parseOracle({ ok: true, checks: { submitted: true } }).ok, true);
  assert.equal(parseOracle('{"ok":false,"checks":{}}').ok, false);
  assert.equal(parseOracle({ result: '{"ok":true,"checks":{}}' }).ok, true);
  assert.equal(parseOracle({ result: { ok: true, checks: {} } }).ok, true);
  assert.equal(parseOracle({ success: true, result: { ok: false } }).ok, false);
  assert.equal(parseOracle('GYMCMP:{"ok":true,"checks":{}}').ok, true);
});

test("summarizeComparison tallies pass/fail and steps per driver", () => {
  const summary = summarizeComparison([
    { id: "01", driver: "browser-hand", ok: true, steps: 4 },
    { id: "01", driver: "dev-browser", ok: true, steps: 4 },
    { id: "20", driver: "browser-hand", ok: false, steps: 4 },
    { id: "20", driver: "dev-browser", ok: true, steps: 4 },
  ]);
  assert.deepEqual(summary.drivers["browser-hand"], {
    passed: 1,
    failed: 1,
    steps: 8,
    stdoutBytes: 0,
    approxTokens: 0,
  });
  assert.deepEqual(summary.drivers["dev-browser"], {
    passed: 2,
    failed: 0,
    steps: 8,
    stdoutBytes: 0,
    approxTokens: 0,
  });
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].id, "01");
  assert.equal(summary.rows[1]["dev-browser"].ok, true);
});

test("buildHeadlessScript uses getByLabel and prints GYMCMP oracle JSON", () => {
  const hello = GYM_COMPARE_SUBSET.find((item) => item.id === "01");
  const script = buildHeadlessScript(hello, ORIGIN);
  assert.match(script, /getPage\("gym-01"\)/);
  assert.match(script, /01-hello-form\.html/);
  assert.match(script, /getByLabel\("Full name"\)/);
  assert.match(script, /getByRole\("button", \{ name: "Send" \}\)/);
  assert.match(script, /GYMCMP:/);
  assert.match(script, /__oracle/);
});

test("buildHeadlessScript uses frameLocator for iframe-scoped steps", () => {
  const iframe = GYM_COMPARE_SUBSET.find((item) => item.id === "09");
  const script = buildHeadlessScript(iframe, ORIGIN);
  assert.match(script, /frameLocator\("#ticket-frame"\)/);
  assert.match(script, /getByLabel\("Ticket ID"\)/);
});

test("buildHeadlessScript clicks role=option for the listbox challenge", () => {
  const listbox = GYM_COMPARE_SUBSET.find((item) => item.id === "16");
  const script = buildHeadlessScript(listbox, ORIGIN);
  assert.match(script, /getByRole\("option", \{ name: "Pro" \}\)/);
  assert.match(script, /Confirm plan/);
});

test("cliErrorFromOutput prefers JSON error over stderr info logs", () => {
  assert.equal(
    cliErrorFromOutput(
      '{"success":false,"error":"No clickable element matched \\"JFK\\""}',
      "[browser-hand] info: running dev-browser current {}\n",
      1
    ),
    'No clickable element matched "JFK"'
  );
  assert.equal(cliErrorFromOutput("{}", "", 0), null);
});

test("buildBrowserHandCommands emit open, fill, click, evaluate", () => {
  const hello = GYM_COMPARE_SUBSET.find((item) => item.id === "01");
  const cmds = buildBrowserHandCommands(hello, ORIGIN);
  assert.equal(cmds[0][0], "open");
  assert.ok(cmds[0].includes("--page-name"));
  assert.ok(cmds[0].includes("gym-01"));
  const fill = cmds.find((cmd) => cmd[0] === "fill");
  assert.ok(fill);
  assert.ok(fill.includes("--fields"));
  assert.ok(cmds.some((cmd) => cmd[0] === "click" && cmd.includes("Send")));
  const evaluate = cmds.at(-1);
  assert.equal(evaluate[0], "evaluate");
  assert.match(evaluate.join(" "), /__oracle/);
});

test("buildPlaywrightScript is vanilla Playwright locators without getPage", () => {
  const hello = buildPlaywrightScript(GYM_COMPARE_SUBSET.find((item) => item.id === "01"), ORIGIN);
  assert.match(hello, /page\.goto\(/);
  assert.match(hello, /getByLabel\("Full name"\)/);
  assert.doesNotMatch(hello, /getPage\(/);
  const iframe = buildPlaywrightScript(GYM_COMPARE_SUBSET.find((item) => item.id === "09"), ORIGIN);
  assert.match(iframe, /frameLocator\("#ticket-frame"\)/);
});

test("DEFAULT_UPSTREAM_BIN points at this repo's bin/dev-browser.js", () => {
  assert.match(DEFAULT_UPSTREAM_BIN, /bin\/dev-browser\.js$/);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  assert.equal(DEFAULT_UPSTREAM_BIN, path.join(repoRoot, "bin/dev-browser.js"));
});

test("approxTokens stays a pure stdout-bytes/4 proxy", () => {
  assert.equal(Math.ceil(10 / 4), 3);
  // Script drivers must not inflate by counting generated input scripts.
  // summarizeComparison only sums row.stdoutBytes — keep that as stdout-only.
  const summary = summarizeComparison([
    { id: "01", driver: "playwright", ok: true, steps: 4, stdoutBytes: 100, approxTokens: 25 },
    { id: "01", driver: "browser-hand", ok: true, steps: 4, stdoutBytes: 100, approxTokens: 25 },
  ]);
  assert.equal(summary.drivers.playwright.stdoutBytes, 100);
  assert.equal(summary.drivers["browser-hand"].stdoutBytes, 100);
});

test("parseCliArgs rejects unknown drivers", () => {
  assert.throws(() => parseCliArgs(["--driver", "typo"]), /unsupported driver/i);
});

test("parseCliArgs all includes playwright", () => {
  assert.deepEqual(parseCliArgs(["--driver", "all"]).drivers, [...GYM_COMPARE_DRIVERS]);
});

test("parseCliArgs accepts puppeteer", () => {
  assert.deepEqual(parseCliArgs(["--driver", "puppeteer"]).drivers, ["puppeteer"]);
});

test("puppeteerAriaSelector uses aria/ locators (Puppeteer has no getByRole)", () => {
  assert.equal(puppeteerAriaSelector("Full name"), "aria/Full name");
  assert.equal(puppeteerAriaSelector("Send", "button"), 'aria/Send[role="button"]');
});

test("gymOriginLooksHealthy requires a known challenge marker", () => {
  assert.equal(gymOriginLooksHealthy(200, "<html><script>window.__CHALLENGE__={}</script></html>"), true);
  assert.equal(gymOriginLooksHealthy(200, "<html>unrelated</html>"), false);
  assert.equal(gymOriginLooksHealthy(404, "missing"), false);
});

test("assertLoopbackOrigin allows localhost and 127.0.0.1", () => {
  assert.equal(assertLoopbackOrigin("http://127.0.0.1:8766").hostname, "127.0.0.1");
  assert.equal(assertLoopbackOrigin("http://localhost:8766").hostname, "localhost");
});

test("assertLoopbackOrigin rejects non-loopback hosts", () => {
  assert.throws(() => assertLoopbackOrigin("http://example.com:8766"), /loopback/i);
  assert.throws(() => assertLoopbackOrigin("https://evil.test/"), /loopback/i);
});

test("assertLoopbackOrigin allows bracketed IPv6 loopback", () => {
  assert.equal(assertLoopbackOrigin("http://[::1]:8766").hostname, "[::1]");
});

test("buildBrowserHandCommands uses browserHandSteps when present", () => {
  const combo = GYM_COMPARE_SUBSET.find((item) => item.id === "20");
  const cmds = buildBrowserHandCommands(combo, ORIGIN);
  assert.ok(cmds.some((cmd) => cmd[0] === "fill"));
  assert.ok(!cmds.some((cmd) => cmd[0] === "click"), "BH must not re-click the already-selected option");
  assert.equal(stepCount(combo, { driver: "browser-hand" }), 1 + combo.browserHandSteps.length + 1);
  assert.equal(stepCount(combo), 1 + combo.steps.filter((step) => step.op !== "wait").length + 1);
});
