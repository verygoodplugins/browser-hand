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
- **Agent-shaped CLI** — `tabs`, `doctor`, named pages, snapshot, fill, click, type, evaluate, screenshot — JSON out, logs on stderr.
- **Hard pages** — soft recovery when password managers detach the debugger; scripting fallback; shadow DOM / iframe pierce; human-like pointer and contenteditable input.
- **Agent gym** — local challenge pages under `extension/challenges/` built to exercise agent failure modes (labels, modals, SPA routes, username fields), not just “click the demo button once.”
- **Optional headless** — upstream sandboxed QuickJS + Playwright CLI when you want CI or a clean browser, not your daily profile.

## Install

One command builds the product stack (relay + extension + skill copies). Chrome still needs a one-time **Load unpacked** — browsers do not allow that without a human.

```bash
git clone https://github.com/verygoodplugins/browser-hand.git
cd browser-hand
npm run setup                 # builds relay + extension + installs skill

# Chrome → chrome://extensions → Developer mode → Load unpacked
#   → select: extension/dist/chrome-mv3   (name: Browser Hand)

npm run relay                 # leave the local bridge up
npm run doctor                # healthy when status is tab_bootstrap_works
```

`npm run setup` also opens the load folder in Finder on macOS.

### Skill via AutoVault (optional)

[AutoVault](https://github.com/autoworks-ai/autovault) syncs the agent skill into Claude Code / Codex without hand-copying. Docs: [autovault.dev](https://autovault.dev).

```bash
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
```

That does **not** replace `npm run setup` — agents still need the extension bridge on your machine.

### Without AutoVault

`npm run setup` copies `skills/browser-hand` into `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills` when those dirs exist.

### Switching from old `dev-browser` installs

```bash
npm run setup -- --cleanup-legacy
```

Removes legacy skill aliases named `dev-browser` and prints how to remove an old unpacked Chrome extension. Does **not** delete Chrome profile data or `~/.dev-browser/`. See [MIGRATING.md](./MIGRATING.md).

### Drive a tab

```bash
browser-hand tabs
browser-hand snapshot                  # last-focused tab
browser-hand snapshot --query stripe
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
| `cli-js/` | Product Node CLI (`browser-hand` bin; workspace `browser-hand-cli`) |
| `relay/` | Local WebSocket bridge (extension ↔ automation) |
| `extension/` | Chrome MV3 extension (load `extension/dist/chrome-mv3`) |
| `skills/browser-hand/` | Agent skill (Claude Code, Codex, etc.) |
| `extension/challenges/` | Agent obstacle course |
| `cli/` + `daemon/` + `bin/dev-browser` | Upstream headless / sandboxed CLI (Rust + Node) |
| `AGENTS.md` | Canonical agent project guide (`CLAUDE.md` → `@AGENTS.md`) |
| `MIGRATING.md` | Rename map from historical “dev-browser” / Path A naming |

Coming from upstream or an older AutoHub-era install? Start with **[MIGRATING.md](./MIGRATING.md)**.

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
