# AGENTS.md

This file is the **canonical** project guidance for coding agents (Claude Code, Codex, Cursor, Grok Build, and others). `CLAUDE.md` is a one-line `@AGENTS.md` import so Claude Code loads the same content.

## Project

**Browser Hand** gives agents a hand on the user's **real logged-in Chrome** — cookies, passkeys, open tabs, admin UIs — via a local MV3 extension bridge. Product default is the extension path, not remote debugging.

Upstream headless CLI (fork of [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser)) remains for CI / disposable Chromium. See [MIGRATING.md](./MIGRATING.md) for rename map and [FORK.md](./FORK.md) for product intent.

| Layer | Path | Role |
|---|---|---|
| CLI (product) | `cli-js/` | `browser-hand` — Node CLI for the extension bridge (workspace `browser-hand-cli`) |
| Relay | `relay/` | Local WebSocket bridge (`ws://127.0.0.1:9333`) |
| Extension | `extension/` | Chrome MV3 (WXT); load `extension/dist/chrome-mv3` |
| Skill | `skills/browser-hand/` | When/how agents should drive real Chrome |
| Upstream headless | `cli/` + `daemon/` + `bin/dev-browser` | Rust CLI + Node daemon + QuickJS sandbox |

**No AutoHub required.** This monorepo is self-contained. AutoHub (if present) may shell out to the `browser-hand` CLI as a thin adapter — do not dual-maintain the extension stack elsewhere.

## Product rules (do not regress)

1. **Background-first focus** — never steal OS/window focus for ordinary open/snapshot/fill/click. One-shot focus only for human-in-the-loop (2FA, captcha, confirm) with an explicit reason.
2. **Real profile over remote debug** — do not treat `--remote-debugging-port` on the default profile as a supported path. Headless/`--connect` is for non-default or empty profiles only.
3. **Named pages** — multi-step agent work should use `--page-name` so soft-detach and recovery stay sticky.
4. **Local gym safety** — obstacle course under `extension/challenges/`; public sites stay navigate/snapshot-only (no third-party form submits during dogfood).
5. **JSON on stdout** — CLI machine output is JSON on stdout; logs go to stderr.

## Common commands

```bash
# Product stack (extension path)
npm install
npm run setup               # one-command: relay + extension + skill (alias: install:extension)
npm run relay               # leave the local bridge up
npm run doctor              # healthy when status is tab_bootstrap_works
npm run smoke:live          # real Chrome smoke
npm run browser-hand -- --help
# or: browser-hand --help after link/install

# Optional: remove legacy skill aliases named "dev-browser"
npm run setup -- --cleanup-legacy

# Extension unit tests
cd extension && npm test

# Obstacle course (default port 8766; 8765 often taken)
cd extension && bash scripts/serve-challenges.sh

# Upstream headless (optional CI / disposable browser)
cd daemon && npx tsc --noEmit
cd daemon && pnpm vitest run
cd daemon && pnpm bundle && pnpm bundle:sandbox-client   # before cargo if daemon runtime changed
cd cli && cargo build
```

`cli/src/daemon.rs` embeds `daemon/dist/daemon.bundle.mjs` and `daemon/dist/sandbox-client.js` via `include_str!`. Rebuild those bundles before `cargo build` when daemon runtime changes.

## Tooling

- **Node** for `cli-js/`, `relay/`, `extension/`, root packaging. **Do not use Bun.**
- **pnpm** for `daemon/` only.
- **Cargo** for `cli/` (Rust headless binary — distinct from `cli-js/`).
- Extension package manager: npm (WXT). Prefer workspace scripts from repo root.
- User-facing product language: **Browser Hand** / `browser-hand`. Do not say “Path A” (obsolete AutoHub routing label).

## Architecture notes

- **Extension services:** `extension/services/{ConnectionManager,CDPRouter,TabManager,StateManager}.ts` — attach, tab targeting, CDP routing, focus policy.
- **Relay:** `relay/src/relay.ts` — extension ↔ CLI WebSocket.
- **CLI surface:** `cli-js/src/{cli,tool,autofill*}.js` — doctor, open, snapshot, fill, click, type, evaluate, screenshot, focus.
- **Skill contract:** `skills/browser-hand/SKILL.md` + `references/*` — agent recipes and platform gotchas. Prefer skill updates over scattering recipes into random docs.
- **Challenge ledger:** `extension/challenges/LEDGER.md` — pass/fail and fix commits for the agent gym.

## Naming (agent-facing)

| Prefer | Avoid (stale) |
|---|---|
| Browser Hand | “dev-browser” as product name |
| `browser-hand` CLI | AutoHub `dev_browser` tool as primary path |
| skill `browser-hand` | skill `dev-browser` (legacy alias only; prefer `--cleanup-legacy`) |
| `extension/dist/chrome-mv3` | `extension/.output/chrome-mv3` |
| `cli-js/` (product Node CLI) | `path-a/` or “Path A” |
| “extension path” / Browser Hand | “Path A” in any user-facing text |
| `AGENTS.md` | editing only `CLAUDE.md` |

`dev-browser` may still appear as the **upstream binary name**, env prefixes (`DEV_BROWSER_*`), config dir (`~/.dev-browser/`), and historical commits. That is intentional for the headless line; do not rename those casually without a MIGRATING.md update.

## Validation before claiming done

For **product/extension/CLI** changes:

```bash
npm run build:relay
cd extension && npm test
# after extension UX change: rebuild + reload unpacked extension, then npm run doctor
```

For **upstream daemon/CLI** changes: daemon typecheck + vitest + (if bundles changed) rebundle + `cargo build`.

Live Chrome claims need command evidence (`doctor`, smoke, or gym oracle) — not screenshots alone.

## Commit style

Conventional commits when releasing or when the repo is on release-please:

- `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`
- Dogfood / gym fixes may use the Problem / Fix / Expected improvement body shape when iterating the obstacle course.

## PR hygiene

- Open PRs ready for review by default (draft only if asked).
- Do not merge without explicit operator authorization.
- Security reports: private GitHub Security Advisories (see `.github/SECURITY.md`) — never file vulns as public issues.

## Memory (when AutoMem MCP is available)

Project slug tag: **`browser-hand`**. Session recall and storage follow the global AutoMem ritual (preferences + task context). Do not invent local `MEMORY.md` substitutes.

## Related docs

| Doc | Use |
|---|---|
| [README.md](./README.md) | User install and layout |
| [MIGRATING.md](./MIGRATING.md) | dev-browser → browser-hand rename map |
| [FORK.md](./FORK.md) | Why the fork exists |
| [docs/ecosystem-links.md](./docs/ecosystem-links.md) | How we link AutoVault / AutoMem without hard sell |
| [skills/browser-hand/SKILL.md](./skills/browser-hand/SKILL.md) | Runtime agent skill |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Human contributor process |
| [RELEASING.md](./RELEASING.md) | Release notes (still dual-line: product + upstream binary) |
