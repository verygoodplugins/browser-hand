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
agents: [claude-code, codex, grok]
metadata:
  author: verygoodplugins
  version: "0.6.1"
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
browser-hand snapshot
browser-hand snapshot --query stripe
browser-hand open --url https://example.com --page-name work
browser-hand snapshot --page-name work
browser-hand fill --page-name work --fields '{"Email":"a@b.c"}'
browser-hand click --page-name work --text "Submit"
browser-hand type --page-name work --label "Bio" --text "Hello"
browser-hand evaluate --page-name work --code 'document.title'
browser-hand screenshot --page-name work
# Multi-step on one named tab: one attach, no reattach between ops.
browser-hand batch --page-name work --steps '[{"operation":"open","url":"https://example.com"},{"operation":"fill_fields","fields":{"Email":"a@b.c"}},{"operation":"click","text":"Submit"}]'
```

Full reference: `references/extension-cli.md`.

## Agent rules

- Prefer **named pages** (`--page-name`) for multi-step work. Use `batch --steps` when several ops share that tab so the CLI keeps one CDP session instead of reattaching each call.
- To work on the tab the user is looking at, run `snapshot` (no flags) or `tabs` first. If several windows each have an active tab, pass `--query`. Do **not** use `doctor` as a tab list — it is a health check.
- Use `tabs --query <text>` or `snapshot --query <text>` instead of grepping a dumped doctor file.
- **Do not** request window focus for ordinary fill/click/snapshot. Only use `focus --focus window --reason "…"` when a human must act (2FA, captcha, confirm).
- Snapshot or screenshot **before and after** writes; verify with evaluate when critical.
- On username/password manager weirdness, soft recovery is built in — retry evaluate/fill; re-open the named page if screenshot still fails.

## Optional headless

For CI / empty profile only: upstream `dev-browser --headless` or `--connect` to a **non-default** debug profile. See `references/remote-debug-fallback.md`. Never treat that as “drive my daily Chrome.”

## Read-only / audit

Observation-only tasks: no Save/Publish/Delete; evidence from the authenticated profile; filenames with provenance. See `references/troubleshooting.md`.
