/**
 * browser-hand tool — drive the user's real Chrome via extension relay, or
 * sandboxed Playwright via the upstream headless `dev-browser` CLI.
 *
 * Current mode (default) uses the Browser Hand extension relay. It does not
 * require Chrome to be launched with --remote-debugging-port and should not
 * trigger Chrome's WebDriver automation banner.
 *
 * Headless mode keeps the upstream SawyerHood/dev-browser CLI path for QA and
 * unauthenticated automation.
 */

/* global WebSocket, getComputedStyle */

import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { ContextLogger } from "./logger.js";
import { substitutePlaceholders } from "./autofill.js";
import { buildAutofillProfilePlan } from "./autofill-profile.js";
import { loadAutofillFile, readKeychainSecret, readProfileSecret } from "./autofill-io.js";

const cl = new ContextLogger("browser-hand");

const AUTOFILL_PATH =
  process.env.BROWSER_HAND_AUTOFILL_PATH ||
  process.env.AUTOHUB_AUTOFILL_PATH ||
  path.join(homedir(), ".browser-hand", "autofill.json");
// Fall back to AutoHub autofill file if Browser Hand path is empty/missing.
const autofillData = (() => {
  const primary = loadAutofillFile(AUTOFILL_PATH);
  if (primary && Object.keys(primary).length) return primary;
  const legacy = path.join(homedir(), ".autohub", "autofill.json");
  if (legacy !== AUTOFILL_PATH) return loadAutofillFile(legacy);
  return primary;
})();
const secretCache = new Map();
const secureCache = new Map();

const DEFAULT_TIMEOUT_MS = 30000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const MAX_SCRIPT_BYTES = 64 * 1024;
const MAX_STDOUT_BYTES = 32 * 1024;
const MAX_STDERR_BYTES = 4 * 1024;
const MAX_CURRENT_TEXT_CHARS = 8000;
// How long to let the page react to a click before probing for a state change.
const CURRENT_RELAY_HOST = process.env.DEV_BROWSER_RELAY_HOST || process.env.HOST || "127.0.0.1";
const CURRENT_RELAY_PORT = Number(process.env.DEV_BROWSER_RELAY_PORT || process.env.PORT || 9333);
const CURRENT_RELAY_URL = `http://${CURRENT_RELAY_HOST}:${CURRENT_RELAY_PORT}`;
const DEFAULT_PAGE_NAME = process.env.DEV_BROWSER_PAGE_NAME || "browser-hand-current";
const SCREENSHOT_DIR =
  process.env.BROWSER_HAND_SCREENSHOT_DIR ||
  process.env.AUTOHUB_BROWSER_SCREENSHOT_DIR ||
  path.join(homedir(), ".browser-hand", "screenshots");
const RELAY_LOG_PATHS = [
  path.join(homedir(), ".browser-hand", `relay-${CURRENT_RELAY_PORT}.err`),
  path.join(homedir(), ".browser-hand", `relay-${CURRENT_RELAY_PORT}.out`),
  path.join(homedir(), ".dev-browser", `relay-${CURRENT_RELAY_PORT}.err`),
  path.join(homedir(), ".dev-browser", `relay-${CURRENT_RELAY_PORT}.out`),
];

let cachedBin = null;
let cachedRelayBin = null;
let relayProcess = null;
let relayStartAttempted = false;

export function normalizeDevBrowserMode(mode) {
  if (mode === "headless") {
    return "headless";
  }
  return "current";
}

export function redactSensitiveText(text, redactions = []) {
  if (typeof text !== "string" || redactions.length === 0) {
    return text;
  }
  let out = text;
  const unique = [...new Set(redactions)]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of unique) {
    out = out.split(value).join("[REDACTED]");
  }
  return out;
}

function redactSensitiveObject(value, redactions = []) {
  if (typeof value === "string") {
    return redactSensitiveText(value, redactions);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveObject(item, redactions));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, redactSensitiveObject(val, redactions)])
    );
  }
  return value;
}

export function isHttpPageTarget(item) {
  return Boolean(item && item.type === "page" && /^https?:\/\//i.test(String(item.url || "")));
}

function clipText(value, cap) {
  const text = String(value || "");
  if (text.length <= cap) return text;
  return `${text.slice(0, Math.max(0, cap - 3))}...`;
}

export function compactTarget(target = {}, { clip = false } = {}) {
  const compact = {
    id: target.targetId || target.id || "",
    title: clip ? clipText(target.title || "", 160) : String(target.title || ""),
    url: clip ? clipText(target.url || "", 220) : String(target.url || ""),
  };
  if (target.active === true) compact.active = true;
  if (target.focused === true) compact.focused = true;
  if (target.windowId != null && target.windowId !== "") compact.windowId = target.windowId;
  return compact;
}

export function rankTabTargets(targets = []) {
  return [...targets].sort((a, b) => {
    const score = (item) => (item?.focused === true ? 2 : 0) + (item?.active === true ? 1 : 0);
    return score(b) - score(a);
  });
}

export function filterTabTargets(targets = [], query = {}) {
  let pages = (targets || []).filter(isHttpPageTarget);
  const idNeedle = query.id ? String(query.id) : "";
  const urlNeedle = query.url ? String(query.url).toLowerCase() : "";
  const titleNeedle = query.title ? String(query.title).toLowerCase() : "";
  const textNeedle = query.query ? String(query.query).toLowerCase() : "";
  const nameNeedle = query.name ? String(query.name).toLowerCase() : "";
  if (idNeedle) {
    pages = pages.filter((item) => item.targetId === idNeedle || item.id === idNeedle);
  }
  if (urlNeedle) {
    pages = pages.filter((item) =>
      String(item.url || "")
        .toLowerCase()
        .includes(urlNeedle)
    );
  }
  if (titleNeedle) {
    pages = pages.filter((item) =>
      String(item.title || "")
        .toLowerCase()
        .includes(titleNeedle)
    );
  }
  if (textNeedle) {
    pages = pages.filter((item) => {
      const haystack = `${item.title || ""} ${item.url || ""}`.toLowerCase();
      return haystack.includes(textNeedle);
    });
  }
  if (nameNeedle) {
    pages = pages.filter((item) => {
      const haystack = `${item.title || ""} ${item.url || ""}`.toLowerCase();
      return haystack.includes(nameNeedle);
    });
  }
  return pages;
}

export function summarizeTabInventory(targets = [], query = {}) {
  const pages = rankTabTargets(filterTabTargets(targets, query));
  const focused = pages.find((item) => item.focused === true);
  const actives = pages.filter((item) => item.active === true);
  const current = focused || (actives.length === 1 ? actives[0] : null);
  return {
    targetCount: (targets || []).length,
    tabCount: pages.length,
    truncated: false,
    active: current ? compactTarget(current, { clip: true }) : null,
    tabs: pages.map((item) => compactTarget(item, { clip: true })),
  };
}

export function formatTargetCandidates(targets = []) {
  return (targets || [])
    .map((item) => {
      const flags = [
        item?.focused === true ? "focused" : null,
        item?.active === true ? "active" : null,
      ].filter(Boolean);
      const flagText = flags.length > 0 ? `[${flags.join(",")}]` : "";
      return `${item?.targetId || item?.id || "unknown"}${flagText} ${item?.title || ""} ${item?.url || ""}`.trim();
    })
    .join(" | ");
}

export async function selectCurrentTarget(targets = [], opts = {}) {
  const target = opts.target && typeof opts.target === "object" ? opts.target : {};
  const pages = filterTabTargets(targets);

  if (pages.length === 0) {
    throw new Error("No http(s) Chrome tabs are available through Browser Hand");
  }

  const explicit = Boolean(target.id || target.url || target.title || target.name || target.query);
  let candidates = pages;

  if (target.id) {
    candidates = candidates.filter((item) => item.targetId === target.id);
  }
  if (target.url) {
    const needle = String(target.url).toLowerCase();
    candidates = candidates.filter((item) =>
      String(item.url || "")
        .toLowerCase()
        .includes(needle)
    );
  }
  if (target.title) {
    const needle = String(target.title).toLowerCase();
    candidates = candidates.filter((item) =>
      String(item.title || "")
        .toLowerCase()
        .includes(needle)
    );
  }
  if (target.name) {
    const needle = String(target.name).toLowerCase();
    candidates = candidates.filter((item) => {
      const haystack = `${item.title || ""} ${item.url || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }
  if (target.query) {
    const needle = String(target.query).toLowerCase();
    candidates = candidates.filter((item) => {
      const haystack = `${item.title || ""} ${item.url || ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  if (explicit) {
    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length === 0) {
      throw new Error(`No Chrome tab matched target ${JSON.stringify(target)}`);
    }
    throw new Error(
      `Ambiguous Chrome tab target ${JSON.stringify(target)} matched ${candidates.length} tabs: ${formatTargetCandidates(candidates)}`
    );
  }

  if (target.strategy === "first") {
    return pages[0];
  }

  const focused = pages.filter((page) => page.focused === true);
  if (focused.length === 1) {
    return focused[0];
  }

  const active = pages.filter((page) => page.active === true);
  if (active.length === 1) {
    return active[0];
  }
  if (pages.length === 1) {
    return pages[0];
  }

  throw new Error(
    `Ambiguous current Chrome tab: no last-focused http(s) tab was detected. Use \`browser-hand tabs\` or pass --query / --target-url / --target-id. Candidates: ${formatTargetCandidates(pages)}`
  );
}

function resolveBin() {
  if (cachedBin !== null) {
    return cachedBin;
  }
  const explicit = process.env.DEV_BROWSER_BIN;
  if (explicit) {
    cachedBin = explicit;
    return cachedBin;
  }
  const which = spawnSync("which", ["dev-browser"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout) {
    cachedBin = which.stdout.trim() || "dev-browser";
  } else {
    cachedBin = "dev-browser";
  }
  return cachedBin;
}

function resolveRelayBin() {
  if (cachedRelayBin !== null) {
    return cachedRelayBin;
  }
  const explicit = process.env.BROWSER_HAND_RELAY_BIN || process.env.DEV_BROWSER_MCP_BIN;
  if (explicit) {
    cachedRelayBin = explicit;
    return cachedRelayBin;
  }

  // Prefer the monorepo relay package (cli-js/../relay).
  try {
    const here = fileURLToPath(import.meta.url);
    const monorepoRelay = path.resolve(
      path.dirname(here),
      "..",
      "..",
      "relay",
      "dist",
      "standalone.js"
    );
    if (existsSync(monorepoRelay)) {
      cachedRelayBin = monorepoRelay;
      return cachedRelayBin;
    }
  } catch {
    // ignore
  }

  for (const name of ["browser-hand-relay", "dev-browser-mcp"]) {
    const which = spawnSync("which", [name], { encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) {
      cachedRelayBin = which.stdout.trim();
      return cachedRelayBin;
    }
  }
  cachedRelayBin = null;
  return cachedRelayBin;
}

function truncate(buf, cap) {
  if (buf.length <= cap) {
    return { text: buf, truncated: false };
  }
  const elided = buf.length - cap;
  return {
    text: `${buf.slice(0, cap)}\n[TRUNCATED - ${elided} bytes elided]\n`,
    truncated: true,
  };
}

function runDevBrowser({ payload, mode, browserName, timeoutMs }) {
  return new Promise((resolve) => {
    const args = [];
    if (mode === "headless") {
      args.push("--headless");
    }
    if (browserName) {
      args.push("--browser", browserName);
    }

    const bin = resolveBin();
    const start = Date.now();

    let child;
    try {
      child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      resolve({
        success: false,
        error: `Failed to spawn dev-browser: ${err.message}. Install with: npm install -g dev-browser@0.2.7 && dev-browser install`,
        spawnError: true,
        durationMs: Date.now() - start,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnFailed = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // already dead
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 2000);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT_BYTES * 2) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES * 2) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      spawnFailed = true;
      resolve({
        success: false,
        error: `Failed to launch dev-browser: ${err.message}. Install with: npm install -g dev-browser@0.2.7 && dev-browser install`,
        spawnError: true,
        durationMs: Date.now() - start,
      });
    });

    child.on("close", (code) => {
      if (spawnFailed) {
        return;
      }
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const out = truncate(stdout, MAX_STDOUT_BYTES);
      const err = truncate(stderr, MAX_STDERR_BYTES);

      if (timedOut) {
        resolve({
          success: false,
          error: `dev-browser timed out after ${timeoutMs}ms`,
          exitCode: null,
          stdout: out.text,
          stderr: err.text,
          truncated: { stdout: out.truncated, stderr: err.truncated },
          timedOut: true,
          durationMs,
        });
        return;
      }

      resolve({
        success: code === 0,
        exitCode: code,
        stdout: out.text,
        stderr: err.text,
        truncated: { stdout: out.truncated, stderr: err.truncated },
        ...(code !== 0 ? { error: `dev-browser exited with code ${code}` } : {}),
        durationMs,
      });
    });

    try {
      child.stdin.write(payload);
      child.stdin.end();
    } catch (err) {
      cl.warn("stdin write failed", { error: err.message });
    }
  });
}

async function fetchJson(url, { timeoutMs = 800, ...init } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function probeRelay(timeoutMs = 800) {
  try {
    return await fetchJson(CURRENT_RELAY_URL, { timeoutMs });
  } catch {
    return null;
  }
}

function relayPageEndpoint(name) {
  return `${CURRENT_RELAY_URL}/pages${name ? `/${encodeURIComponent(name)}` : ""}`;
}

async function lookupNamedRelayPage(pageName, { timeoutMs = 5000 } = {}) {
  if (!pageName || typeof pageName !== "string") {
    return null;
  }
  try {
    return await fetchJson(relayPageEndpoint(pageName), { timeoutMs });
  } catch (err) {
    if (/HTTP 404\b|No named page/i.test(String(err.message || ""))) {
      return null;
    }
    throw err;
  }
}

async function openNamedRelayPage(pageName, { timeoutMs = 5000, targetId } = {}) {
  if (!pageName || typeof pageName !== "string") {
    throw new Error("pageName is required for named-page bootstrap");
  }
  const body = { name: pageName };
  if (typeof targetId === "string" && targetId.trim()) {
    body.targetId = targetId.trim();
  }
  return await fetchJson(relayPageEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
  });
}

async function deleteNamedRelayPage(pageName, { timeoutMs = 1000 } = {}) {
  if (!pageName || typeof pageName !== "string") {
    return null;
  }
  try {
    return await fetchJson(relayPageEndpoint(pageName), {
      method: "DELETE",
      timeoutMs,
    });
  } catch {
    return null;
  }
}

async function listNamedRelayPages(timeoutMs = 1000) {
  try {
    return await fetchJson(relayPageEndpoint(), { timeoutMs });
  } catch (err) {
    return { error: err.message };
  }
}

function hasHttpTargets(targets = []) {
  return targets.some(
    (item) => item && item.type === "page" && /^https?:\/\//i.test(String(item.url || ""))
  );
}

// pageName-aware operations. Explicit pageName attaches to (or creates) a
// named relay tab for the full agent write path — not only read ops.
// Without an explicit pageName, fill/click/type still use existing_target
// selection so we do not silently mint tabs.
const PAGE_NAME_OPERATIONS = new Set(["open", "goto", "snapshot", "screenshot", "evaluate"]);

// Acting operations attach to an existing named tab but must never create one.
// Creating a blank tab to click in is meaningless — a typo'd pageName used to
// mint an empty tab and then report "No clickable element matched" from it.
const PAGE_NAME_ATTACH_ONLY_OPERATIONS = new Set([
  "fill_fields",
  "click",
  "type",
  "autofill_profile",
  "focus",
]);

const BATCHABLE_OPERATIONS = new Set([
  "open",
  "goto",
  "snapshot",
  "screenshot",
  "evaluate",
  "fill_fields",
  "click",
  "type",
  "autofill_profile",
  "focus",
  "wait",
]);

const STEP_OP_ALIASES = {
  fill: "fill_fields",
  "fill-fields": "fill_fields",
  "autofill-profile": "autofill_profile",
  shot: "screenshot",
};

const MAX_BATCH_STEPS = 32;
const NAV_READY_TIMEOUT_MS = 8000;

export function parseBatchSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("batch requires a non-empty --steps JSON array");
  }
  if (steps.length > MAX_BATCH_STEPS) {
    throw new Error(`batch is limited to ${MAX_BATCH_STEPS} steps`);
  }
  return steps.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`batch step ${index} must be an object`);
    }
    const operation = STEP_OP_ALIASES[step.operation] || step.operation;
    if (!BATCHABLE_OPERATIONS.has(operation)) {
      throw new Error(`operation ${JSON.stringify(step.operation)} is not batchable`);
    }
    if (operation === "fill_fields") {
      const fields = step.fields;
      if (
        fields === null ||
        typeof fields !== "object" ||
        Array.isArray(fields)
      ) {
        throw new Error(
          `batch step ${index}: fields must be a JSON object map of label→value (e.g. {"Email":"a@b.c"}), not ${fields === null ? "null" : Array.isArray(fields) ? "an array" : typeof fields}`
        );
      }
    }
    return { ...step, operation };
  });
}

const FOCUS_POLICIES = new Set(["background", "tab", "window"]);

/**
 * One-shot human-in-the-loop focus. Sets extension override then activateTarget.
 * Default popup policy stays background; override is consume-on-use + TTL.
 */
export async function applyAgentFocus(cdp, sessionId, selected, input = {}) {
  const raw = input.focusPolicy || input.focus;
  if (raw === undefined || raw === null || raw === false || raw === "") {
    return null;
  }
  const policy = raw === true ? "window" : String(raw);
  if (!FOCUS_POLICIES.has(policy)) {
    throw new Error(`Invalid focusPolicy "${policy}". Use background|tab|window.`);
  }
  if (policy === "background") {
    await cdp.send("DevBrowser.clearFocusOverride", {}, sessionId).catch(() => null);
    return { policy: "background", applied: false };
  }

  const reason =
    typeof input.focusReason === "string"
      ? input.focusReason
      : typeof input.reason === "string"
        ? input.reason
        : "";
  const ttlMs =
    typeof input.focusTtlMs === "number" && Number.isFinite(input.focusTtlMs)
      ? input.focusTtlMs
      : 120_000;

  await cdp.send(
    "DevBrowser.setFocusOverride",
    {
      policy,
      reason: reason || undefined,
      ttlMs,
      consumeOnUse: true,
    },
    sessionId
  );
  await cdp.send("Target.activateTarget", { targetId: selected.targetId }, sessionId);
  return {
    policy,
    reason: reason || undefined,
    applied: true,
    targetId: selected.targetId,
  };
}

export function planCurrentTargetAccess({ operation, pageName, targets = [] }) {
  if (operation === "open" || (operation === "goto" && pageName)) {
    return {
      source: "named_page",
      pageName: pageName || DEFAULT_PAGE_NAME,
      createsTab: true,
    };
  }
  if (operation === "goto" && !pageName && !hasHttpTargets(targets)) {
    return {
      source: "named_page",
      pageName: DEFAULT_PAGE_NAME,
      createsTab: true,
    };
  }
  if (
    pageName &&
    (PAGE_NAME_OPERATIONS.has(operation) || PAGE_NAME_ATTACH_ONLY_OPERATIONS.has(operation))
  ) {
    return { source: "named_page", pageName, createsTab: false };
  }
  return { source: "existing_target", createsTab: false };
}

export function findAdoptTarget(targets, url) {
  if (!url || !Array.isArray(targets)) {
    return null;
  }
  const normalize = (value) => String(value || "").replace(/\/$/, "");
  const wanted = normalize(url);
  if (!wanted || wanted === "about:blank" || wanted === "about:newtab") {
    return null;
  }
  const hits = targets.filter((target) => {
    const candidate = normalize(target?.url);
    if (!candidate || candidate === "about:blank" || candidate === "about:newtab") {
      return false;
    }
    return candidate === wanted;
  });
  return hits.length === 1 ? hits[0] : null;
}

export function namedPageNotFoundMessage(pageName, namedPageCount) {
  const count = Number.isFinite(namedPageCount) ? namedPageCount : 0;
  const noun = count === 1 ? "page" : "pages";
  return (
    `No named page "${pageName}" is open (${count} named ${noun} in the relay). ` +
    `Run open --page-name first, or doctor --verbose to list them.`
  );
}

export async function resolveNamedPageInfo({
  plan,
  pageName,
  url,
  targets = [],
  openPage,
  lookupPage,
}) {
  if (!plan || plan.source !== "named_page") {
    return null;
  }
  if (plan.createsTab) {
    const adopt = url ? findAdoptTarget(targets, url) : null;
    return openPage(pageName, adopt?.targetId ? { targetId: adopt.targetId } : {});
  }
  return lookupPage(pageName);
}

export function classifyDevBrowserDoctor({
  relayInfo,
  recentExtensionDisconnected = false,
  targetCount = 0,
  smoke = null,
} = {}) {
  if (!relayInfo) {
    return {
      status: "relay_down",
      action: `Start the Browser Hand relay: npm run relay  (or browser-hand relay) on ${CURRENT_RELAY_HOST}:${CURRENT_RELAY_PORT}.`,
    };
  }
  if (relayInfo.extensionConnected !== true) {
    if (recentExtensionDisconnected) {
      return {
        status: "extension_asleep",
        action:
          "Click the Browser Hand Chrome toolbar icon once to wake the MV3 service worker, then rerun doctor.",
      };
    }
    return {
      status: "extension_disconnected",
      action: `Enable the Browser Hand Chrome extension (Load unpacked → extension/dist/chrome-mv3) and confirm it points to ws://${CURRENT_RELAY_HOST}:${CURRENT_RELAY_PORT}/extension.`,
    };
  }
  if (smoke?.success === true) {
    return {
      status: "tab_bootstrap_works",
      action: "Browser Hand is healthy. Run authenticated work through the extension relay.",
    };
  }
  if (/Extension connection replaced/i.test(String(smoke?.error || ""))) {
    return {
      status: "extension_unstable",
      action:
        "Reload the Browser Hand extension; the extension socket reconnected during tab creation, so retrying browser work will be flaky until the worker is stable.",
    };
  }
  if (targetCount === 0) {
    return {
      status: "target_registry_empty",
      action:
        "Reload the Browser Hand extension in the same Chrome profile and verify site/access permissions; target creation is not reaching the relay registry.",
    };
  }
  return {
    status: "path_b_required",
    action:
      "Browser Hand can see existing tabs but cannot create a named tab. Use an already-open tab for read-only work, or a separately logged-in non-default debug profile (upstream headless / --connect) for workflows requiring tab bootstrap.",
  };
}

async function readRecentRelayLogs() {
  const chunks = [];
  for (const logPath of RELAY_LOG_PATHS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const text = await readFile(logPath, "utf8");
      chunks.push(text.slice(-4000));
    } catch {
      // Missing logs should not fail doctor.
    }
  }
  return chunks.join("\n");
}

function startRelayProcess() {
  if (relayProcess && !relayProcess.killed) {
    return;
  }
  if (relayStartAttempted) {
    return;
  }

  const bin = resolveRelayBin();
  if (!bin) {
    throw new Error(
      "Browser Hand relay is not installed. Build the monorepo relay (`npm run build:relay` or `cd relay && npm run build`) or set BROWSER_HAND_RELAY_BIN."
    );
  }

  relayStartAttempted = true;
  const args = bin.endsWith(".js") || bin.endsWith(".mjs") ? [bin] : [];
  const command = args.length > 0 ? process.execPath : bin;
  const env = {
    ...process.env,
    HOST: CURRENT_RELAY_HOST,
    PORT: String(CURRENT_RELAY_PORT),
    RELAY_MODE: process.env.DEV_BROWSER_RELAY_MODE || "auto",
  };

  relayProcess = spawn(command, args, {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  relayProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) {
      cl.info("dev-browser relay", { message: text.slice(0, 500) });
    }
  });
  relayProcess.on("error", (err) => {
    cl.warn("dev-browser relay failed to start", { error: err.message });
  });
  relayProcess.on("close", (code) => {
    if (relayProcess) {
      cl.warn("dev-browser relay exited", { code });
    }
    relayProcess = null;
    relayStartAttempted = false;
  });
}

// Start a long-lived relay on the configured host/port and block until it
// exits. The per-call relay (startRelayProcess) dies with the CLI invocation
// that spawned it, so at idle there is nothing on :9333 and the Chrome
// extension sits on "connecting…" — it reconnects on an interval and keeps
// missing the brief window the ephemeral relay is alive. A persistent relay
// gives the extension a stable endpoint. Idempotent: returns early if a relay
// is already listening.
export async function startPersistentRelay() {
  const existing = await probeRelay(1000);
  if (existing) {
    return {
      alreadyRunning: true,
      extensionConnected: existing.extensionConnected === true,
      url: CURRENT_RELAY_URL,
    };
  }

  const bin = resolveRelayBin();
  if (!bin) {
    throw new Error(
      "Browser Hand relay is not installed. Build the monorepo relay (`npm run build:relay` or `cd relay && npm run build`) or set BROWSER_HAND_RELAY_BIN."
    );
  }

  const args = bin.endsWith(".js") || bin.endsWith(".mjs") ? [bin] : [];
  const command = args.length > 0 ? process.execPath : bin;
  const env = {
    ...process.env,
    HOST: CURRENT_RELAY_HOST,
    PORT: String(CURRENT_RELAY_PORT),
    RELAY_MODE: process.env.DEV_BROWSER_RELAY_MODE || "auto",
  };

  const child = spawn(command, args, {
    stdio: ["ignore", "inherit", "inherit"],
    env,
  });

  const forward = (sig) => {
    try {
      child.kill(sig);
    } catch {
      // already dead
    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ started: true, exitCode: code ?? 0, url: CURRENT_RELAY_URL })
    );
  });
}

async function ensureRelayConnected(timeoutMs) {
  let info = await probeRelay();
  if (!info) {
    startRelayProcess();
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Polling must be sequential so we do not pile up relay probes.
    // eslint-disable-next-line no-await-in-loop
    info = await probeRelay(1200);
    if (info?.wsEndpoint && info.extensionConnected === true) {
      return info;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(250);
  }

  if (info?.wsEndpoint && info.extensionConnected !== true) {
    throw new Error(
      `Browser Hand relay is running at ${CURRENT_RELAY_URL}, but the Chrome extension is not connected. Enable the Browser Hand extension (extension/dist/chrome-mv3) and confirm it points to ws://${CURRENT_RELAY_HOST}:${CURRENT_RELAY_PORT}/extension.`
    );
  }

  throw new Error(
    `Browser Hand relay did not start at ${CURRENT_RELAY_URL}. Build/start browser-hand relay or set BROWSER_HAND_RELAY_BIN.`
  );
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Set();
    this.connectPromise = null;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const onOpen = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        resolve();
      };
      const onError = (event) => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        const err = new Error(`CDP WebSocket error connecting to ${this.wsUrl}: ${String(event)}`);
        this.failAll(err);
        this.ws = null;
        reject(err);
      };
      const onClose = () => {
        const err = new Error(`CDP WebSocket closed: ${this.wsUrl}`);
        this.failAll(err);
        this.ws = null;
      };
      const onMessage = (event) => {
        try {
          this.handleMessage(JSON.parse(String(event.data)));
        } catch (err) {
          cl.warn("CDP parse error", { error: err.message });
        }
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("message", onMessage);
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async send(method, params, sessionId) {
    await this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`CDP not connected to ${this.wsUrl}`);
    }
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const payload = { id, method };
    if (params !== undefined) {
      payload.params = params;
    }
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    this.ws.send(JSON.stringify(payload));
    return await promise;
  }

  waitForEvent(method, { sessionId, timeoutMs }) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const handler = (event) => {
        if (event.method !== method) {
          return;
        }
        if (sessionId && event.sessionId !== sessionId) {
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      };
      const unsubscribe = this.onEvent(handler);
    });
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // already closed
      }
    }
    this.ws = null;
  }

  failAll(err) {
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  handleMessage(msg) {
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.id);
      if (msg.error?.message) {
        pending.reject(new Error(msg.error.message));
        return;
      }
      pending.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      const event = {
        method: msg.method,
        sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined,
        params: msg.params,
      };
      for (const handler of this.eventHandlers) {
        handler(event);
      }
    }
  }
}

export async function navigateAndWait(cdp, sessionId, url, timeoutMs) {
  const waitMs = Math.min(
    Math.max(
      250,
      typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : NAV_READY_TIMEOUT_MS
    ),
    NAV_READY_TIMEOUT_MS
  );
  // Subscribe before navigate so a fast load is not missed. Wait for `load`
  // (not DOMContentLoaded) so same-origin iframes finish — gym challenge 09
  // fills inside a frame that is not in the parent DCL snapshot.
  const ready = cdp
    .waitForEvent("Page.loadEventFired", { sessionId, timeoutMs: waitMs })
    .catch(() => null);
  const navResult = await cdp.send("Page.navigate", { url }, sessionId);
  await ready;
  return navResult;
}

async function attachTarget(cdp, targetId) {
  const tryOnce = async () => {
    const attach = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = attach?.sessionId;
    if (!sessionId) {
      throw new Error(`Failed to attach to Chrome tab ${targetId}`);
    }
    await cdp.send("Runtime.enable", undefined, sessionId);
    await cdp.send("Page.enable", undefined, sessionId);
    await cdp.send("DOM.enable", undefined, sessionId);
    return sessionId;
  };

  try {
    return await tryOnce();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // After username autofill soft-detach, first Runtime.enable can fail with
    // chrome-extension:// cross-extension errors. Brief wait + retry.
    if (/chrome-extension:\/\//i.test(message) || /not found in connected/i.test(message)) {
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
      return await tryOnce();
    }
    throw err;
  }
}

async function runtimeEvaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId
  );
  if (result?.exceptionDetails) {
    const err =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      "Runtime.evaluate exception";
    throw new Error(err);
  }
  return result;
}

async function evalValue(cdp, sessionId, expression) {
  const result = await runtimeEvaluate(cdp, sessionId, expression);
  if (Object.prototype.hasOwnProperty.call(result?.result || {}, "value")) {
    return result.result.value;
  }
  if (typeof result?.result?.description === "string") {
    return result.result.description;
  }
  return result?.result ?? null;
}

/** pageName → last known real http(s) target (survives relay about:blank churn).
 *  Persisted under ~/.autohub so each CLI process (one shot) can reuse it. */
const NAMED_PAGE_CACHE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".autohub",
  "named-page-targets.json"
);

function isBlankUrl(url) {
  return !url || url === "about:blank" || url === "about:newtab";
}

function loadNamedPageTargetCache() {
  try {
    const raw = readFileSync(NAMED_PAGE_CACHE_PATH, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveNamedPageTargetCache(cache) {
  try {
    mkdirSync(path.dirname(NAMED_PAGE_CACHE_PATH), { recursive: true });
    writeFileSync(NAMED_PAGE_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // best-effort
  }
}

function getCachedNamedPage(pageName) {
  const cache = loadNamedPageTargetCache();
  return cache[pageName] || null;
}

function setCachedNamedPage(pageName, entry) {
  const cache = loadNamedPageTargetCache();
  cache[pageName] = {
    ...entry,
    updatedAt: new Date().toISOString(),
  };
  saveNamedPageTargetCache(cache);
}

async function selectOrOpenCurrentTarget({ cdp, input, operation, targets }) {
  const plan = planCurrentTargetAccess({
    operation,
    pageName: input.pageName,
    targets,
  });
  if (plan.source === "named_page") {
    // Attach-only operations resolve an existing named tab; they must not
    // conjure a blank one to act on. Checking the page list first would be
    // check-then-create — the tab can close in the gap — so instead let the
    // single create/get call report which it did, and undo a creation.
    const pageInfo = await resolveNamedPageInfo({
      plan,
      pageName: plan.pageName,
      url: input.url,
      targets,
      openPage: (name, options) => openNamedRelayPage(name, options),
      lookupPage: (name) => lookupNamedRelayPage(name),
    });
    if (!pageInfo) {
      const known = await listNamedRelayPages();
      const count = Array.isArray(known?.pages) ? known.pages.length : 0;
      throw new Error(namedPageNotFoundMessage(plan.pageName, count));
    }
    let selected = {
      targetId: pageInfo.targetId,
      title: pageInfo.title || "",
      url: pageInfo.url || "",
      pageName: plan.pageName,
    };

    // When username autofill / debugger soft-detach causes the relay to mint a
    // fresh about:blank under the same pageName, prefer the last known http tab.
    const cached = getCachedNamedPage(plan.pageName);
    let preferCached = false;
    if (
      cached &&
      isBlankUrl(selected.url) &&
      !isBlankUrl(cached.url) &&
      cached.targetId &&
      cached.targetId !== selected.targetId
    ) {
      preferCached = true;
      const live = (targets || []).find((t) => t && t.targetId === cached.targetId);
      selected = {
        targetId: cached.targetId,
        title: (live && live.title) || cached.title || "",
        url: (live && live.url) || cached.url,
        pageName: plan.pageName,
      };
    }

    if (!isBlankUrl(selected.url)) {
      setCachedNamedPage(plan.pageName, {
        targetId: selected.targetId,
        url: selected.url,
        title: selected.title,
      });
    }

    let sessionId;
    try {
      sessionId = await attachTarget(cdp, selected.targetId);
    } catch (attachErr) {
      // Cached target vanished from the relay registry (hard debugger detach).
      // Fall back to the blank tab the relay just minted and re-navigate.
      if (preferCached && cached && !isBlankUrl(cached.url)) {
        selected = {
          targetId: pageInfo.targetId,
          title: pageInfo.title || "",
          url: pageInfo.url || "",
          pageName: plan.pageName,
        };
        sessionId = await attachTarget(cdp, selected.targetId);
        await navigateAndWait(cdp, sessionId, cached.url, 15000);
        selected.url = cached.url;
        setCachedNamedPage(plan.pageName, {
          targetId: selected.targetId,
          url: cached.url,
          title: selected.title || cached.title || "",
        });
      } else {
        throw attachErr;
      }
    }

    return {
      plan,
      selected,
      sessionId,
    };
  }

  const selected = await selectCurrentTarget(targets, {
    target: input.target,
    evaluateFocus: async (target) => {
      const sessionId = await attachTarget(cdp, target.targetId);
      return Boolean(await evalValue(cdp, sessionId, "(() => document.hasFocus())()"));
    },
  });
  return {
    plan,
    selected,
    sessionId: await attachTarget(cdp, selected.targetId),
  };
}

async function runCurrentDoctor(timeoutMs) {
  const relayInfo = await probeRelay(1000);
  const logs = await readRecentRelayLogs();
  const recentExtensionDisconnected = /\bExtension disconnected\b/i.test(logs);
  const pages = relayInfo ? await listNamedRelayPages(1000) : null;
  const result = {
    success: false,
    mode: "current",
    operation: "doctor",
    relay: {
      url: CURRENT_RELAY_URL,
      reachable: Boolean(relayInfo),
      extensionConnected: relayInfo?.extensionConnected === true,
      mode: relayInfo?.mode || null,
    },
    pages,
    targetCount: 0,
    targets: [],
    smoke: null,
    recentExtensionDisconnected,
  };

  if (relayInfo?.wsEndpoint && relayInfo.extensionConnected === true) {
    const cdp = new CdpClient(relayInfo.wsEndpoint);
    const smokeName = `autohub-doctor-${Date.now()}`;
    try {
      const targetResult = await cdp.send("Target.getTargets");
      const targets = targetResult?.targetInfos || [];
      const inventory = summarizeTabInventory(targets);
      result.targetCount = inventory.targetCount;
      result.tabCount = inventory.tabCount;
      result.active = inventory.active;
      result.targets = inventory.tabs;
      result.truncated = inventory.truncated;
      result.hint =
        "Doctor is a health check. For a fast full inventory use `browser-hand tabs` or `browser-hand tabs --query stripe`.";

      try {
        const pageInfo = await openNamedRelayPage(smokeName, {
          timeoutMs: Math.min(timeoutMs, 5000),
        });
        result.smoke = {
          success: true,
          pageName: smokeName,
          target: compactTarget({
            targetId: pageInfo.targetId,
            title: pageInfo.title || "",
            url: pageInfo.url || "",
          }),
        };
        await cdp.send("Target.closeTarget", { targetId: pageInfo.targetId }).catch(() => null);
      } catch (err) {
        result.smoke = {
          success: false,
          pageName: smokeName,
          error: err.message,
        };
      } finally {
        await deleteNamedRelayPage(smokeName);
      }
    } catch (err) {
      result.cdpError = err.message;
      result.smoke = {
        success: false,
        pageName: smokeName,
        error: err.message,
      };
    } finally {
      cdp.close();
    }
  }

  const classification = classifyDevBrowserDoctor({
    relayInfo,
    recentExtensionDisconnected,
    targetCount: result.targetCount,
    smoke: result.smoke,
  });
  result.status = classification.status;
  result.action = classification.action;
  result.success = classification.status === "tab_bootstrap_works";
  if (classification.status !== "tab_bootstrap_works") {
    result.pathBNote =
      "Tab bootstrap failed. For disposable/debug profiles use upstream headless or --connect on a non-default user-data-dir — not your everyday Chrome profile.";
  }
  return result;
}

async function runCurrentTabs(input = {}, timeoutMs) {
  const info = await ensureRelayConnected(Math.min(timeoutMs, 15000));
  const cdp = new CdpClient(info.wsEndpoint);
  try {
    const targetResult = await cdp.send("Target.getTargets");
    const targets = targetResult?.targetInfos || [];
    const query = {
      query: input.query || input.target?.query,
      url: input.target?.url,
      title: input.target?.title,
      id: input.target?.id,
      name: input.target?.name,
    };
    return {
      success: true,
      mode: "current",
      operation: "tabs",
      ...summarizeTabInventory(targets, query),
    };
  } finally {
    cdp.close();
  }
}

async function executeAttachedOperation({
  cdp,
  sessionId,
  selected,
  targetPlan,
  input,
  timeoutMs,
}) {
  const operation = input.operation;

  if (operation === "snapshot") {
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      snapshot: await evalValue(cdp, sessionId, buildSnapshotExpression(MAX_CURRENT_TEXT_CHARS)),
    };
  }

  if (operation === "fill_fields") {
    if (Array.isArray(input.fields)) {
      return {
        success: false,
        mode: "current",
        operation,
        error:
          'fields must be a JSON object map of label→value (e.g. {"Email":"a@b.c"}), not an array. Array input is a silent no-op trap for agents.',
      };
    }
    const fields = input.fields && typeof input.fields === "object" ? input.fields : {};
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      result: await evalValue(cdp, sessionId, buildFillFieldsExpression(fields)),
    };
  }

  if (operation === "autofill_profile") {
    const inspection = await evalValue(cdp, sessionId, buildAutofillProfileControlsExpression());
    const plan = buildAutofillProfilePlan({
      controls: Array.isArray(inspection?.controls) ? inspection.controls : [],
      page: {
        title: inspection?.title || selected.title || "",
        url: inspection?.url || selected.url || "",
      },
      autofill: autofillData,
      profile: input.profile || "default",
      contextHint: input.contextHint || "",
    });
    const sub = await substituteAutofillProfileFields(plan.fields);
    if (sub.errors.length > 0) {
      return {
        ...placeholderFailure(sub, "current"),
        operation,
        profile: plan.profile,
        context: plan.context,
        planned: plan.matched,
        skipped: plan.skipped,
      };
    }
    const result = await evalValue(cdp, sessionId, buildFillFieldsExpression(sub.vars || {}));
    const payload = {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      profile: plan.profile,
      context: plan.context,
      planned: plan.matched,
      skipped: plan.skipped,
      result,
      redacted: sub.redactions.length > 0,
    };
    if (sub.redactions.length > 0) {
      payload.redactionValues = sub.redactions;
    }
    return redactSensitiveObject(payload, sub.redactions);
  }

  if (operation === "click") {
    const query = input.selector || input.text || input.value || "";
    const result = await evalValue(
      cdp,
      sessionId,
      buildClickExpression({
        selector: input.selector,
        text: input.text || input.value,
      })
    );
    const base = {
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
    };
    if (!result || !result.found) {
      return {
        success: false,
        ...base,
        error: result?.disabled
          ? `Matched ${JSON.stringify(query)}, but that control is disabled. A real click would do nothing, so this was not dispatched.`
          : `No clickable element matched ${JSON.stringify(query)}`,
        result: result || null,
      };
    }
    return {
      success: true,
      ...base,
      // A caveat about the tab, not a claim about the outcome. Verifying what
      // a click did is the caller's job — they have snapshot and evaluate.
      ...(result.interrupted
        ? {
            warning: `The control was removed from the page during the click, before the ${result.interrupted} event. Part of the sequence was not delivered, so the action may or may not have run — re-check the page rather than assuming either way.`,
          }
        : {}),
      ...(result.documentHidden && !result.interrupted
        ? {
            warning:
              'Dispatched, but this tab is backgrounded (document.visibilityState is "hidden"). Chrome throttles background tabs and many sites ignore input there, so the click may not have taken effect. Bring the tab to the foreground and repeat if it matters.',
          }
        : {}),
      result: {
        clicked: query,
        matched: result.matched,
        score: result.score,
        candidateCount: result.candidateCount,
        ...(result.runnersUp && result.runnersUp.length ? { runnersUp: result.runnersUp } : {}),
        visible: result.visible,
        ...(result.interrupted ? { interrupted: result.interrupted } : {}),
        documentHidden: result.documentHidden,
        url: result.url,
      },
    };
  }

  if (operation === "type") {
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      result: await evalValue(
        cdp,
        sessionId,
        buildTypeExpression({
          selector: input.selector,
          label: input.label,
          text: input.text || input.value || "",
        })
      ),
    };
  }

  if (operation === "evaluate") {
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      result: await evaluateUserCode(cdp, sessionId, input.code || input.script),
    };
  }

  if (operation === "focus") {
    const focus = await applyAgentFocus(cdp, sessionId, selected, {
      focusPolicy: input.focusPolicy || input.focus || "window",
      focusReason: input.focusReason || input.reason,
      focusTtlMs: input.focusTtlMs,
    });
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      focus,
    };
  }

  if (operation === "open" || operation === "goto") {
    if (!input.url) {
      return { success: false, error: `url is required for ${operation}` };
    }
    const navResult = await navigateAndWait(cdp, sessionId, input.url, timeoutMs);
    selected.url = input.url;
    if (input.pageName && !isBlankUrl(input.url)) {
      setCachedNamedPage(input.pageName, {
        targetId: selected.targetId,
        url: input.url,
        title: selected.title || "",
      });
    }
    const navError = navResult?.errorText || null;
    const httpStatusCode =
      typeof navResult?.httpStatusCode === "number" ? navResult.httpStatusCode : null;
    let focus = null;
    if (navError === null && (input.focusPolicy || input.focus)) {
      focus = await applyAgentFocus(cdp, sessionId, selected, input);
    }
    return {
      success: navError === null,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      url: input.url,
      ...(httpStatusCode !== null ? { httpStatusCode } : {}),
      ...(navError ? { error: navError } : {}),
      ...(focus ? { focus } : {}),
    };
  }

  if (operation === "screenshot") {
    // Prefer a fast CDP capture. Extension races a short timeout then falls
    // back to chrome.tabs.captureVisibleTab (no OS focus steal).
    const result = await cdp.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: input.fullPage === true,
      },
      sessionId
    );
    const filePath = await saveCurrentScreenshot(result?.data, selected);
    return {
      success: true,
      mode: "current",
      operation,
      target: compactTarget(selected),
      ...(targetPlan.source === "named_page" ? { pageName: targetPlan.pageName } : {}),
      filePath,
    };
  }

  return {
    success: false,
    mode: "current",
    error: `Unsupported current-mode operation: ${operation}`,
  };
}

async function runCurrentBatch(input, timeoutMs) {
  let steps;
  try {
    steps = parseBatchSteps(input.steps);
  } catch (err) {
    return {
      success: false,
      mode: "current",
      operation: "batch",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const info = await ensureRelayConnected(Math.min(timeoutMs, 15000));
  const cdp = new CdpClient(info.wsEndpoint);
  try {
    let attached = null;
    const results = [];
    const batchRedactions = [];
    for (const rawStep of steps) {
      if (rawStep.operation === "wait") {
        const ms = Math.max(0, Number(rawStep.ms) || 0);
        if (ms) {
          await new Promise((resolve) => setTimeout(resolve, ms));
        }
        results.push({ success: true, operation: "wait", ms });
        continue;
      }

      const sub = await substituteForCurrent({
        ...input,
        ...rawStep,
        fields: rawStep.fields,
      });
      if (sub.redactions?.length) {
        batchRedactions.push(...sub.redactions);
      }
      if (sub.errors.length > 0) {
        results.push(
          redactSensitiveObject(
            { ...placeholderFailure(sub, "current"), operation: rawStep.operation },
            batchRedactions
          )
        );
        continue;
      }
      const walked = sub.vars && typeof sub.vars === "object" ? sub.vars : {};
      const stepInput = {
        ...input,
        ...rawStep,
        ...walked,
        pageName: rawStep.pageName || input.pageName,
        operation: rawStep.operation,
      };
      delete stepInput.steps;

      const pageName = stepInput.pageName || null;
      const needSelect =
        !attached || (pageName && attached.pageName && pageName !== attached.pageName);
      if (needSelect) {
        const targetResult = await cdp.send("Target.getTargets");
        const targets = targetResult?.targetInfos || [];
        const next = await selectOrOpenCurrentTarget({
          cdp,
          input: stepInput,
          operation: stepInput.operation,
          targets,
        });
        attached = {
          ...next,
          pageName: next.plan?.pageName || pageName,
        };
      }

      let out = await executeAttachedOperation({
        cdp,
        sessionId: attached.sessionId,
        selected: attached.selected,
        targetPlan: attached.plan,
        input: stepInput,
        timeoutMs,
      });
      if (Array.isArray(out.redactionValues) && out.redactionValues.length) {
        batchRedactions.push(...out.redactionValues);
        const { redactionValues, ...rest } = out;
        out = rest;
      }
      results.push(redactSensitiveObject(out, batchRedactions));
      if (
        out.success &&
        (stepInput.operation === "open" || stepInput.operation === "goto") &&
        stepInput.url
      ) {
        attached.selected = { ...attached.selected, url: stepInput.url };
      }
    }

    const lastEval = [...results].reverse().find((row) => row && row.operation === "evaluate");
    const last = lastEval || results.at(-1) || {};
    return redactSensitiveObject(
      {
        success: results.length > 0 && results.every((row) => row.success !== false),
        mode: "current",
        operation: "batch",
        ...(input.pageName ? { pageName: input.pageName } : {}),
        results,
        ...(Object.prototype.hasOwnProperty.call(last, "result") ? { result: last.result } : {}),
        redacted: batchRedactions.length > 0,
      },
      batchRedactions
    );
  } finally {
    cdp.close();
  }
}

async function runCurrentOperation(input, timeoutMs) {
  const operation = input.operation;
  if (operation === "doctor") {
    return await runCurrentDoctor(timeoutMs);
  }
  if (operation === "tabs") {
    return await runCurrentTabs(input, timeoutMs);
  }
  if (operation === "batch") {
    return await runCurrentBatch(input, timeoutMs);
  }

  if (input.query && !(input.target && input.target.query)) {
    input = {
      ...input,
      target: { ...(input.target || {}), query: input.query },
    };
  }

  const info = await ensureRelayConnected(Math.min(timeoutMs, 15000));
  const cdp = new CdpClient(info.wsEndpoint);
  try {
    const targetResult = await cdp.send("Target.getTargets");
    const targets = targetResult?.targetInfos || [];
    const {
      plan: targetPlan,
      selected,
      sessionId,
    } = await selectOrOpenCurrentTarget({
      cdp,
      input,
      operation,
      targets,
    });
    return await executeAttachedOperation({
      cdp,
      sessionId,
      selected,
      targetPlan,
      input,
      timeoutMs,
    });
  } finally {
    cdp.close();
  }
}

function buildSnapshotExpression(maxTextChars) {
  return `(() => {
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const short = value => norm(value).slice(0, 240);
    const visible = el => {
      try {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      } catch {
        return false;
      }
    };
    const labelForInRoot = (el, root) => {
      const parts = [];
      if (el.id) {
        try {
          const byFor = root.querySelectorAll
            ? Array.from(root.querySelectorAll('label[for]')).filter(l => l.htmlFor === el.id)
            : [];
          parts.push(...byFor.map(l => l.innerText));
        } catch {}
      }
      try {
        const wrapping = el.closest && el.closest('label');
        if (wrapping) parts.push(wrapping.innerText);
      } catch {}
      parts.push(
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? el.innerText : '',
        el.value && (el.tagName === 'BUTTON' || el.type === 'submit') ? el.value : ''
      );
      // Prefer first non-empty label source (avoid "Bio Bio" concat noise)
      for (const p of parts) {
        const s = short(p);
        if (s) return s;
      }
      return '';
    };
    const describe = (el, ctx) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      label: labelForInRoot(el, ctx.root || document),
      ...(ctx.shadow ? { shadow: true } : {}),
      ...(ctx.frame ? { frame: ctx.frame } : {}),
    });
    const CONTROL_SEL =
      'input, textarea, select, button, [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="listbox"], [contenteditable="true"], [role="textbox"]';
    const collectControls = (root, ctx, out, depth = 0) => {
      if (!root || depth > 6 || out.length >= 120) return;
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(CONTROL_SEL));
      } catch {
        return;
      }
      for (const el of nodes) {
        if (out.length >= 120) break;
        if (!visible(el)) continue;
        out.push(describe(el, ctx));
      }
      // Open shadow roots
      let all = [];
      try {
        all = Array.from(root.querySelectorAll('*'));
      } catch {
        all = [];
      }
      for (const host of all) {
        if (out.length >= 120) break;
        if (host.shadowRoot) {
          collectControls(host.shadowRoot, { ...ctx, shadow: true, root: host.shadowRoot }, out, depth + 1);
        }
      }
    };
    const controls = [];
    collectControls(document, { root: document }, controls, 0);
    // Same-origin iframes
    const frames = [];
    for (const iframe of Array.from(document.querySelectorAll('iframe')).slice(0, 20)) {
      let doc = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        doc = null;
      }
      if (!doc) continue;
      const frameName = iframe.id || iframe.name || iframe.title || 'iframe';
      frames.push({ name: frameName, src: iframe.src || '' });
      collectControls(doc, { root: doc, frame: frameName }, controls, 0);
    }
    const alerts = Array.from(document.querySelectorAll('[role="alert"], .error'))
      .filter(el => {
        if (!visible(el)) return false;
        if (el.hasAttribute('hidden')) return false;
        return norm(el.innerText).length > 0;
      })
      .slice(0, 20)
      .map(el => short(el.innerText));
    return {
      url: location.href,
      title: document.title,
      focused: document.hasFocus(),
      activeElement: document.activeElement ? describe(document.activeElement, { root: document }) : null,
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).slice(0, 40).map(el => short(el.innerText)),
      controls,
      frames,
      alerts,
      links: Array.from(document.querySelectorAll('a[href]')).filter(visible).slice(0, 80).map(el => ({ text: short(el.innerText), href: el.href })),
      text: norm(document.body ? document.body.innerText : '').slice(0, ${Number(maxTextChars)}),
    };
  })()`;
}

function buildAutofillProfileControlsExpression() {
  return `(() => {
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const short = value => norm(value).slice(0, 240);
    const labelTextByFor = new Map();
    for (const label of Array.from(document.querySelectorAll('label[for]')).slice(0, 1000)) {
      const target = label.htmlFor;
      if (!target) continue;
      const labels = labelTextByFor.get(target) || [];
      labels.push(label.innerText);
      labelTextByFor.set(target, labels);
    }
    const visible = el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rawLabelsFor = el => {
      const labels = [];
      if (el.id) {
        labels.push(...(labelTextByFor.get(el.id) || []));
      }
      const wrappingLabel = el.closest('label');
      if (wrappingLabel) labels.push(wrappingLabel.innerText);
      labels.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'));
      return labels.map(short).filter(Boolean);
    };
    const controls = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
      .filter(visible)
      .slice(0, 160)
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        autocomplete: el.getAttribute('autocomplete') || '',
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        labels: rawLabelsFor(el),
      }));
    return { url: location.href, title: document.title, controls };
  })()`;
}

export function dispatchInsertText(el, data) {
  const str = String(data ?? "");
  const fire = (type) => {
    let event;
    try {
      event = new InputEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertText",
        data: str,
      });
    } catch {
      try {
        event = new Event(type, { bubbles: true, composed: true });
      } catch {
        event = { type, bubbles: true, composed: true };
      }
      event.inputType = "insertText";
      event.data = str;
    }
    if (event.inputType == null) {
      event.inputType = "insertText";
      event.data = str;
    }
    if (typeof el.dispatchEvent === "function") {
      el.dispatchEvent(event);
    }
  };
  fire("beforeinput");
  if (el.isContentEditable) {
    el.textContent = String(el.textContent || "") + str;
  } else {
    const cur = String(el.value ?? "");
    const start = typeof el.selectionStart === "number" ? el.selectionStart : cur.length;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : cur.length;
    el.value = cur.slice(0, start) + str + cur.slice(end);
    const pos = start + str.length;
    try {
      if (typeof el.setSelectionRange === "function") el.setSelectionRange(pos, pos);
    } catch {}
  }
  if (el._valueTracker) {
    try {
      el._valueTracker.setValue("");
    } catch {}
  }
  fire("input");
}

export function usesAtomicValueAssign(el) {
  if (!el || el.isContentEditable) return false;
  const t = String(el.type || "").toLowerCase();
  return (
    t === "date" ||
    t === "datetime-local" ||
    t === "time" ||
    t === "month" ||
    t === "week" ||
    t === "color" ||
    t === "number" ||
    t === "range"
  );
}

export async function typeByInsertText(el, text, { delayMs = 0 } = {}) {
  const str = String(text ?? "");
  if (typeof el.focus === "function") el.focus();
  if (usesAtomicValueAssign(el)) {
    if (!el.isContentEditable && el.value) {
      el.value = "";
    }
    dispatchInsertText(el, str);
    return;
  }
  if (el.isContentEditable && String(el.textContent || "")) {
    el.textContent = "";
    try {
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    } catch {}
  } else if (!el.isContentEditable && el.value) {
    el.value = "";
    try {
      if (typeof el.setSelectionRange === "function") el.setSelectionRange(0, 0);
    } catch {}
    try {
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    } catch {}
  }
  for (const ch of str) {
    dispatchInsertText(el, ch);
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export function isComboboxWidget(el) {
  if (!el) return false;
  const role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  return role === "combobox" || el.tagName === "SELECT";
}

export function insertTextDelayMs(el, text, { requestedMs = 55, budgetMs = 20000 } = {}) {
  if (!isComboboxWidget(el) || el.tagName === "SELECT") return 0;
  const n = Math.max(1, String(text ?? "").length);
  return Math.max(0, Math.min(requestedMs, Math.floor(budgetMs / n)));
}

export function matchComboboxOption(options, query) {
  const wanted = String(query || "")
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  const list = Array.from(options || []);
  const textOf = (item) => String(item.textContent || item.innerText || "").toLowerCase();
  return (
    list.find((item) => textOf(item) === wanted) ||
    list.find((item) => textOf(item).includes(wanted)) ||
    null
  );
}

export function collectComboboxOptions(root) {
  const base = root || (typeof document !== "undefined" ? document : null);
  if (!base || typeof base.querySelectorAll !== "function") return [];
  const out = [];
  const walk = (node, depth = 0) => {
    if (!node || depth > 6) return;
    try {
      out.push(...Array.from(node.querySelectorAll('[role="option"]')));
    } catch {}
    let all = [];
    try {
      all = Array.from(node.querySelectorAll("*"));
    } catch {
      all = [];
    }
    for (const host of all) {
      if (host.shadowRoot) walk(host.shadowRoot, depth + 1);
    }
  };
  walk(base);
  try {
    for (const iframe of Array.from(base.querySelectorAll("iframe")).slice(0, 20)) {
      try {
        if (iframe.contentDocument) walk(iframe.contentDocument, 0);
      } catch {}
    }
  } catch {}
  return out;
}

export function optionIsVisible(el) {
  if (!el) return false;
  try {
    if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) {
      return false;
    }
  } catch {}
  try {
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  } catch {}
  if (el.hidden) return false;
  try {
    if (typeof el.getAttribute === "function" && el.getAttribute("aria-disabled") === "true") {
      return false;
    }
  } catch {}
  if (el.disabled) return false;
  return true;
}

export function listboxRootForCombobox(el, root) {
  const base = root || (typeof document !== "undefined" ? document : null);
  const id = typeof el.getAttribute === "function" ? el.getAttribute("aria-controls") : null;
  if (id && base && typeof base.getElementById === "function") {
    const box = base.getElementById(id);
    if (box) return box;
  }
  return base;
}

export function dispatchOptionPointer(option) {
  if (!option) return false;
  const fire = (type) => {
    try {
      option.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
        })
      );
    } catch {
      try {
        option.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, composed: true })
        );
      } catch {
        try {
          option.dispatchEvent(
            new Event(type, { bubbles: true, cancelable: true, composed: true })
          );
        } catch {}
      }
    }
  };
  fire("pointerdown");
  fire("mousedown");
  fire("pointerup");
  fire("mouseup");
  fire("click");
  return true;
}

export async function waitForComboboxOption(el, query, { timeoutMs = 1500, root } = {}) {
  const deadline = Date.now() + timeoutMs;
  const base = root || (typeof document !== "undefined" ? document : null);
  while (Date.now() <= deadline) {
    const scope = listboxRootForCombobox(el, base);
    const options = collectComboboxOptions(scope).filter(optionIsVisible);
    const hit = matchComboboxOption(options, query);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

export const FILL_HELPER_SOURCE = [
  dispatchInsertText,
  usesAtomicValueAssign,
  typeByInsertText,
  isComboboxWidget,
  insertTextDelayMs,
  matchComboboxOption,
  collectComboboxOptions,
  optionIsVisible,
  listboxRootForCombobox,
  dispatchOptionPointer,
  waitForComboboxOption,
]
  .map((fn) => fn.toString())
  .join("\n");

export function buildFillFieldsExpression(fields) {
  return `(async () => {
    ${FILL_HELPER_SOURCE}
    const fields = ${JSON.stringify(fields)};
    const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const visible = el => {
      try {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      } catch {
        return false;
      }
    };
    const CONTROL_SEL = 'input, textarea, select, [contenteditable="true"], [role="textbox"]';
    const collectControls = (root, out, depth = 0) => {
      if (!root || depth > 6) return;
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(CONTROL_SEL)); } catch { return; }
      for (const el of nodes) {
        if (visible(el)) out.push({ el, root });
      }
      let all = [];
      try { all = Array.from(root.querySelectorAll('*')); } catch { all = []; }
      for (const host of all) {
        if (host.shadowRoot) collectControls(host.shadowRoot, out, depth + 1);
      }
    };
    const allControls = () => {
      const out = [];
      collectControls(document, out, 0);
      for (const iframe of Array.from(document.querySelectorAll('iframe')).slice(0, 20)) {
        try {
          if (iframe.contentDocument) collectControls(iframe.contentDocument, out, 0);
        } catch {}
      }
      return out;
    };
    const labelsFor = (el, root) => {
      const labels = [];
      if (el.id && root && root.querySelectorAll) {
        labels.push(...Array.from(root.querySelectorAll('label')).filter(label => label.htmlFor === el.id).map(label => label.innerText));
      }
      try {
        const wrappingLabel = el.closest && el.closest('label');
        if (wrappingLabel) labels.push(wrappingLabel.innerText);
      } catch {}
      labels.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id);
      return labels.map(norm).filter(Boolean);
    };
    const findField = label => {
      const wanted = norm(label);
      for (const { el, root } of allControls()) {
        const labels = labelsFor(el, root);
        if (labels.some(item => item === wanted || item.includes(wanted) || wanted.includes(item))) {
          return el;
        }
      }
      return null;
    };
    const setContentEditable = (el, str) => {
      if (typeof el.focus === 'function') el.focus();
      try {
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: str,
        }));
      } catch {
        el.dispatchEvent(new Event('beforeinput', { bubbles: true, composed: true }));
      }
      el.textContent = str;
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: str,
        }));
      } catch {
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    };
    const setValue = async (el, value, deadline = Date.now() + 20000) => {
      const str = String(value ?? '');
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      if (typeof el.focus === 'function') el.focus();
      if (el.tagName === 'SELECT') {
        const wanted = norm(str);
        const option = Array.from(el.options).find(item => norm(item.textContent) === wanted || norm(item.value) === wanted)
          || Array.from(el.options).find(item => norm(item.textContent).includes(wanted) || norm(item.value).includes(wanted));
        if (!option) throw new Error('No select option matched');
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { mode: 'select' };
      }
      if (el.type === 'checkbox') {
        el.checked = /^(true|yes|1|on|checked)$/i.test(str);
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { mode: 'checkbox' };
      }
      if (el.type === 'radio') {
        el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { mode: 'radio' };
      }
      await typeByInsertText(el, str, { delayMs: insertTextDelayMs(el, str, { budgetMs: Math.max(0, deadline - Date.now()) }) });
      if (isComboboxWidget(el) && el.tagName !== 'SELECT') {
        const option = await waitForComboboxOption(el, str, { timeoutMs: 1500 });
        if (!option) throw new Error('combobox option not found');
        dispatchOptionPointer(option);
        return { mode: 'combobox', selected: true };
      }
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return { mode: 'text' };
    };
    const fillDeadline = Date.now() + 20000;
    const filled = [];
    const failed = [];
    for (const [label, value] of Object.entries(fields)) {
      try {
        const el = findField(label);
        if (!el) throw new Error('field not found');
        await setValue(el, value, fillDeadline);
        filled.push(label);
      } catch (err) {
        failed.push({ label, reason: err.message });
      }
    }
    return { url: location.href, title: document.title, filled, failed };
  })()`;
}

// --- Click targeting -------------------------------------------------------
//
// Resolve and dispatch happen in ONE in-page expression, deliberately.
//
// An earlier revision split them so clicks could be dispatched as trusted CDP
// Input events. Testing that assumption on the real surface showed it bought
// nothing: with the tab visible, an untrusted pointer sequence opens Google
// Maps' Directions panel (reproduced twice). The original "clicks do not
// register" report was the label matcher below plus a backgrounded tab, not
// untrusted events. Splitting the two, meanwhile, introduced coordinate
// staleness, hover races, target stashing and cleanup, and cross-shadow
// hit-testing — a new defect per review round. One expression has none of them:
// the element is dispatched on by reference and cannot go stale mid-click.
//
// The matching helpers are exported for unit tests and serialized into the page
// via toString(). Every function referenced by another must be listed in
// CLICK_HELPER_SOURCE, including default-parameter values — a name resolved from
// module scope in Node is simply undefined once the source reaches the page.

/**
 * Normalize a label for comparison.
 *
 * Icon fonts (Material Symbols, google-symbols, Font Awesome) render through a
 * ligature glyph in the Private Use Area, and it lands in innerText. That glyph
 * is a truthy string, so the original `innerText || value || aria-label` chain
 * short-circuited on it and never reached the accessible name — which is why
 * every icon-only control on Google Maps was unmatchable. Strip PUA and
 * zero-width runs before comparing.
 */
export function normalizeLabelText(raw) {
  return String(raw === null || raw === undefined ? "" : raw)
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rendered text, minus aria-hidden subtrees.
 *
 * innerText rather than a childNodes walk: hand-deriving it meant
 * re-implementing block boundaries, <br>, display:none, <td>/<li>, white-space
 * and text-transform, each of which surfaced as its own bug. The browser
 * already gets all of them right.
 *
 * aria-hidden content is excluded because it is not part of the accessible name
 * and including it dispatches the wrong action — a click for "delete" matching
 * `<button aria-label="Edit"><span aria-hidden="true">delete</span></button>`.
 *
 * The exclusion works by hiding those nodes and re-reading, not by subtracting
 * their text from the string. Subtraction was wrong twice: removing every
 * occurrence stripped the visible copy of repeated text, and removing the first
 * occurrence stripped the wrong copy when the hidden node came last. A string
 * simply does not record which occurrence came from which node. The cost is a
 * synchronous style write and a forced reflow during a read; both are restored
 * before returning.
 */
export function defaultVisibleText(el) {
  if (typeof el.innerText !== "string") {
    return "";
  }
  if (typeof el.querySelectorAll !== "function") {
    return el.innerText;
  }
  let hidden = [];
  try {
    hidden = Array.from(el.querySelectorAll('[aria-hidden="true"]'));
  } catch {
    return el.innerText;
  }
  if (!hidden.length) {
    return el.innerText;
  }
  // Hiding an outer node hides everything under it, so nested ones are already
  // covered and touching them would only add style writes to restore.
  const outermost = hidden.filter(
    (node) =>
      !hidden.some(
        (other) => other !== node && typeof other.contains === "function" && other.contains(node)
      )
  );
  const restore = [];
  try {
    for (const node of outermost) {
      if (!node.style) {
        continue;
      }
      restore.push([node, node.style.display]);
      node.style.display = "none";
    }
    return el.innerText;
  } finally {
    for (const entry of restore) {
      try {
        entry[0].style.display = entry[1];
      } catch {
        /* detached mid-read */
      }
    }
  }
}

/**
 * Collect every normalized label an element could reasonably be addressed by.
 *
 * An array rather than a `||` chain, so no single source can mask another.
 */
export function collectElementLabels(el, getVisibleText = defaultVisibleText) {
  const labels = [];
  const push = (raw) => {
    const value = normalizeLabelText(raw);
    if (value && !labels.includes(value)) {
      labels.push(value);
    }
  };
  if (typeof el.getAttribute === "function") {
    push(el.getAttribute("aria-label"));
    push(el.getAttribute("title"));
    push(el.getAttribute("alt"));
    push(el.getAttribute("placeholder"));
  }
  push(getVisibleText(el));
  if (el.value) {
    push(el.value);
  }
  return labels;
}

/** Tier a match: 3 exact, 2 prefix, 1 substring, 0 none. */
export function scoreLabelMatch(labels, wanted) {
  let best = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (!label) {
      continue;
    }
    if (label === wanted) {
      return 3;
    }
    if (label.indexOf(wanted) === 0) {
      best = Math.max(best, 2);
    } else if (label.indexOf(wanted) !== -1) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

/**
 * Pick the best candidate: visible beats hidden, then higher score, then the
 * smaller box (the control rather than a wrapper), then DOM order.
 */
export function pickClickCandidate(candidates, wanted) {
  const scored = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = scoreLabelMatch(candidate.labels || [], wanted);
    if (score > 0) {
      scored.push({ ...candidate, score, index: i });
    }
  }
  if (!scored.length) {
    return null;
  }
  scored.sort((a, b) => {
    // Score first, visibility only as a tie-break. The reverse let a visible
    // partial match outrank a hidden exact one — "Delete" picking "Delete all
    // archived items" — and dispatching the wrong destructive action is worse
    // than dispatching nothing.
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.visible !== b.visible) {
      return a.visible ? -1 : 1;
    }
    const areaA = Number.isFinite(a.area) ? a.area : Infinity;
    const areaB = Number.isFinite(b.area) ? b.area : Infinity;
    if (areaA !== areaB) {
      return areaA - areaB;
    }
    return a.index - b.index;
  });
  return {
    best: scored[0],
    candidateCount: scored.length,
    // runnersUp is a reporting slice. `ranked` is the whole ordered set, because
    // the aria-hidden correction pass has to be able to walk past however many
    // leading candidates matched only on hidden text.
    runnersUp: scored.slice(1, 4),
    ranked: scored,
  };
}

export const CLICK_HELPER_SOURCE = [
  normalizeLabelText,
  defaultVisibleText,
  collectElementLabels,
  scoreLabelMatch,
  pickClickCandidate,
]
  .map((fn) => fn.toString())
  .join("\n");

/** Resolve and click in a single page expression. */
function buildClickExpression({ selector, text }) {
  return `(() => {
    ${CLICK_HELPER_SOURCE}
    const selector = ${JSON.stringify(selector || "")};
    const wanted = normalizeLabelText(${JSON.stringify(text || "")});
    const CLICK_SEL = 'button, a, [role="button"], [role="option"], [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], [role="link"], [role="switch"], input[type="button"], input[type="submit"], input[type="reset"], summary';

    // frameVisible: an element can be perfectly visible inside its own document
    // while the iframe embedding that document is hidden.
    const visibleIn = (el, frameVisible) => {
      try {
        if (!frameVisible) return false;
        const win = el.ownerDocument.defaultView || window;
        if (typeof el.checkVisibility === 'function') {
          if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
        }
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) return false;
        // opacity and pointer-events are not inherited, so a control inside a
        // stale menu whose ANCESTOR is opacity:0 still computes opacity 1.
        for (let node = el, depth = 0; node && depth < 12; depth += 1) {
          const style = win.getComputedStyle(node);
          if (!style) break;
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) <= 0.01) return false;
          const parent = node.parentElement;
          const root = !parent && node.getRootNode ? node.getRootNode() : null;
          node = parent || (root && root.host ? root.host : null);
        }
        // Hit-test: checkVisibility does not do it, so a control under an
        // overlay still looks visible — and because dispatch is by reference it
        // would fire straight through the overlay. Ranking only; a target
        // outside the viewport simply cannot be hit-tested, so it is not
        // penalised for that.
        const doc = el.ownerDocument;
        const r = el.getBoundingClientRect();
        const px = r.left + r.width / 2;
        const py = r.top + r.height / 2;
        if (px >= 0 && py >= 0 && px <= win.innerWidth && py <= win.innerHeight) {
          let hit = doc.elementFromPoint(px, py);
          for (let d = 0; d < 8; d += 1) {
            if (!hit || !hit.shadowRoot || typeof hit.shadowRoot.elementFromPoint !== 'function') break;
            const deeper = hit.shadowRoot.elementFromPoint(px, py);
            if (!deeper || deeper === hit) break;
            hit = deeper;
          }
          if (hit) {
            const chain = [];
            for (let node = el, d = 0; node && d < 8; d += 1) {
              chain.push(node);
              const root = node.getRootNode ? node.getRootNode() : null;
              node = root && root.host ? root.host : null;
            }
            if (!chain.some(node => hit === node || node.contains(hit) || hit.contains(node))) return false;
          }
        }
        return true;
      } catch (err) {
        return false;
      }
    };
    // A real user click and el.click() both suppress activation on a disabled
    // control; dispatchEvent does not. Without this, automation could fire a
    // disabled destructive action that the UI does not offer.
    const isDisabled = el => {
      try {
        if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') return true;
        // :disabled encodes the platform rules, including that fieldset
        // disabling does not reach links, ARIA buttons, or controls in the
        // fieldset's first legend. An ancestor scan for fieldset[disabled]
        // rejected all of those, refusing clicks a real user can perform.
        if (typeof el.matches === 'function') return el.matches(':disabled');
        return el.disabled === true;
      } catch (err) { /* detached or unsupported selector */ }
      return false;
    };
    const areaOf = el => {
      try { const r = el.getBoundingClientRect(); return r.width * r.height; } catch (err) { return Infinity; }
    };
    const MAX_CANDIDATES = 4000;
    const seen = new Set();
    const collect = (root, out, depth) => {
      if (!root || depth > 6 || out.length >= MAX_CANDIDATES) return;
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(CLICK_SEL)); } catch (err) { return; }
      // Check the cap per node, not just on entry: one root holding more than
      // MAX_CANDIDATES matches used to append all of them, and the scoring pass
      // then ran innerText, computed style, geometry and a hit-test over the
      // whole unbounded set — enough to freeze a large dashboard and time the
      // click out. Set membership rather than indexOf keeps dedupe O(1); at the
      // cap, the linear scan was the other half of the cost.
      for (const node of nodes) {
        if (out.length >= MAX_CANDIDATES) return;
        if (!seen.has(node)) { seen.add(node); out.push(node); }
      }
      let all = [];
      try { all = Array.from(root.querySelectorAll('*')); } catch (err) { all = []; }
      for (const host of all) {
        if (out.length >= MAX_CANDIDATES) return;
        if (host.shadowRoot) collect(host.shadowRoot, out, depth + 1);
      }
    };

    const roots = [{ root: document, frameVisible: true }];
    for (const frame of Array.from(document.querySelectorAll('iframe')).slice(0, 20)) {
      try {
        if (frame.contentDocument) {
          roots.push({ root: frame.contentDocument, frameVisible: visibleIn(frame, true) });
        }
      } catch (err) { /* cross-origin */ }
    }

    let el = null;
    let pick = null;
    let frameVisible = true;
    if (selector) {
      for (const entry of roots) {
        try {
          const hit = entry.root.querySelector(selector);
          if (hit) { el = hit; frameVisible = entry.frameVisible; break; }
        } catch (err) { /* invalid selector for this root */ }
      }
      if (el && isDisabled(el)) {
        return { found: false, disabled: true, query: selector, candidateCount: 0 };
      }
    }
    if (!el && wanted) {
      const pool = [];
      for (const entry of roots) {
        const before = pool.length;
        collect(entry.root, pool, 0);
        for (let i = before; i < pool.length; i += 1) pool[i].__frameVisible = entry.frameVisible;
      }
      // Score the WHOLE pool, disabled included, then check the winner. Filtering
      // disabled candidates out first let a disabled exact match be discarded so
      // an enabled prefix match won instead — "Delete" dispatching "Delete all
      // archived items".
      // Two phases, to keep the aria-hidden read off the hot path. Scoring uses
      // plain innerText and touches nothing; only the ranked winner is re-read
      // with aria-hidden hidden, and if that correction kills its match we move
      // to the next candidate. Mutating every candidate on every scan would let
      // a page's MutationObserver — or a custom element's synchronous
      // attributeChangedCallback — react to a click that has not happened yet.
      const plainText = node => (typeof node.innerText === 'string' ? node.innerText : '');
      const candidates = pool.map(node => ({
        labels: collectElementLabels(node, plainText),
        visible: visibleIn(node, node.__frameVisible !== false),
        area: areaOf(node),
      }));
      pick = pickClickCandidate(candidates, wanted);
      if (pick) {
        // Correct only the candidates that actually matched, then rank the
        // corrected set from scratch. Taking the first one with any positive
        // corrected score let an early prefix match win over a candidate that
        // BECOMES exact once its aria-hidden text is removed — "Delete all"
        // beating a real "Delete". Correcting the matched set rather than every
        // candidate is what keeps the write off the hot path.
        const correctedNodes = [];
        const corrected = [];
        for (const item of pick.ranked) {
          const node = pool[item.index];
          correctedNodes.push(node);
          corrected.push({
            labels: collectElementLabels(node),
            visible: item.visible,
            area: item.area,
          });
        }
        const repick = pickClickCandidate(corrected, wanted);
        if (repick) {
          el = correctedNodes[repick.best.index];
          pick = {
            best: repick.best,
            candidateCount: repick.candidateCount,
            runnersUp: repick.runnersUp,
          };
        }
      }
      if (el) { frameVisible = el.__frameVisible !== false; }
      for (const node of pool) { try { delete node.__frameVisible; } catch (err) { /* frozen */ } }
      if (el && isDisabled(el)) {
        return { found: false, disabled: true, query: ${JSON.stringify(text || "")}, candidateCount: pick ? pick.candidateCount : 1 };
      }
    }
    if (!el) {
      return { found: false, query: selector || ${JSON.stringify(text || "")}, candidateCount: 0 };
    }

    // 'instant': smooth scrolling is async and would leave the control still in
    // flight. Harmless here (we dispatch by reference) but keeps it on screen.
    try { el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' }); }
    catch (err) { try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (err2) { /* detached */ } }

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const view = el.ownerDocument.defaultView || window;
    const fire = (Ctor, type, extra) => {
      el.dispatchEvent(new Ctor(type, Object.assign({
        bubbles: true, cancelable: true, composed: true, view,
        button: 0, clientX: cx, clientY: cy,
      }, extra)));
    };
    // Full pointer sequence: a bare el.click() fires one untrusted click event
    // and is ignored by handlers bound to pointerdown/mousedown, which is most
    // of Google Maps' jsaction layer.
    const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const pointerProps = Pointer === MouseEvent ? {} : { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const sequence = [
      [Pointer, 'pointerdown', Object.assign({ buttons: 1 }, pointerProps)],
      [MouseEvent, 'mousedown', { buttons: 1, detail: 1 }],
      [Pointer, 'pointerup', Object.assign({ buttons: 0 }, pointerProps)],
      [MouseEvent, 'mouseup', { buttons: 0, detail: 1 }],
      [MouseEvent, 'click', { buttons: 0, detail: 1 }],
    ];
    // A pointerdown/mousedown handler can synchronously remove or replace the
    // control. Continuing would dispatch the rest at a detached node: stale
    // direct listeners fire, delegated listeners on the replacement get nothing,
    // and we would report a clean click. Stop instead, and say so. Re-resolving
    // here would be guessing which replacement the caller meant.
    let interrupted = null;
    const sent = {};
    for (const step of sequence) {
      if (el.isConnected === false) { interrupted = step[1]; break; }
      // A handler can disable the control mid-sequence. A native interaction
      // stops activating it at that point; dispatchEvent would not.
      if (step[1] === 'click' && isDisabled(el)) { interrupted = 'click (control became disabled)'; break; }
      fire(step[0], step[1], step[2]);
      sent[step[1]] = true;
    }
    if (interrupted) {
      // pointerdown already bubbled to the document and may have left pressed or
      // drag state behind. Abandoning the sequence leaves that state stuck, so
      // send the cancellation on a target that is still connected.
      const fallback = el.isConnected === false
        ? (el.ownerDocument && el.ownerDocument.body) || document.body
        : el;
      if (fallback) {
        // Only releases the loop did NOT already deliver. Interrupting at the
        // click step means mouseup has been sent; emitting it again would run
        // document-level release handlers twice and could commit the action
        // twice for one requested click.
        const cleanup = [];
        if (!sent.pointerup) cleanup.push([Pointer, 'pointercancel', Object.assign({ buttons: 0 }, pointerProps)]);
        if (!sent.mouseup) cleanup.push([MouseEvent, 'mouseup', { buttons: 0, detail: 0 }]);
        for (const [Ctor, type, extra] of cleanup) {
          try {
            fallback.dispatchEvent(new Ctor(type, Object.assign({
              bubbles: true, cancelable: true, composed: true, view,
              button: 0, clientX: cx, clientY: cy,
            }, extra)));
          } catch (err) { /* best effort */ }
        }
      }
    }

    return {
      found: true,
      query: selector || ${JSON.stringify(text || "")},
      matched: {
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        role: el.getAttribute ? (el.getAttribute('role') || '') : '',
        labels: collectElementLabels(el).slice(0, 4),
      },
      score: pick ? pick.best.score : null,
      candidateCount: pick ? pick.candidateCount : 1,
      runnersUp: pick ? pick.runnersUp.map(item => ({ label: item.labels[0] || '', score: item.score, visible: item.visible })) : [],
      visible: visibleIn(el, frameVisible),
      ...(interrupted ? { interrupted } : {}),
      // Chrome throttles a backgrounded tab and many sites ignore input there,
      // so a click on one may not take effect. Reported as an observed fact
      // about the tab, not inferred from whether the page appeared to change —
      // a global change-detector produced false negatives on quiet pages and
      // false positives on ones with a ticking clock.
      documentHidden: document.visibilityState === 'hidden',
      url: location.href,
    };
  })()`;
}

function buildTypeExpression({ selector, label, text }) {
  return `(async () => {
    ${FILL_HELPER_SOURCE}
    const selector = ${JSON.stringify(selector || "")};
    const label = ${JSON.stringify(label || "")};
    const text = ${JSON.stringify(text || "")};
    const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const visible = el => {
      try {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      } catch {
        return false;
      }
    };
    const CONTROL_SEL = 'input, textarea, select, [contenteditable="true"], [role="textbox"]';
    const collectControls = (root, out, depth = 0) => {
      if (!root || depth > 6) return;
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(CONTROL_SEL)); } catch { return; }
      for (const el of nodes) {
        if (visible(el)) out.push({ el, root });
      }
      let all = [];
      try { all = Array.from(root.querySelectorAll('*')); } catch { all = []; }
      for (const host of all) {
        if (host.shadowRoot) collectControls(host.shadowRoot, out, depth + 1);
      }
    };
    const allControls = () => {
      const out = [];
      collectControls(document, out, 0);
      for (const iframe of Array.from(document.querySelectorAll('iframe')).slice(0, 20)) {
        try {
          if (iframe.contentDocument) collectControls(iframe.contentDocument, out, 0);
        } catch {}
      }
      return out;
    };
    const labelsFor = (el, root) => {
      const labels = [];
      if (el.id && root && root.querySelectorAll) {
        labels.push(...Array.from(root.querySelectorAll('label')).filter(labelEl => labelEl.htmlFor === el.id).map(labelEl => labelEl.innerText));
      }
      try {
        const wrappingLabel = el.closest && el.closest('label');
        if (wrappingLabel) labels.push(wrappingLabel.innerText);
      } catch {}
      labels.push(el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('name'), el.id);
      return labels.map(norm).filter(Boolean);
    };
    let el = null;
    if (selector) {
      try { el = document.querySelector(selector); } catch {}
      if (!el) {
        for (const { el: candidate } of allControls()) {
          // selector may not match shadow hosts; skip
        }
      }
    }
    if (!el && label) {
      const wanted = norm(label);
      const hit = allControls().find(({ el: item, root }) => {
        const labels = labelsFor(item, root);
        return labels.some(candidate => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
      });
      el = hit ? hit.el : null;
    }
    if (!el) throw new Error('No input element matched');
    const str = String(text ?? '');
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    if (el.tagName === 'SELECT') {
      const wanted = norm(str);
      const option = Array.from(el.options).find(item => norm(item.textContent) === wanted || norm(item.value) === wanted)
        || Array.from(el.options).find(item => norm(item.textContent).includes(wanted) || norm(item.value).includes(wanted));
      if (!option) throw new Error('No select option matched');
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } else {
      await typeByInsertText(el, str, { delayMs: insertTextDelayMs(el, str) });
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }
    return { typed: label || selector, url: location.href, title: document.title };
  })()`;
}

async function evaluateUserCode(cdp, sessionId, code) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required for evaluate");
  }
  const asExpression = `(() => (${code}))()`;
  const asStatements = `(() => {\n${code}\n})()`;
  try {
    return await evalValue(cdp, sessionId, asExpression);
  } catch {
    return await evalValue(cdp, sessionId, asStatements);
  }
}

async function saveCurrentScreenshot(base64Png, target) {
  if (!base64Png) {
    throw new Error("Screenshot failed: missing PNG data");
  }
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const safeTitle = String(target.title || "chrome-tab")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(SCREENSHOT_DIR, `${safeTitle || "chrome-tab"}-${timestamp}.png`);
  await writeFile(filePath, Buffer.from(base64Png, "base64"));
  return filePath;
}

function normalizeOperation({ mode, operation, fields }) {
  if (operation) {
    return operation;
  }
  if (mode === "headless") {
    return "run_script";
  }
  if (fields && typeof fields === "object" && Object.keys(fields).length > 0) {
    return "fill_fields";
  }
  return "snapshot";
}

async function substituteForHeadless(vars) {
  const safeVars = vars && typeof vars === "object" && !Array.isArray(vars) ? vars : {};
  return await substitutePlaceholders(safeVars, {
    autofill: autofillData,
    getSecret: readKeychainSecret,
    getSecure: readProfileSecret,
    secretCache,
    secureCache,
  });
}

async function substituteForCurrent(args) {
  const safeVars =
    args.vars && typeof args.vars === "object" && !Array.isArray(args.vars) ? args.vars : {};
  const safeFields =
    args.fields && typeof args.fields === "object" && !Array.isArray(args.fields)
      ? args.fields
      : {};
  return await substitutePlaceholders(
    {
      vars: safeVars,
      fields: safeFields,
      target: args.target || {},
      selector: args.selector || "",
      label: args.label || "",
      text: args.text || "",
      value: args.value || "",
      url: args.url || "",
    },
    {
      autofill: autofillData,
      getSecret: readKeychainSecret,
      getSecure: readProfileSecret,
      secretCache,
      secureCache,
    }
  );
}

async function substituteAutofillProfileFields(fields) {
  const safeFields = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
  return await substitutePlaceholders(safeFields, {
    autofill: autofillData,
    getSecret: readKeychainSecret,
    getSecure: readProfileSecret,
    secretCache,
    secureCache,
  });
}

function placeholderFailure(sub, mode) {
  cl.warn("placeholder substitution failed", {
    errors: sub.errors,
    substituted: sub.substituted,
  });
  return {
    success: false,
    mode,
    error: sub.errors.join("; "),
    placeholderError: true,
  };
}

const operations = [
  "snapshot",
  "open",
  "fill_fields",
  "autofill_profile",
  "click",
  "type",
  "screenshot",
  "evaluate",
  "goto",
  "focus",
  "batch",
  "doctor",
  "tabs",
  "run_script",
];

const devBrowserTool = {
  name: "dev_browser",
  description: `Drive Chrome through one AutoHub browser tool.

Modes:
- current (default): drive the user's normal Chrome through the dev-browser extension relay. This does not require --remote-debugging-port and avoids the WebDriver automation banner. Use for "this page", active-tab help, authenticated pages, forms, and quick voice/Raycast/mobile requests.
- headless: run a sandboxed SawyerHood/dev-browser script in fresh Chromium for QA and unauthenticated automation.
- connect: legacy alias for current.

Current-mode operations:
- open: create/get a named relay tab and navigate it to a URL.
- snapshot: summarize the active/current tab.
- fill_fields: fill labels/placeholders/names from fields.
- autofill_profile: inspect the active form, map common fields to the local autofill profile, resolve placeholders locally, and fill them in one call.
- click: click by selector or visible text.
- type: type into a selector or label.
- screenshot: save a PNG under ~/.autohub/browser-screenshots.
- evaluate: evaluate JavaScript in the selected tab.
- goto: navigate the selected tab.
- batch: run multiple current-mode steps on one CDP session (one attach).
- focus: one-shot human-in-the-loop focus (tab|window) with reason; does not change the popup default (background).
- doctor: classify relay/extension/target-bootstrap health.
- tabs: list every http(s) tab (active/focused first). Fast inventory — do not use doctor to find a tab.

Targeting:
- target defaults to { strategy: "active" }.
- Optional target fields: id, url, title, name, query, strategy:"first".
- pageName: open/goto create-or-reuse a named relay tab; snapshot/screenshot/evaluate/fill_fields/click/type/autofill_profile/focus attach only.
- focusPolicy/focus: optional per-call override for open/goto/focus — "window" brings Chrome forward for human input; "tab" activates only; default remains background. Pass reason for audit.

Autofill placeholders:
- {me:KEY}: ~/.autohub/autofill.json.
- {secure:KEY}: macOS keychain service autohub-profile-KEY. Use for legal names, mailing/billing address, SSN, card data, passwords, and secure profile details.
- {secret:KEY}: macOS keychain service autohub-autofill-KEY. Legacy-compatible secret placeholder for cards, passwords, tokens.
Profile autofill:
- operation:"autofill_profile" uses ~/.autohub/autofill.json for context preferences and macOS keychain profile placeholders for sensitive values. It does not use memory or Evernote.
Resolved placeholder values are redacted from tool output.`,
  inputSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["current", "headless", "connect"],
        description:
          "current: active user Chrome via extension relay. headless: fresh Chromium via dev-browser CLI. connect is a legacy alias for current. Default: current.",
      },
      operation: {
        type: "string",
        enum: operations,
        description:
          "Current-mode operation, or run_script for headless. Defaults to snapshot in current mode and run_script in headless mode.",
      },
      pageName: {
        type: "string",
        description:
          "Named extension-relay tab. open and goto create-or-reuse; snapshot/screenshot/evaluate/fill/click/type/focus attach to an existing name and fail if it is missing.",
      },
      target: {
        type: "object",
        description:
          "Current-mode tab target. Defaults to the unique-active tab, or last-focused when the extension stamps focused. Optional: id, url, title, name, query, strategy.",
        additionalProperties: true,
      },
      query: {
        type: "string",
        description:
          "Substring match against tab title or URL. Used by tabs and as a target filter for snapshot/click/etc.",
      },
      fields: {
        type: "object",
        description:
          "Label/value map for fill_fields. Values may use {me:KEY}, {secure:KEY}, or {secret:KEY}.",
        additionalProperties: true,
      },
      profile: {
        type: "string",
        description: 'Autofill profile name for operation:"autofill_profile". Default: default.',
      },
      contextHint: {
        type: "string",
        description:
          'Optional context hint for operation:"autofill_profile", such as travel, banking, work, or personal.',
      },
      selector: {
        type: "string",
        description: "CSS selector for click/type/evaluate helpers.",
      },
      label: {
        type: "string",
        description: "Human field label for type.",
      },
      text: {
        type: "string",
        description: "Text for click matching or type input.",
      },
      value: {
        type: "string",
        description: "Alias for text in click/type operations.",
      },
      url: {
        type: "string",
        description: "URL for goto.",
      },
      steps: {
        type: "array",
        description:
          'Ordered current-mode steps for operation:"batch". One CDP attach; open/fill/click/evaluate share the session. Max 32.',
        items: {
          type: "object",
          additionalProperties: true,
        },
      },
      code: {
        type: "string",
        description: "JavaScript code for current-mode evaluate.",
      },
      script: {
        type: "string",
        description:
          "Sandboxed JS for headless run_script only. Top-level await available. `args` is populated from vars.",
      },
      vars: {
        type: "object",
        description:
          "Values injected as `const args = {...}` in headless run_script. Values may use placeholders.",
        additionalProperties: true,
      },
      browser: {
        type: "string",
        description:
          "Optional named browser instance for headless mode, passed as --browser <name>.",
      },
      timeoutMs: {
        type: "number",
        description: "Hard timeout in ms. Range: 1000-120000. Default: 30000.",
      },
      focusPolicy: {
        type: "string",
        enum: ["background", "tab", "window"],
        description:
          "Per-call focus override for focus/open/goto. Default popup policy is background (no steal). Use window when a human must see/interact with the tab (2FA, confirm). tab activates without focusing the OS window. Alias: focus.",
      },
      focus: {
        type: "string",
        enum: ["background", "tab", "window"],
        description: "Alias for focusPolicy.",
      },
      focusReason: {
        type: "string",
        description:
          "Why focus is requested (e.g. 2fa, confirm-publish). Required by skill when focusing; stored on the override for audit.",
      },
      reason: {
        type: "string",
        description: "Alias for focusReason.",
      },
      focusTtlMs: {
        type: "number",
        description:
          "How long the focus override stays valid if unused (default 120000). Cleared after one successful focus apply when consumeOnUse is true.",
      },
      fullPage: {
        type: "boolean",
        description: "Current screenshot: capture beyond viewport when true.",
      },
    },
    required: [],
  },
  handler: async (args = {}) => {
    const mode = normalizeDevBrowserMode(args.mode);
    const timeoutMs =
      typeof args.timeoutMs === "number" && !Number.isNaN(args.timeoutMs)
        ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, args.timeoutMs))
        : DEFAULT_TIMEOUT_MS;
    const operation = normalizeOperation({
      mode,
      operation: args.operation,
      fields: args.fields,
    });

    if (!operations.includes(operation)) {
      return {
        success: false,
        mode,
        error: `Unsupported operation: ${operation}`,
      };
    }

    // Reject array fields before substituteForCurrent strips them to {} (silent no-op).
    if (operation === "fill_fields" && Array.isArray(args.fields)) {
      return {
        success: false,
        mode,
        operation,
        error:
          'fields must be a JSON object map of label→value (e.g. {"Email":"a@b.c"}), not an array. Array input is a silent no-op trap for agents.',
      };
    }

    if (mode === "headless") {
      if (operation !== "run_script") {
        return {
          success: false,
          mode,
          operation,
          error: 'Headless mode currently supports operation:"run_script" only',
        };
      }
      if (!args.script || typeof args.script !== "string" || !args.script.trim()) {
        return {
          success: false,
          mode,
          operation,
          error: "script is required for headless run_script",
        };
      }
      if (Buffer.byteLength(args.script, "utf8") > MAX_SCRIPT_BYTES) {
        return {
          success: false,
          mode,
          operation,
          error: `script exceeds ${MAX_SCRIPT_BYTES} bytes; split into multiple calls or write smaller scripts`,
        };
      }

      const sub = await substituteForHeadless(args.vars);
      if (sub.errors.length > 0) {
        return placeholderFailure(sub, mode);
      }
      const varsLiteral = JSON.stringify(sub.vars || {});
      const payload = `const args = ${varsLiteral};\n${args.script}`;
      cl.info("running dev-browser headless", {
        mode,
        operation,
        timeoutMs,
        scriptBytes: Buffer.byteLength(args.script, "utf8"),
        varKeys: Object.keys(sub.vars || {}),
        substituted: sub.substituted,
      });
      const result = await runDevBrowser({
        payload,
        mode,
        browserName:
          typeof args.browser === "string" && args.browser.trim() ? args.browser.trim() : null,
        timeoutMs,
      });
      return redactSensitiveObject(
        {
          ...result,
          mode,
          operation,
          redacted: sub.redactions.length > 0,
        },
        sub.redactions
      );
    }

    if (operation === "run_script") {
      return {
        success: false,
        mode,
        operation,
        error:
          "run_script is headless-only. Use current-mode operations such as open, snapshot, fill_fields, autofill_profile, click, type, screenshot, evaluate, goto, tabs, or doctor.",
      };
    }

    const sub = await substituteForCurrent(args);
    if (sub.errors.length > 0) {
      return placeholderFailure(sub, mode);
    }
    const input = {
      ...args,
      ...(sub.vars || {}),
      mode,
      operation,
    };
    cl.info("running dev-browser current", {
      mode,
      operation,
      timeoutMs,
      target: input.target,
      fieldKeys: Object.keys(input.fields || {}),
      substituted: sub.substituted,
    });
    try {
      const result = await runCurrentOperation(input, timeoutMs);
      return redactSensitiveObject(
        {
          ...result,
          redacted: sub.redactions.length > 0 || Boolean(result.redacted),
        },
        sub.redactions
      );
    } catch (err) {
      return redactSensitiveObject(
        {
          success: false,
          mode,
          operation,
          error: err.message,
        },
        sub.redactions
      );
    }
  },
};

export default devBrowserTool;
