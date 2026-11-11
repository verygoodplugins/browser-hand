/**
 * browser-path resolves the relay's connected browser to a macOS executable.
 * Fixtures stand in for /Applications. No live browser and no relay process.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkRelayBrowser, resolveBrowserExecutable } from "../src/browser-path.js";

const RELAY_URL = "http://127.0.0.1:9333";
const NO_BROWSER =
  "No browser is connected to the relay. Enable the Browser Hand extension in the browser you want, then retry.";
const NO_NAME = "The connected extension did not report a browser name.";

function plistXml({ bundleName, displayName, executable } = {}) {
  const rows = [];
  if (bundleName !== undefined) {
    rows.push(`<key>CFBundleName</key><string>${bundleName}</string>`);
  }
  if (displayName !== undefined) {
    rows.push(`<key>CFBundleDisplayName</key><string>${displayName}</string>`);
  }
  if (executable !== undefined) {
    rows.push(`<key>CFBundleExecutable</key><string>${executable}</string>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${rows.join("")}</dict></plist>
`;
}

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "browser-path-"));
}

/**
 * @param {string} root
 * @param {string} bundleFile Search.app
 * @param {{ bundleName?: string, displayName?: string, executable?: string, binary?: boolean, plist?: boolean }} [opts]
 */
function makeApp(root, bundleFile, opts = {}) {
  const executable = opts.executable === undefined ? "AppBin" : opts.executable;
  const app = path.join(root, bundleFile);
  const macos = path.join(app, "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  if (opts.plist !== false) {
    writeFileSync(
      path.join(app, "Contents", "Info.plist"),
      plistXml({
        bundleName: opts.bundleName,
        displayName: opts.displayName,
        executable,
      })
    );
  }
  const safeName =
    typeof executable === "string" &&
    executable.length > 0 &&
    !executable.includes("/") &&
    !executable.includes("..");
  if (opts.binary !== false && safeName) {
    const bin = path.join(macos, executable);
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, opts.mode ?? 0o755);
  }
  return app;
}

function real(filePath) {
  return realpathSync(filePath);
}

function resolveAt(name, applicationsDir, homeApplicationsDir, extra = {}) {
  return resolveBrowserExecutable({
    name,
    platform: "darwin",
    applicationsDir,
    homeApplicationsDir,
    ...extra,
  });
}

test("checkRelayBrowser reports an unreachable relay", () => {
  const result = checkRelayBrowser(null, RELAY_URL);
  assert.deepEqual(result, {
    ok: false,
    message: `Browser Hand relay is not reachable at ${RELAY_URL}.`,
  });
});

test("checkRelayBrowser reports when no extension is connected", () => {
  assert.equal(checkRelayBrowser({ extensionConnected: false }, RELAY_URL).message, NO_BROWSER);
  assert.equal(checkRelayBrowser({}, RELAY_URL).message, NO_BROWSER);
});

test("checkRelayBrowser reports a missing or Unknown browser name", () => {
  for (const relayInfo of [
    { extensionConnected: true },
    { extensionConnected: true, browser: null },
    { extensionConnected: true, browser: {} },
    { extensionConnected: true, browser: { name: "Unknown" } },
    { extensionConnected: true, browser: { name: " unknown " } },
    { extensionConnected: true, browser: { name: "   " } },
  ]) {
    assert.equal(
      checkRelayBrowser(relayInfo, RELAY_URL).message,
      NO_NAME,
      JSON.stringify(relayInfo)
    );
  }
});

test("checkRelayBrowser trims the connected browser name", () => {
  assert.deepEqual(
    checkRelayBrowser({ extensionConnected: true, browser: { name: " Search " } }, RELAY_URL),
    {
      ok: true,
      name: "Search",
    }
  );
});

test("checkRelayBrowser prefers the browser named by a chrome.debugger stub", () => {
  const result = checkRelayBrowser(
    {
      extensionConnected: true,
      browser: { name: "Google Chrome", version: "156.0.0.0" },
      debugger: { available: false, reason: "debugger.attach isn't available in Search" },
    },
    RELAY_URL
  );
  assert.deepEqual(result, { ok: true, name: "Search" });
});

test("checkRelayBrowser keeps the user-agent name when the debugger reason names no browser", () => {
  const result = checkRelayBrowser(
    {
      extensionConnected: true,
      browser: { name: "Google Chrome", version: "141.0.0.0" },
      debugger: { available: false, reason: "No tab with given id" },
    },
    RELAY_URL
  );
  assert.deepEqual(result, { ok: true, name: "Google Chrome" });
});

test("resolveBrowserExecutable matches the bundle filename ignoring case", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(applications, "Search.app", { executable: "Search" });
    const result = resolveAt("search", applications, home);
    assert.equal(result.ok, true);
    assert.equal(result.name, "search");
    assert.equal(
      result.executablePath,
      path.join(real(applications), "Search.app", "Contents", "MacOS", "Search")
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveBrowserExecutable matches CFBundleName", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(applications, "Other.app", { bundleName: "Search", executable: "Search" });
    const result = resolveAt("Search", applications, home);
    assert.equal(result.ok, true);
    assert.equal(
      result.executablePath,
      path.join(real(applications), "Other.app", "Contents", "MacOS", "Search")
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveBrowserExecutable matches CFBundleDisplayName", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(applications, "Other.app", { displayName: "Search", executable: "Search" });
    const result = resolveAt("Search", applications, home);
    assert.equal(result.ok, true);
    assert.equal(
      result.executablePath,
      path.join(real(applications), "Other.app", "Contents", "MacOS", "Search")
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a match in /Applications wins over the same name in ~/Applications", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(applications, "Search.app", { executable: "FromSystem" });
    makeApp(home, "Search.app", { executable: "FromHome" });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.executablePath,
      path.join(real(applications), "Search.app", "Contents", "MacOS", "FromSystem")
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("~/Applications is used only when /Applications has no match", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(home, "Search.app", { executable: "FromHome" });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.executablePath,
      path.join(real(home), "Search.app", "Contents", "MacOS", "FromHome")
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a failed /Applications match does not fall through to ~/Applications", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const app = makeApp(applications, "Search.app", { executable: "MissingBin", binary: false });
    makeApp(home, "Search.app", { executable: "FromHome" });
    const result = resolveAt("Search", applications, home);
    assert.equal(result.ok, false);
    assert.equal(
      result.message,
      `Matched ${real(app)}, but ${path.join(real(app), "Contents", "MacOS", "MissingBin")} is not executable.`
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an app nested inside another bundle is not a candidate", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const outer = makeApp(applications, "Outer.app", { executable: "Outer" });
    makeApp(path.join(outer, "Contents"), "Nested.app", {
      displayName: "Search",
      executable: "Nested",
    });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.message,
      'Connected browser is "Search", and no matching app was found in /Applications or ~/Applications.'
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("no matching app names the connected browser", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    makeApp(applications, "Other.app", { executable: "Other" });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.message,
      'Connected browser is "Search", and no matching app was found in /Applications or ~/Applications.'
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("several matches lists each bundle and does not pick one", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const alpha = makeApp(applications, "Alpha.app", {
      displayName: "Search",
      executable: "Alpha",
    });
    const beta = makeApp(applications, "Beta.app", { bundleName: "Search", executable: "Beta" });
    makeApp(home, "Search.app", { executable: "FromHome" });
    const result = resolveAt("Search", applications, home);
    assert.equal(result.ok, false);
    assert.match(result.message, /^Connected browser is "Search" and more than one app matches:\n/);
    assert.ok(result.message.includes(alpha));
    assert.ok(result.message.includes(beta));
    assert.equal(result.message.includes(path.join(home, "Search.app")), false);
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a filename match with an unreadable plist reports the plist", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const app = makeApp(applications, "Search.app", { plist: false, binary: false });
    const result = resolveAt("Search", applications, home);
    assert.equal(result.message, `Matched ${real(app)}, but its Info.plist could not be read.`);
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("two matches still win when one filename match has no plist", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const named = makeApp(applications, "Search.app", { plist: false, binary: false });
    const other = makeApp(applications, "Other.app", {
      displayName: "Search",
      executable: "Other",
    });
    const result = resolveAt("Search", applications, home);
    assert.match(result.message, /more than one app matches:/);
    assert.ok(result.message.includes(named));
    assert.ok(result.message.includes(other));
    assert.equal(result.message.includes("Info.plist"), false);
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a missing or unsafe CFBundleExecutable is rejected", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const missing = makeApp(applications, "Search.app", { executable: "" });
    assert.equal(
      resolveAt("Search", applications, home).message,
      `Matched ${real(missing)}, but its CFBundleExecutable is missing.`
    );
    rmSync(missing, { recursive: true, force: true });
    const unsafe = makeApp(applications, "Search.app", { executable: "../Outside" });
    assert.equal(
      resolveAt("Search", applications, home).message,
      `Matched ${real(unsafe)}, but its CFBundleExecutable is missing.`
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a missing executable file is rejected", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const app = makeApp(applications, "Search.app", { executable: "Search", binary: false });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.message,
      `Matched ${real(app)}, but ${path.join(real(app), "Contents", "MacOS", "Search")} is not executable.`
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a non-executable file is rejected", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const app = makeApp(applications, "Search.app", { executable: "Search", mode: 0o644 });
    const result = resolveAt("Search", applications, home);
    assert.equal(
      result.message,
      `Matched ${real(app)}, but ${path.join(real(app), "Contents", "MacOS", "Search")} is not executable.`
    );
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("symlink and target that are the same bundle count once", () => {
  const applications = makeRoot();
  const home = makeRoot();
  try {
    const app = makeApp(applications, "Search.app", { bundleName: "Search", executable: "Search" });
    symlinkSync(app, path.join(applications, "Link.app"));
    const result = resolveAt("Search", applications, home);
    assert.equal(result.ok, true);
    assert.equal(result.executablePath, path.join(real(app), "Contents", "MacOS", "Search"));
  } finally {
    rmSync(applications, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("linux resolves nothing and does not read fixtures", () => {
  const applications = makeRoot();
  let reads = 0;
  try {
    makeApp(applications, "Search.app", { executable: "Search" });
    const result = resolveBrowserExecutable({
      name: "Search",
      platform: "linux",
      applicationsDir: applications,
      homeApplicationsDir: applications,
      readPlist() {
        reads += 1;
        throw new Error("should not read");
      },
    });
    assert.deepEqual(result, { ok: false, message: "browser-path resolves macOS apps only." });
    assert.equal(reads, 0);
  } finally {
    rmSync(applications, { recursive: true, force: true });
  }
});

test("a missing applications directory is an empty scan", () => {
  const home = makeRoot();
  try {
    makeApp(home, "Search.app", { executable: "Search" });
    const result = resolveAt("Search", path.join(home, "no-such-applications"), home);
    assert.equal(result.ok, true);
    assert.equal(
      result.executablePath,
      path.join(real(home), "Search.app", "Contents", "MacOS", "Search")
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
