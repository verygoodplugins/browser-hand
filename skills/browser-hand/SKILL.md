---
name: browser-hand
description: Use when driving the user's logged-in Chrome — forms, clicks, screenshots, scripting authenticated sites via the Path A extension relay (default). Optional upstream headless --connect fallback.
license: MIT
tags: [browser-automation, browser-hand, chrome-extension, cdp, playwright, authenticated-sessions, autofill]
category: browser
agents: [claude-code, codex, grok]
metadata:
  version: "0.5.0"
capabilities:
  network: true
  filesystem: readwrite
  tools: [Bash, Read, Write]
resources:
  - path: scripts/anon-screenshot.sh
    type: file
  - path: references/setup.md
    type: file
  - path: references/path-a-extension-relay.md
    type: file
  - path: references/path-b-headless-connect.md
    type: file
  - path: references/platform-gotchas.md
    type: file
  - path: references/troubleshooting.md
    type: file
---

# Browser Hand

Self-contained stack for agent control of the user's **real logged-in Chrome**.

| Piece | Location |
|---|---|
| Path A CLI | `path-a/src/cli.js` (bin: `browser-hand`) |
| Extension relay | `relay/` → `ws://127.0.0.1:9333` |
| Chrome MV3 extension | `extension/` (WXT; load unpacked build) |
| Upstream headless CLI | `dev-browser` (Sawyer daemon; optional Path B) |

## Paths

| Path | When | Notes |
|---|---|---|
| **A. Extension relay (default)** | Doctor, open named tabs, snapshot, fill, click, type, evaluate, screenshot, goto on the **default Chrome profile**. | No `--remote-debugging-port`, no WebDriver banner. |
| **B. `--connect` (fallback)** | Multi-step QuickJS scripts / `setInputFiles` in a **dedicated** debug profile. | Chrome 136+ cannot attach a debug port to the default profile — Path B is not for everyday logged-in Chrome. |

**Default to Path A.** On Chrome 136+ it is structural: Path B cannot reach the authenticated default profile.

## Autonomy contract

Documented gotchas are applied without re-asking. New platform quirks append to `references/platform-gotchas.md` on the same run.

Do **not** steal OS focus for ordinary automation (`focusPolicy: background`). Use one-shot `focus --focus window --reason …` only for human-in-the-loop (2FA, captcha, confirm).

## Prerequisites (quick)

```bash
# From the browser-hand monorepo root
npm install
npm run build:relay
npm run build:extension   # then chrome://extensions → Load unpacked → extension/.output/chrome-mv3
npm run doctor            # expect status: "tab_bootstrap_works"
```

Full setup: `references/setup.md`.

## Quickstart (Path A)

```bash
node path-a/src/cli.js doctor
node path-a/src/cli.js open --url https://example.com --page-name smoke
node path-a/src/cli.js snapshot --page-name smoke
```

Command reference: `references/path-a-extension-relay.md`.

## Agent UX (Path A dogfood)

- **Background focus by default** — no OS steal; optional one-shot focus for HITL.
- **`--page-name` on fill/click/type** — same named tab as open/snapshot.
- **Human-like click/type** — pointer sequence; contenteditable beforeinput; ARIA option/menuitem; shadow + same-origin iframe pierce.
- **Username/password wedge** — soft-detach + scripting fallback in the extension.
- **Obstacle course** — `extension/challenges/` on **:8766**; `window.__oracle()`.

## When to use

- Authenticated / already-open Chrome work (forms, clicks, screenshots, evaluate).
- User says "signed-in Chrome", "real account", "existing tabs", "cookies".

## When NOT to use

- Posting under the user's identity without explicit per-platform authorization.
- Pure public page fetches better served by HTTP/`WebFetch`.

## Read-only / audit

Use the stricter mode in `references/troubleshooting.md` — evidence from authenticated Chrome, no Save/Publish/Delete, provenance in filenames.
