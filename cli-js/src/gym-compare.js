/**
 * Gym comparison on 01/08/09/16/20: browser-hand, upstream `dev-browser
 * --headless`, and vanilla Playwright (benchmark only, not a product path).
 * Scores `__oracle().ok` + step count. approxTokens = stdout-bytes/4.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "../..");
const DEFAULT_ORIGIN = "http://127.0.0.1:8766";
const ORACLE_CODE = "JSON.stringify(window.__oracle())";
/** Repo launcher — npm scripts do not put package.bin on PATH. */
export const DEFAULT_UPSTREAM_BIN = path.join(REPO_ROOT, "bin/dev-browser.js");
export const GYM_COMPARE_DRIVERS = ["browser-hand", "dev-browser", "playwright"];

export const GYM_COMPARE_SUBSET = [
  {
    id: "01",
    file: "01-hello-form.html",
    name: "Hello form",
    pageName: "gym-01",
    steps: [
      {
        op: "fill",
        fields: {
          "Full name": "Ada Lovelace",
          Email: "ada@example.com",
          Message: "hello gym",
        },
      },
      { op: "click", name: "Send" },
    ],
  },
  {
    id: "08",
    file: "08-shadow-dom.html",
    name: "Shadow DOM",
    pageName: "gym-08",
    steps: [
      { op: "fill", fields: { "Display name": "Ada", Handle: "ada" } },
      { op: "click", name: "Save in shadow" },
    ],
  },
  {
    id: "09",
    file: "09-iframe-form.html",
    name: "Iframe form",
    pageName: "gym-09",
    frame: "#ticket-frame",
    steps: [
      {
        op: "fill",
        fields: { "Ticket ID": "TCK-100", Subject: "Login broken" },
        scope: "iframe",
      },
      { op: "click", name: "Submit ticket", scope: "iframe" },
    ],
  },
  {
    id: "16",
    file: "16-custom-listbox.html",
    name: "Custom listbox",
    pageName: "gym-16",
    steps: [
      { op: "click", role: "option", name: "Pro" },
      { op: "click", name: "Confirm plan" },
    ],
  },
  {
    id: "20",
    file: "20-react-combobox.html",
    name: "React combobox debounce",
    pageName: "gym-20",
    steps: [
      { op: "fill", fields: { "Arrival airport": "JFK" } },
      { op: "wait", ms: 250 },
      { op: "click", role: "option", name: "JFK · New York John F. Kennedy" },
    ],
    // BH fill already selects the matching option; a second click fails.
    browserHandSteps: [{ op: "fill", fields: { "Arrival airport": "JFK" } }],
  },
];

export function stepCount(challenge, { driver } = {}) {
  const steps =
    driver === "browser-hand" && Array.isArray(challenge.browserHandSteps)
      ? challenge.browserHandSteps
      : challenge.steps;
  // navigate + recipe actions + oracle evaluate
  return 1 + steps.length + 1;
}

export function parseOracle(raw) {
  if (raw == null) {
    return { ok: false, checks: {}, detail: "empty oracle" };
  }
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const marker = trimmed.indexOf("GYMCMP:");
    const jsonText = marker >= 0 ? trimmed.slice(marker + "GYMCMP:".length) : trimmed;
    try {
      value = JSON.parse(jsonText);
    } catch {
      return { ok: false, checks: {}, detail: `unparseable oracle: ${trimmed.slice(0, 200)}` };
    }
  }
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "result")) {
    return parseOracle(value.result);
  }
  if (value && typeof value === "object" && typeof value.ok === "boolean") {
    return {
      ok: value.ok,
      checks: value.checks || {},
      detail: value.detail || "",
    };
  }
  return { ok: false, checks: {}, detail: "oracle missing ok" };
}

export function cliErrorFromOutput(stdout, stderr, code) {
  if (code === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // stdout was not a single JSON object
  }
  const errLine = String(stderr || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/\binfo:/.test(line));
  return (errLine || String(stdout || "").trim() || `exit ${code}`).slice(0, 400);
}

export function approxTokens(bytes) {
  return Math.ceil((Number(bytes) || 0) / 4);
}

export function summarizeComparison(results) {
  const drivers = {};
  const byId = new Map();
  for (const row of results) {
    const bucket = drivers[row.driver] || {
      passed: 0,
      failed: 0,
      steps: 0,
      stdoutBytes: 0,
      approxTokens: 0,
    };
    if (row.ok) bucket.passed += 1;
    else bucket.failed += 1;
    bucket.steps += Number(row.steps) || 0;
    bucket.stdoutBytes += Number(row.stdoutBytes) || 0;
    bucket.approxTokens += Number(row.approxTokens) || 0;
    drivers[row.driver] = bucket;
    const entry = byId.get(row.id) || { id: row.id, name: row.name || row.id };
    entry[row.driver] = {
      ok: !!row.ok,
      steps: Number(row.steps) || 0,
      detail: row.detail || "",
      approxTokens: Number(row.approxTokens) || 0,
      ...(row.error ? { error: row.error } : {}),
    };
    byId.set(row.id, entry);
  }
  const catalogOrder = new Map(GYM_COMPARE_SUBSET.map((item, index) => [item.id, index]));
  const rows = [...byId.values()].sort(
    (a, b) => (catalogOrder.get(a.id) ?? 99) - (catalogOrder.get(b.id) ?? 99)
  );
  return { challenges: GYM_COMPARE_SUBSET.map((item) => item.id), drivers, rows };
}

function challengeUrl(challenge, origin) {
  return `${origin.replace(/\/$/, "")}/${challenge.file}`;
}

export function buildBrowserHandCommands(challenge, origin) {
  const page = ["--page-name", challenge.pageName];
  const cmds = [["open", "--url", challengeUrl(challenge, origin), ...page, "--quiet"]];
  const recipe = Array.isArray(challenge.browserHandSteps)
    ? challenge.browserHandSteps
    : challenge.steps;
  for (const step of recipe) {
    if (step.op === "fill") {
      cmds.push(["fill", ...page, "--fields", JSON.stringify(step.fields), "--quiet"]);
    } else if (step.op === "click") {
      cmds.push(["click", ...page, "--text", step.name, "--quiet"]);
    } else if (step.op === "wait") {
      cmds.push(["wait", String(step.ms)]);
    }
  }
  cmds.push(["evaluate", ...page, "--code", ORACLE_CODE, "--quiet"]);
  return cmds;
}

function playwrightRoot(challenge, step) {
  return step.scope === "iframe" && challenge.frame
    ? `page.frameLocator(${JSON.stringify(challenge.frame)})`
    : "page";
}

export function buildLocatorSteps(challenge, origin) {
  const lines = [
    `await page.goto(${JSON.stringify(challengeUrl(challenge, origin))}, { waitUntil: "domcontentloaded" });`,
  ];
  for (const step of challenge.steps) {
    const root = playwrightRoot(challenge, step);
    if (step.op === "fill") {
      for (const [label, value] of Object.entries(step.fields)) {
        lines.push(
          `await ${root}.getByLabel(${JSON.stringify(label)}).fill(${JSON.stringify(value)});`
        );
      }
    } else if (step.op === "click") {
      const role = step.role || "button";
      lines.push(
        `await ${root}.getByRole(${JSON.stringify(role)}, { name: ${JSON.stringify(step.name)} }).click();`
      );
    } else if (step.op === "wait") {
      lines.push(`await new Promise((resolve) => setTimeout(resolve, ${Number(step.ms) || 0}));`);
    }
  }
  lines.push(`const oracle = await page.evaluate(() => window.__oracle());`);
  lines.push(
    `console.log("GYMCMP:" + JSON.stringify({ id: ${JSON.stringify(challenge.id)}, ok: oracle.ok, checks: oracle.checks, detail: oracle.detail }));`
  );
  return lines;
}

export function buildHeadlessScript(challenge, origin) {
  return [
    `const page = await browser.getPage(${JSON.stringify(challenge.pageName)});`,
    ...buildLocatorSteps(challenge, origin),
  ].join("\n") + "\n";
}

/** Vanilla Playwright recipe used only as a gym benchmark, not a product path. */
export function buildPlaywrightScript(challenge, origin) {
  return buildLocatorSteps(challenge, origin).join("\n") + "\n";
}

function spawnCaptured(command, args, { cwd, timeoutMs, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: cwd || REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs || 30000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export function assertLoopbackOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`invalid --origin "${origin}"`);
  }
  const host = (url.hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(
      `gym origin must be loopback (got ${host}); public sites stay navigate/snapshot-only`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`gym origin must be http(s) (got ${url.protocol})`);
  }
  return url;
}

export function gymOriginLooksHealthy(statusCode, body) {

  if (!(statusCode >= 200 && statusCode < 400)) return false;
  return /__CHALLENGE__|__oracle/i.test(String(body || ""));
}

async function originReachable(origin) {
  return new Promise((resolve) => {
    const target = `${origin.replace(/\/$/, "")}/01-hello-form.html`;
    const client = target.startsWith("https:") ? https : http;
    const req = client.get(target, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk.toString();
        if (body.length > 4000) res.destroy();
      });
      res.on("end", () => resolve(gymOriginLooksHealthy(res.statusCode, body)));
      res.on("error", () => resolve(false));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function ensureGymServer(origin) {
  if (await originReachable(origin)) {
    return { started: false, origin };
  }
  const url = assertLoopbackOrigin(origin);
  const rawHost = (url.hostname || "").replace(/^\[|\]$/g, "");
  const bindHost = rawHost === "localhost" || !rawHost ? "127.0.0.1" : rawHost;
  const child = spawn(
    "python3",
    ["-m", "http.server", url.port || "8766", "--bind", bindHost],
    {
      cwd: path.join(REPO_ROOT, "extension/challenges"),
      stdio: "ignore",
      detached: true,
    }
  );
  child.unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await originReachable(origin)) {
      return { started: true, origin, pid: child.pid };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`gym server did not start on ${origin}`);
}

async function runBrowserHandChallenge(challenge, options) {
  const started = Date.now();
  const cmds = buildBrowserHandCommands(challenge, options.origin);
  let issued = 0;
  let stdoutBytes = 0;
  let lastOracle = { ok: false, checks: {}, detail: "not evaluated" };
  let error = null;
  const bin = options.browserHandBin;
  for (const cmd of cmds) {
    if (cmd[0] === "wait") {
      issued += 1;
      await new Promise((resolve) => setTimeout(resolve, Number(cmd[1]) || 0));
      continue;
    }
    issued += 1;
    const result = await spawnCaptured(process.execPath, [bin, ...cmd], {
      timeoutMs: options.commandTimeoutMs || 30000,
    });
    stdoutBytes += Buffer.byteLength(result.stdout || "", "utf8");
    if (cmd[0] === "evaluate") {
      try {
        lastOracle = parseOracle(JSON.parse(result.stdout));
      } catch {
        lastOracle = parseOracle(result.stdout);
      }
    }
    if (result.code !== 0) {
      error = cliErrorFromOutput(result.stdout, result.stderr, result.code);
      if (cmd[0] === "evaluate") {
        break;
      }
      // Still run later steps, especially the oracle evaluate.
      continue;
    }
  }
  return {
    id: challenge.id,
    name: challenge.name,
    driver: "browser-hand",
    ok: lastOracle.ok && !error,
    steps: issued,
    expectedSteps: stepCount(challenge, { driver: "browser-hand" }),
    detail: lastOracle.detail,
    checks: lastOracle.checks,
    error,
    stdoutBytes,
    approxTokens: approxTokens(stdoutBytes),
    ms: Date.now() - started,
  };
}

async function runDevBrowserChallenge(challenge, options) {
  const started = Date.now();
  const script = buildHeadlessScript(challenge, options.origin);
  const upstream = options.upstreamBin || DEFAULT_UPSTREAM_BIN;
  const isJsLauncher = /\.m?js$/i.test(upstream);
  const result = await spawnCaptured(
    isJsLauncher ? process.execPath : upstream,
    isJsLauncher
      ? [upstream, "--headless", "--browser", "gym-compare", "--timeout", "90"]
      : ["--headless", "--browser", "gym-compare", "--timeout", "90"],
    {
      timeoutMs: options.headlessTimeoutMs || 120000,
      input: script,
    }
  );
  const oracle = parseOracle(result.stdout);
  const error =
    result.code !== 0 && !oracle.ok
      ? (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 400)
      : null;
  const stdoutBytes = Buffer.byteLength(result.stdout || "", "utf8");
  return {
    id: challenge.id,
    name: challenge.name,
    driver: "dev-browser",
    ok: result.code === 0 && oracle.ok,
    steps: stepCount(challenge),
    expectedSteps: stepCount(challenge),
    detail: oracle.detail,
    checks: oracle.checks,
    error,
    stdoutBytes,
    approxTokens: approxTokens(stdoutBytes),
    ms: Date.now() - started,
  };
}

async function runPlaywrightChallenge(challenge, options) {
  const started = Date.now();
  let oracle = { ok: false, checks: {}, detail: "not evaluated" };
  let error = null;
  const page = options.playwrightPage;
  try {
    if (!page) {
      throw new Error("playwright page missing");
    }
    await page.goto(challengeUrl(challenge, options.origin), { waitUntil: "domcontentloaded" });
    for (const step of challenge.steps) {
      const root =
        step.scope === "iframe" && challenge.frame
          ? page.frameLocator(challenge.frame)
          : page;
      if (step.op === "fill") {
        for (const [label, value] of Object.entries(step.fields)) {
          await root.getByLabel(label).fill(value);
        }
      } else if (step.op === "click") {
        await root.getByRole(step.role || "button", { name: step.name }).click();
      } else if (step.op === "wait") {
        await new Promise((resolve) => setTimeout(resolve, Number(step.ms) || 0));
      }
    }
    oracle = parseOracle(await page.evaluate(() => window.__oracle()));
  } catch (err) {
    error = String(err && err.message ? err.message : err).slice(0, 400);
  }
  const stdout = `GYMCMP:${JSON.stringify({ id: challenge.id, ok: oracle.ok, checks: oracle.checks, detail: oracle.detail })}`;
  const stdoutBytes = Buffer.byteLength(stdout, "utf8");
  return {
    id: challenge.id,
    name: challenge.name,
    driver: "playwright",
    ok: !error && oracle.ok,
    steps: stepCount(challenge),
    expectedSteps: stepCount(challenge),
    detail: oracle.detail,
    checks: oracle.checks,
    error,
    stdoutBytes,
    approxTokens: approxTokens(stdoutBytes),
    ms: Date.now() - started,
  };
}

export async function runGymCompare(options = {}) {
  const originUrl = assertLoopbackOrigin(options.origin || DEFAULT_ORIGIN);
  const origin = originUrl.origin;
  const drivers = options.drivers || [...GYM_COMPARE_DRIVERS];
  await ensureGymServer(origin);
  const resolved = {
    origin,
    browserHandBin: options.browserHandBin || path.join(REPO_ROOT, "cli-js/src/cli.js"),
    upstreamBin: options.upstreamBin || DEFAULT_UPSTREAM_BIN,
    commandTimeoutMs: options.commandTimeoutMs || 30000,
    headlessTimeoutMs: options.headlessTimeoutMs || 120000,
  };
  let playwrightBrowser = null;
  let playwrightContext = null;
  let playwrightLaunchError = null;
  if (drivers.includes("playwright")) {
    try {
      const { chromium } = await import("playwright");
      playwrightBrowser = await chromium.launch({ headless: true });
      playwrightContext = await playwrightBrowser.newContext();
    } catch (err) {
      playwrightLaunchError = `Playwright benchmark driver unavailable: ${String(
        err && err.message ? err.message : err
      ).slice(0, 240)}. Run npx playwright install chromium.`;
    }
  }
  const results = [];
  try {
    for (const challenge of GYM_COMPARE_SUBSET) {
      if (drivers.includes("browser-hand")) {
        results.push(await runBrowserHandChallenge(challenge, resolved));
      }
      if (drivers.includes("dev-browser")) {
        results.push(await runDevBrowserChallenge(challenge, resolved));
      }
      if (drivers.includes("playwright")) {
        if (playwrightLaunchError) {
          results.push({
            id: challenge.id,
            name: challenge.name,
            driver: "playwright",
            ok: false,
            steps: 0,
            expectedSteps: stepCount(challenge),
            detail: "",
            checks: {},
            error: playwrightLaunchError,
            stdoutBytes: 0,
            approxTokens: 0,
            ms: 0,
          });
          continue;
        }
        const page = await playwrightContext.newPage();
        try {
          results.push(
            await runPlaywrightChallenge(challenge, { ...resolved, playwrightPage: page })
          );
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    if (playwrightBrowser) {
      await playwrightBrowser.close();
    }
  }
  const summary = summarizeComparison(results);
  return { origin, ...summary, results };
}

export function parseCliArgs(argv) {
  const out = {
    drivers: [...GYM_COMPARE_DRIVERS],
    origin: DEFAULT_ORIGIN,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--origin") {
      out.origin = argv[++i];
    } else if (tok === "--driver") {
      const value = argv[++i];
      if (value == null || value === "") {
        throw new Error("missing --driver value (all|both|browser-hand|dev-browser|playwright)");
      }
      if (value === "both") {
        out.drivers = ["browser-hand", "dev-browser"];
      } else if (value === "all") {
        out.drivers = [...GYM_COMPARE_DRIVERS];
      } else if (GYM_COMPARE_DRIVERS.includes(value)) {
        out.drivers = [value];
      } else {
        throw new Error(
          `unsupported driver "${value}" (expected all|both|${GYM_COMPARE_DRIVERS.join("|")})`
        );
      }
    } else if (tok === "--upstream-bin") {
      out.upstreamBin = argv[++i];
    } else if (tok === "--browser-hand-bin") {
      out.browserHandBin = argv[++i];
    } else if (tok === "--help" || tok === "-h") {
      out.help = true;
    }
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "gym-compare — oracle + step-count comparison on challenges 01/08/09/16/20\n" +
        "Playwright is a gym benchmark (disposable Chromium), not a product path.\n\n" +
        "  node cli-js/src/gym-compare.js [--driver all|both|browser-hand|dev-browser|playwright]\n" +
        "  [--origin http://127.0.0.1:8766] [--browser-hand-bin path/to/cli.js]\n  [--upstream-bin path/to/bin/dev-browser.js]  (default: repo bin)\n"
    );
    process.exit(0);
  }
  const report = await runGymCompare(args);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const failed = report.results.some((row) => !row.ok);
  process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`);
    process.exit(1);
  });
}
