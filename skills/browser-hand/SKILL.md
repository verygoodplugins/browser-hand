---
name: browser-hand
description: >
  Drive the user's already-open, logged-in Chrome — forms, clicks, screenshots,
  evaluate, authenticated admin UIs and real cookies/tabs. Prefer this whenever
  work needs the normal Chrome profile (Gmail, GitHub, OAuth-backed sites, open
  tabs). Do NOT use for disposable headless pages or plain HTTP fetches.
  Trigger phrases: signed-in Chrome, logged-in browser, real session, existing
  tabs, cookies, fill this form on my browser, screenshot my account, use my
  Chrome, authenticated site, without remote debugging.
license: MIT
compatibility: Requires local Chrome with the Browser Hand extension and relay.
category: browser
tags: [browser, chrome, extension, automation, authenticated-sessions, agent]
agents: [claude-code, codex, grok, cursor]
metadata:
  author: verygoodplugins
  version: "0.7.2"
resources:
  - path: references/setup.md
    type: file
  - path: references/extension-cli.md
    type: file
  - path: references/remote-debug-fallback.md
    type: file
  - path: references/troubleshooting.md
    type: file
  - path: scripts/anon-screenshot.sh
    type: file
---

# Browser Hand

Control the user’s **real browser profile** — whichever browser has the Browser Hand extension connected (usually Chrome, but any Chromium browser: Edge, Brave, Arc, "Search", …) — through a local extension bridge. No `--remote-debugging-port` on the everyday profile. `doctor` reports `browser: {name, version}` so you target the connected browser instead of assuming Chrome.

This is a **skill**, not an MCP server: no always-on tool list and no extra MCP process. The agent loads it when the task matches (signed-in browser work).

## When to load this skill

**Load it when any of these are true:**

- The task needs a site the user is **already signed into**.
- The user mentions **existing tabs, cookies, “my Chrome,” “logged in,” or a real account**.
- Remote debugging / a fresh Chromium would lose auth or get blocked (common with Google and other OAuth).

**Skip it when:**

- A public page can be fetched with HTTP / `WebFetch`.
- The user only wants a **disposable headless** browser (use the upstream `dev-browser` CLI).

## Why this instead of remote debugging

1. Modern Chrome **will not** attach a remote-debug port to the **default** profile without a separate user-data dir.
2. Sites often **block** debugger/automation-shaped sessions (including Google OAuth).
3. This stack defaults to **background tabs** — no stealing OS focus while the user works.
4. Recovery paths for password-manager wedges and multi-step agent flows; local **challenge gym** for agent-shaped failures.

## Page control: debugger-free by default

The extension drives pages with `chrome.scripting` + `chrome.tabs` (no `chrome.debugger`), so there is no "started debugging this browser" banner and nothing for a site to detect. Snapshot, click, type, fill, evaluate, goto and screenshot all work this way. Browsers that stub `chrome.debugger` (the macOS **Search** browser) therefore work with no setup.

- `browser-hand doctor` reports `transport` (`mode`, `effective`, `debuggerAvailable`).
- The popup's **Page control** selector opts into the CDP debugger transport; it falls back to debugger-free automatically where the API is stubbed or missing.
- Pages whose CSP forbids `eval` need `chrome.userScripts`: turn on **Allow User Scripts** for Browser Hand on the extensions page (Chrome 138+). Search provides it once the extension declares the permission. Without it those pages fail with an error that says so.
- Not available without the debugger: `screenshot --full-page` (visible viewport only) and tab groups where `chrome.tabGroups` is missing (tabs are left ungrouped).

## Pieces (repo root)

| Piece | Command / path |
|---|---|
| CLI | `browser-hand` or `node cli-js/src/cli.js` |
| Relay | `browser-hand-relay` / `npm run relay` — `ws://127.0.0.1:9333` |
| Extension | Load unpacked `extension/dist/chrome-mv3` (name: Browser Hand) |
| Challenges | `extension/challenges/` (default gym port **8766**) |

## Setup (once)

```bash
npm run setup
# Chrome → Load unpacked → extension/dist/chrome-mv3
npm run relay    # leave running
npm run doctor   # want status: tab_bootstrap_works
```

Switching from old `dev-browser` skill/extension? `npm run setup -- --cleanup-legacy`

Details: `references/setup.md`.

## Daily commands

```bash
browser-hand doctor
browser-hand tabs
browser-hand tabs --query stripe
browser-hand open --url https://example.com --page-name work --group-title "DNS records"
browser-hand snapshot --page-name work --quiet
browser-hand click --page-name work --role button --name "Submit" --quiet
browser-hand click --page-name work --ref e12 --quiet
browser-hand fill --page-name work --fields '{"Email":"a@b.c"}' --quiet
browser-hand steps --page-name work --quiet --steps '[{"op":"click","role":"combobox","name":"Type"},{"op":"fill","fields":{"Name":"www"}}]'
browser-hand type --page-name work --label "Bio" --text "Hello"
browser-hand evaluate --page-name work --code 'document.title' --quiet
browser-hand screenshot --page-name work
browser-hand close --page-name work
```

Full reference: `references/extension-cli.md`.

## Agent rules

- Prefer **named pages** (`--page-name`) for multi-step work.
- On the first `open` of a task, pass `--group-title` with a few words ("DNS records", "Invoice review"). That names the Chrome tab group and gives it a color. Later commands in the same task omit it and join that group. A different title starts a new group. Leaving it off keeps the group named Browser Hand.
- Close the tabs you opened when the task is done: `close --page-name work`, or `close --group-title "DNS records"` for the whole group. `close` only closes tabs Browser Hand opened and refuses a tab the user had open. Never add `--include-user-tabs` on your own; only when the user names the tab to close. A selector that matches several tabs is refused without `--all`, and `close` never defaults to the active tab. Read `closed` in the result: it is `true` only after the tab left Chrome.
- Pass **`--quiet`** on snapshot, click, fill, evaluate, and steps. It drops the repeated `mode` / `target` / `url` / `title` wrapper.
- `doctor` returns `status`, `browser: {name, version}`, `tabCount`, and the active tab. It is a health check. Use `tabs` for the inventory. `doctor --verbose` is only for diagnosing target selection. `doctor --browser <name>` asserts which connected browser you expect and warns on a mismatch.
- **Never open tabs with OS commands.** Do not fall back to `open -a "Google Chrome" <url>`, `start`, `xdg-open`, or any shell launcher — that opens the wrong browser (not the one with the extension) and loses the session. Always use `browser-hand open`/`goto`. If `open` fails, report the error; do not route around it.
- To show a **local file** (a generated HTML brief, report, etc.), pass its `file:` URL to `open --url file:///…`. `chrome.tabs.create` cannot navigate to `file:` URLs, so the CLI registers the file with the relay and opens a capability URL (`http://127.0.0.1:<doc-port>/local/<token>/<name>`) on a **separate origin** from the relay API. Relative resources (`./style.css`, `img/a.png`, `sub/page.html`) resolve from that URL, and the `file:` URL's query string and `#hash` are kept. Only files inside the document's own directory are served: no `..` escapes, no symlinks out, no dotfiles (`.env`), nothing from a sibling directory. The page can't call the relay or other origins (CSP `connect-src 'self'`), so a report that `fetch`es remote JSON won't work this way. The token expires after 2 hours idle and dies with the relay. If `open` says the relay can't serve local documents, restart it (`browser-hand relay`); don't open the file path directly.
- If `doctor` reports `status: debugger_unavailable`, the connected browser restricts `chrome.debugger` (`doctor.debugger` carries the browser's reason); Browser Hand drives it via the scripting transport. open/snapshot/fill/click/evaluate still work — this is **not** the `path_b_required` (separate debug profile) case. It is reported even though the smoke tab opened, and `doctor` still exits non-zero because only `tab_bootstrap_works` is the healthy status; full-CDP methods such as `Page.navigate` are rejected on these tabs.
- To work on the tab the user is looking at, run `snapshot` (no flags) or `tabs` first. If several windows each have an active tab, pass `--query`.
- Default snapshot is the open dialog (and an open listbox or menu) plus the main landmark. Read `snapshot.nodes`: `ref`, `role`, `name`, and `value` / `ariaChecked`. Nav is omitted. `--scope full` adds `nav` and page text. `--scope nav` is the landmark only.
- Click with `--ref` from that snapshot, or `--role` and `--name` (exact). `--text "A"` is ambiguous when the same string is both a value and a label. `--selector` remains for CSS.
- A repeated form is one `steps` call: click, fill, click, then evaluate the new row. Stop at the first miss (`failedAt`).
- Click returns `result.state` and, for toggles and fields, `stateChanged`. `success: true` means the pointer sequence was dispatched. `documentHidden: true` or `stateChanged: false` on a switch means it may not have landed.
- Click does **not** focus the tab or the window. `focus --focus tab` activates the tab and reports `focus.visibilityState`; that can stay `hidden` while the Chrome window is in the background. Only `focus --focus window --reason "…"` makes the document visible, and only when a person must act (2FA, captcha, confirm).
- Chrome shows "Browser Hand started debugging this browser" when `chrome.debugger.attach` runs. Cancel or X is detach reason `canceled_by_user`. Browser Hand keeps that tab in the session and does not reattach. Later commands on the tab use the scripting transport, so the bar stays dismissed until the extension is reloaded or toggled off and on. Do not focus the window to fight the bar.
- Fill from `snapshot.nodes` or `snapshot.forms` (label, type, name). A visible label is the right key (`"Name"`), not the input's name attribute.
- After `fill`, read `result.failed`. `success: true` means every key was written.
- On username/password manager weirdness, soft recovery is built in — retry evaluate/fill; re-open the named page if screenshot still fails.

## Optional headless

For CI / empty profile only: upstream `dev-browser --headless` or `--connect` to a **non-default** debug profile. See `references/remote-debug-fallback.md`. Never treat that as “drive my daily Chrome.”

## Read-only / audit

Observation-only tasks: no Save/Publish/Delete; evidence from the authenticated profile; filenames with provenance. See `references/troubleshooting.md`.
