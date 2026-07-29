# Browser Hand

**Give your coding agent a hand on your real Chrome** — the one already signed in to Gmail, GitHub, admin panels, and the rest of your work.

A [Very Good Plugins](https://github.com/verygoodplugins) project, forked from [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) (MIT). Upstream CLI/daemon for headless work stays available; **the product default is the extension path** into your everyday browser profile.

## Why not `--remote-debugging-port`?

Attaching automation through Chrome’s remote debugging port (or “controlled by automated test software” WebDriver mode) is fine for throwaway Chromium. It’s a bad fit for **your real logged-in profile**:

| Problem | What happens |
|---|---|
| **Chrome blocks debug ports on the default profile** | Since Chrome 136, `--remote-debugging-port` is ignored unless you pass a **non-default** `--user-data-dir`. You cannot open a debug port on everyday Chrome without a separate profile. |
| **Sites detect the debug / automation surface** | Many providers (including **Google OAuth and related sign-in**) refuse or challenge sessions that look automated or debugger-attached. You can spend hours fighting blocks that never appear in a normal window. |
| **Focus theft** | Typical CDP/Playwright attach **activates tabs and steals the OS window** while you’re typing elsewhere. |
| **Empty profile tax** | A dedicated debug profile has none of your cookies or extensions. Re-login every service, then hope detection doesn’t fire anyway. |

Browser Hand takes a different route: a small **Chrome extension** bridges your normal profile to a **local relay** on your machine. Agents talk to the CLI; the extension drives tabs. No remote-debug flag on the default profile, no WebDriver banner, and **background work by default** so automation doesn’t yank focus.

## What you get

- **Real sessions** — use the Chrome profile you already use (cookies, passkeys, extensions, open tabs).
- **Background-first** — open and automate tabs without stealing OS focus; optional one-shot focus only when a human must look (2FA, captcha, confirm).
- **Agent-shaped CLI** — `doctor`, named pages, snapshot, fill, click, type, evaluate, screenshot — JSON out, logs on stderr.
- **Hard pages** — soft recovery when password managers detach the debugger; scripting fallback; shadow DOM / iframe pierce; human-like pointer and contenteditable input.
- **Agent gym** — local challenge pages under `extension/challenges/` built to exercise agent failure modes (labels, modals, SPA routes, username fields), not just “click the demo button once.”
- **Optional headless** — upstream sandboxed QuickJS + Playwright CLI when you want CI or a clean browser, not your daily profile.

## Install

Two pieces: the **agent skill** (when to use Browser Hand, command recipes) and the **runtime** (Chrome extension + local relay + CLI).

### 1. Skill via AutoVault (recommended)

[AutoVault](https://github.com/autoworks-ai/autovault) is a local-first vault for agent skills: it validates and signs skill packages, then syncs them into Claude Code, Codex, and other agents so you are not copy-pasting `SKILL.md` files by hand. Docs: [autovault.dev](https://autovault.dev).

If you already use AutoVault:

```bash
# Install or update AutoVault: https://autovault.dev  or  curl -fsSL https://autovault.sh | sh
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
# equivalent:
# autovault add https://github.com/verygoodplugins/browser-hand/tree/main/skills/browser-hand --sync-profiles
```

That admits the skill into your vault and links it into agent skill directories. It does **not** replace the runtime below — agents still need the extension bridge running on your machine.

### 2. Runtime (extension + relay + CLI)

```bash
git clone https://github.com/verygoodplugins/browser-hand.git
cd browser-hand
npm run install:extension     # builds relay + extension; also copies the skill if AutoVault is not in play

# Chrome → chrome://extensions → Developer mode → Load unpacked
#   → select: extension/.output/chrome-mv3

npm run relay                 # leave the local bridge up
npm run doctor                # healthy when status is tab_bootstrap_works
```

### Without AutoVault

Skip step 1. `npm run install:extension` copies `skills/browser-hand` into `~/.claude/skills` (and Codex/agents paths when present). You still need the runtime steps in §2.

### Drive a tab

```bash
browser-hand open --url https://example.com --page-name demo
browser-hand snapshot --page-name demo
browser-hand click --page-name demo --text "More information..."
browser-hand screenshot --page-name demo
```

Live smoke (uses your real Chrome):

```bash
npm run smoke:live
```

**Load the skill when** the task needs an **already signed-in browser** (forms, admin UIs, cookies, open tabs). Prefer it over a fresh Chromium whenever real logins matter.

**Skip the skill** for plain public HTTP fetches, or for disposable headless browsers (upstream `dev-browser` CLI).

## Layout

| Path | Role |
|---|---|
| `path-a/` | `browser-hand` CLI for the extension bridge |
| `relay/` | Local WebSocket bridge (extension ↔ automation) |
| `extension/` | Chrome MV3 extension |
| `skills/browser-hand/` | Agent skill (Claude Code, Codex, etc.) |
| `extension/challenges/` | Agent obstacle course |
| `bin/dev-browser` | Upstream headless / sandboxed CLI |

## Headless / remote-debug (optional)

For CI and throwaway automation, the upstream-style CLI remains:

```bash
npm install -g .          # or use the published upstream package
dev-browser install
dev-browser --headless <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(await page.title());
EOF
```

`--connect` still needs a Chrome launched with remote debugging on a **non-default** profile — not your everyday logged-in window. See skill references for details.

## Compared to nearby projects

| Project | Focus |
|---|---|
| [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) | Sandboxed CLI + skill; attach via remote debugging or launch Chromium |
| [code-yeongyu/dev-browser-enhanced](https://github.com/code-yeongyu/dev-browser-enhanced) | Upstream + Playwright anti-detection patches only |
| **Browser Hand** | Extension bridge into **real logged-in Chrome**, background focus, agent recovery + gym |

More context: [FORK.md](./FORK.md).

## Works with

| | |
|---|---|
| **[AutoVault](https://github.com/autoworks-ai/autovault)** | Preferred way to install and sync this skill (and others) into your agents. Local validate → sign → profile sync. |
| **[AutoMem](https://github.com/verygoodplugins/automem)** | Long-term memory for agents when a workflow needs durable recall across sessions — complementary, not required for browser control. |

Browser Hand stands alone for logged-in Chrome automation. AutoVault is how skills land on the machine; AutoMem is where lasting memory lives when you need it.

## Demo (upstream)

https://github.com/user-attachments/assets/c6cf7fb9-b1dc-46ed-93b9-6e7240990c53

## License

MIT. Upstream © Sawyer Hood; Browser Hand changes © Very Good Plugins and contributors.
