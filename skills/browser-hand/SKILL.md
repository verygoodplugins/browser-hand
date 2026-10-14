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

Control the user’s **real Chrome profile** through a local extension bridge. No `--remote-debugging-port` on the everyday profile.

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
```

Full reference: `references/extension-cli.md`.

## Agent rules

- Prefer **named pages** (`--page-name`) for multi-step work.
- On the first `open` of a task, pass `--group-title` with a few words ("DNS records", "Invoice review"). That names the Chrome tab group and gives it a color. Later commands in the same task omit it and join that group. A different title starts a new group. Leaving it off keeps the group named Browser Hand.
- Pass **`--quiet`** on snapshot, click, fill, evaluate, and steps. It drops the repeated `mode` / `target` / `url` / `title` wrapper.
- `doctor` returns `status`, `tabCount`, and the active tab. It is a health check. Use `tabs` for the inventory. `doctor --verbose` is only for diagnosing target selection.
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
