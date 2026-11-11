/**
 * Resolve the browser connected to the relay into a macOS app executable.
 * Callers pass the relay payload and the folders to scan. This module does
 * not open a network connection and does not assume /Applications.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NO_BROWSER =
  "No browser is connected to the relay. Enable the Browser Hand extension in the browser you want, then retry.";
const NO_NAME = "The connected extension did not report a browser name.";
const MACOS_ONLY = "browser-path resolves macOS apps only.";

/**
 * Search stubs chrome.debugger with "debugger.attach isn't available in Search"
 * while its extension user-agent still says Google Chrome. The stub names the
 * real host. Other debugger errors ("No tab with given id") do not.
 */
export function browserNameFromDebuggerReason(reason) {
  if (typeof reason !== "string") return null;
  const match = reason.match(/available in ([^.]+)$/i);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || name.toLowerCase() === "unknown") return null;
  return name;
}

/** Browser object the CLI should show and launch. The stub name wins. */
export function reportedHostBrowser(relayInfo) {
  if (!relayInfo || typeof relayInfo !== "object") return null;
  const reported =
    relayInfo.browser && typeof relayInfo.browser === "object" ? relayInfo.browser : null;
  const fromStub = browserNameFromDebuggerReason(relayInfo.debugger?.reason);
  if (!fromStub) return reported;
  if (!reported) return { name: fromStub, version: "" };
  return { ...reported, name: fromStub };
}

export function checkRelayBrowser(relayInfo, relayUrl) {
  if (relayInfo == null) {
    return { ok: false, message: `Browser Hand relay is not reachable at ${relayUrl}.` };
  }
  if (relayInfo.extensionConnected !== true) {
    return { ok: false, message: NO_BROWSER };
  }
  const fromStub = browserNameFromDebuggerReason(relayInfo.debugger?.reason);
  if (fromStub) return { ok: true, name: fromStub };
  const raw =
    relayInfo.browser && typeof relayInfo.browser.name === "string" ? relayInfo.browser.name : "";
  const name = raw.trim();
  if (!name || name.toLowerCase() === "unknown") {
    return { ok: false, message: NO_NAME };
  }
  return { ok: true, name };
}

function defaultReadPlist(bundlePath) {
  const plistPath = path.join(bundlePath, "Contents", "Info.plist");
  let stat;
  try {
    stat = fs.statSync(plistPath);
  } catch {
    return { ok: false };
  }
  if (!stat.isFile()) return { ok: false };
  const result = spawnSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string" || !result.stdout.trim()) {
    return { ok: false };
  }
  try {
    const json = JSON.parse(result.stdout);
    if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false };
    return { ok: true, plist: json };
  } catch {
    return { ok: false };
  }
}

function listAppBundles(dir) {
  if (!dir) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name.toLowerCase().endsWith(".app"))
    .map((entry) => path.resolve(dir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function sameName(field, name) {
  return typeof field === "string" && field.trim().toLowerCase() === name.trim().toLowerCase();
}

function bundleRealPath(bundlePath) {
  try {
    return fs.realpathSync(bundlePath);
  } catch {
    return bundlePath;
  }
}

function collectMatches(dir, name, readPlist) {
  const seen = new Set();
  const matches = [];
  for (const listed of listAppBundles(dir)) {
    const bundlePath = bundleRealPath(listed);
    if (seen.has(bundlePath)) continue;
    const filename = path.basename(listed).replace(/\.app$/i, "");
    const read = readPlist(listed);
    const plist = read.ok ? read.plist : null;
    const matched =
      sameName(filename, name) ||
      sameName(plist?.CFBundleName, name) ||
      sameName(plist?.CFBundleDisplayName, name);
    if (!matched) continue;
    // A non-matching alias shares this real path. Marking it seen before the
    // name check would hide the bundle whose filename actually matches.
    seen.add(bundlePath);
    matches.push({ bundlePath, plistOk: read.ok === true, plist });
  }
  return matches;
}

function executableMessage(bundlePath, executablePath) {
  return `Matched ${bundlePath}, but ${executablePath} is not executable.`;
}

function isExecutableFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBrowserExecutable({
  name,
  platform = process.platform,
  applicationsDir,
  homeApplicationsDir,
  readPlist = defaultReadPlist,
} = {}) {
  if (platform !== "darwin") {
    return { ok: false, message: MACOS_ONLY };
  }
  const trimmed = String(name ?? "").trim();
  const systemMatches = collectMatches(applicationsDir, trimmed, readPlist);
  const matches =
    systemMatches.length > 0
      ? systemMatches
      : collectMatches(homeApplicationsDir, trimmed, readPlist);
  if (matches.length === 0) {
    return {
      ok: false,
      message: `Connected browser is "${trimmed}", and no matching app was found in /Applications or ~/Applications.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: `Connected browser is "${trimmed}" and more than one app matches:\n${matches
        .map((match) => match.bundlePath)
        .join("\n")}`,
    };
  }
  const match = matches[0];
  if (!match.plistOk) {
    return {
      ok: false,
      message: `Matched ${match.bundlePath}, but its Info.plist could not be read.`,
    };
  }
  const exeName = match.plist?.CFBundleExecutable;
  if (
    typeof exeName !== "string" ||
    exeName.length === 0 ||
    exeName.includes("/") ||
    exeName.includes("..")
  ) {
    return {
      ok: false,
      message: `Matched ${match.bundlePath}, but its CFBundleExecutable is missing.`,
    };
  }
  const executablePath = path.join(match.bundlePath, "Contents", "MacOS", exeName);
  if (!isExecutableFile(executablePath)) {
    return { ok: false, message: executableMessage(match.bundlePath, executablePath) };
  }
  return { ok: true, name: trimmed, executablePath };
}
