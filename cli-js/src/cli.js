#!/usr/bin/env node
/**
 * browser-hand — CLI for the Browser Hand extension bridge.
 *
 * Drive the local relay + Chrome MV3 extension from the shell so agents
 * can use real logged-in Chrome without AutoHub or remote debugging.
 *
 * Usage:
 *   browser-hand snapshot
 *   browser-hand screenshot --full-page
 *   browser-hand autofill-profile --profile default --context personal
 *   browser-hand fill --fields '{"Email":"x@y.z","First name":"Ada"}'
 *   browser-hand click --text "Submit"
 *   browser-hand click --selector 'button[type=submit]'
 *   browser-hand type --label "Bio" --text "Hello"
 *   browser-hand evaluate --code 'document.title'
 *   browser-hand goto --url https://example.com
 *   browser-hand open --url https://example.com --page-name smoke
 *   browser-hand doctor
 *
 * Output: JSON on stdout. Exits 0 on success, 1 on tool/handler error,
 * 2 on argument error.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

// Force Browser Hand logger to stderr so stdout stays pure JSON for
// machine-readable consumption. Must be set BEFORE the tool import because
// the logger latches the stream choice at construction time.
process.env.AUTOHUB_LOG_STREAM = process.env.AUTOHUB_LOG_STREAM || "stderr";
process.env.BROWSER_HAND_LOG_STREAM = process.env.BROWSER_HAND_LOG_STREAM || "stderr";

const { default: devBrowserTool, startPersistentRelay } = await import("./tool.js");

const OP_ALIASES = {
  "autofill-profile": "autofill_profile",
  "fill-fields": "fill_fields",
  fill: "fill_fields",
  shot: "screenshot",
  list: "tabs",
};

const HELP = `browser-hand — drive your real Chrome via the Browser Hand extension relay.

Operations:
  snapshot                              Summarize the active/current tab.
  screenshot [--full-page]              Save a PNG under ~/.browser-hand/screenshots/.
  autofill-profile                      Inspect the form, map fields, fill from ~/.browser-hand/autofill.json (falls back to ~/.autohub/autofill.json).
    [--profile <name>] [--context <hint>]
  fill --fields <json>                  Fill labels from a JSON object.
  click (--text <s> | --selector <css>) Click by visible text or CSS selector.
  type --label <s> --text <s>           Type into an input matched by label.
  evaluate --code <js>                  Evaluate JavaScript in the active tab.
  goto --url <url>                      Navigate the active tab.
  open --url <url> [--page-name <name>] Create/get a named relay tab and navigate it.
  focus [--focus window|tab]            Bring a tab forward for human input (one-shot; default window).
    --reason <why>                      Required for good audit (e.g. 2fa, confirm-publish).
  tabs [--query <text>]                 List every http(s) tab. Unique-active first; last-focused when stamped.
  doctor                                Diagnose relay, extension, and tab bootstrap. Not a tab list.
  relay                                 Start a persistent extension relay (foreground) so the
                                        Chrome extension has a stable endpoint to connect to.
                                        Run once and leave it up; Ctrl-C to stop. Idempotent —
                                        exits 0 if a relay is already listening.

Global flags:
  --target-id <id>          Pick a specific Chrome tab by CDP target ID.
  --target-url <substring>  Pick by URL substring match.
  --target-title <s>        Pick by title substring match.
  --query <text>            Pick by title or URL substring (tabs + snapshot/click/etc).
  --page-name <name>        Create/use a named relay tab for open/goto/snapshot/screenshot/evaluate/fill/click/type/autofill-profile/focus.
  --focus window|tab        Per-call focus override (open/goto/focus). Does not change popup default.
  --reason <text>           Why focus is needed (human-in-the-loop audit).
  --timeout-ms <ms>         Hard timeout (1000-120000, default 30000).
  --quiet                   Suppress stderr progress lines.
  -h, --help                Show this help.

Examples:
  browser-hand snapshot --target-url localhost:5174
  browser-hand open --url https://example.com --page-name smoke
  browser-hand focus --page-name smoke --focus window --reason "2fa"
  browser-hand open --url https://example.com --page-name smoke --focus window --reason "confirm"
  browser-hand tabs
  browser-hand tabs --query stripe
  browser-hand snapshot --query stripe
  browser-hand doctor
  browser-hand fill --fields '{"Email":"a@b.c"}'
  browser-hand autofill-profile --context personal
  browser-hand relay   # keep a persistent relay up; leave running, Ctrl-C to stop
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "-h" || tok === "--help") {
      args.help = true;
    } else if (tok === "--quiet") {
      args.quiet = true;
    } else if (tok === "--full-page") {
      args.fullPage = true;
    } else if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(tok);
    }
  }
  return args;
}

function fail(message, code = 2) {
  process.stderr.write(`browser-hand: ${message}\n`);
  process.exit(code);
}

function buildTarget(args) {
  const target = {};
  if (args["target-id"]) {
    target.id = args["target-id"];
  }
  if (args["target-url"]) {
    target.url = args["target-url"];
  }
  if (args["target-title"]) {
    target.title = args["target-title"];
  }
  if (typeof args.query === "string" && args.query.trim()) {
    target.query = args.query.trim();
  }
  return Object.keys(target).length > 0 ? target : undefined;
}

function parseJsonFlag(value, flagName) {
  if (typeof value !== "string") {
    fail(`--${flagName} requires a JSON value`);
  }
  try {
    return JSON.parse(value);
  } catch (err) {
    fail(`--${flagName} is not valid JSON: ${err.message}`);
  }
  return undefined;
}

function buildHandlerInput(operation, args) {
  const input = {
    mode: "current",
    operation,
  };
  if (typeof args["page-name"] === "string" && args["page-name"].trim()) {
    input.pageName = args["page-name"].trim();
  }
  if (Object.prototype.hasOwnProperty.call(args, "query")) {
    if (typeof args.query !== "string" || !args.query.trim()) {
      fail("--query requires a non-empty value");
    }
    input.query = args.query.trim();
  }
  const target = buildTarget(args);
  if (target) {
    input.target = target;
  }
  if (typeof args["timeout-ms"] === "string") {
    const ms = Number(args["timeout-ms"]);
    if (Number.isFinite(ms)) {
      input.timeoutMs = ms;
    }
  }
  // Per-call focus override (does not change extension popup default).
  if (args.focus === true) {
    input.focusPolicy = "window";
  } else if (typeof args.focus === "string" && args.focus.trim()) {
    input.focusPolicy = args.focus.trim();
  }
  if (typeof args.reason === "string" && args.reason.trim()) {
    input.focusReason = args.reason.trim();
  } else if (typeof args["focus-reason"] === "string" && args["focus-reason"].trim()) {
    input.focusReason = args["focus-reason"].trim();
  }
  if (typeof args["focus-ttl-ms"] === "string") {
    const ttl = Number(args["focus-ttl-ms"]);
    if (Number.isFinite(ttl)) {
      input.focusTtlMs = ttl;
    }
  }

  switch (operation) {
    case "open":
      if (typeof args.url !== "string") {
        fail("open requires --url");
      }
      input.url = args.url;
      break;
    case "doctor":
      break;
    case "tabs":
      if (typeof args.query === "string" && args.query.trim()) {
        input.query = args.query.trim();
      }
      break;
    case "snapshot":
      break;
    case "screenshot":
      if (args.fullPage) {
        input.fullPage = true;
      }
      break;
    case "autofill_profile":
      if (args.profile) {
        input.profile = args.profile;
      }
      if (args.context) {
        input.contextHint = args.context;
      }
      break;
    case "fill_fields":
      input.fields = parseJsonFlag(args.fields, "fields");
      break;
    case "click":
      if (args.selector) {
        input.selector = args.selector;
      }
      if (args.text) {
        input.text = args.text;
      }
      if (!input.selector && !input.text) {
        fail("click requires --selector or --text");
      }
      break;
    case "type":
      if (args.selector) {
        input.selector = args.selector;
      }
      if (args.label) {
        input.label = args.label;
      }
      input.text = typeof args.text === "string" ? args.text : "";
      if (!input.selector && !input.label) {
        fail("type requires --selector or --label");
      }
      break;
    case "evaluate":
      if (typeof args.code !== "string") {
        fail("evaluate requires --code");
      }
      input.code = args.code;
      break;
    case "goto":
      if (typeof args.url !== "string") {
        fail("goto requires --url");
      }
      input.url = args.url;
      break;
    case "focus":
      // Defaults to window so `focus --page-name X --reason 2fa` is enough.
      if (!input.focusPolicy) {
        input.focusPolicy = "window";
      }
      break;
    default:
      fail(`Unknown operation: ${operation}`);
  }
  return input;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || args._.length === 0) {
    process.stdout.write(HELP);
    process.exit(args.help ? 0 : 2);
  }

  const raw = args._[0];
  const operation = OP_ALIASES[raw] || raw;

  if (args.quiet) {
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
  }

  if (operation === "relay") {
    let res;
    try {
      // Resolves immediately if a relay is already up; otherwise blocks,
      // serving the relay in the foreground until it exits (Ctrl-C).
      res = await startPersistentRelay();
    } catch (err) {
      fail(err && err.message ? err.message : String(err), 1);
      return;
    }
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    process.exit(res.alreadyRunning ? 0 : res.exitCode || 0);
  }

  const input = buildHandlerInput(operation, args);

  let result;
  try {
    result = await devBrowserTool.handler(input);
  } catch (err) {
    result = {
      success: false,
      error: err && err.message ? err.message : String(err),
    };
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result && result.success === true ? 0 : 1);
}

const invoked = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invoked) {
  main().catch((err) => {
    process.stderr.write(`browser-hand: ${err.stack || err}\n`);
    process.exit(1);
  });
}

export { parseArgs, buildHandlerInput };
