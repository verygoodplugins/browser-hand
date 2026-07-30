# Migrating to Browser Hand

This document maps names and paths from **upstream / historical “dev-browser”** and internal **“Path A”** routing to the **Browser Hand** product monorepo.

## Why the rename

Upstream [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) is a sandboxed CLI + skill aimed at headless or remote-debug Chromium. **Browser Hand** keeps that line and adds a **first-class extension bridge** into the user’s normal Chrome profile (cookies, passkeys, open tabs).

The product name is **Browser Hand**. “dev-browser” is no longer the agent-facing product name for real Chrome. “Path A” was an AutoHub-era routing label for the extension bridge — keep it out of docs and CLI help; the product surface is `browser-hand`.

## Quick map

| Old / upstream | Browser Hand |
|---|---|
| Product name “dev-browser” | **Browser Hand** |
| CLI `dev-browser` for real logged-in Chrome | **`browser-hand`** (sources in `cli-js/`; workspace `browser-hand-cli`) |
| Folder `path-a/` | **`cli-js/`** (same Node product CLI; renamed to avoid Rust `cli/` collision) |
| Package `browser-hand-path-a` | **`browser-hand-cli`** |
| AutoHub MCP tool `dev_browser` | Shell to **`browser-hand` CLI** (thin adapter; do not dual-maintain the extension stack in AutoHub) |
| Skill `dev-browser` | Skill **`browser-hand`** (`skills/browser-hand/`) |
| Extension name “dev-browser” | Extension **“Browser Hand”** (`extension/dist/chrome-mv3`) |
| Load path `extension/.output/chrome-mv3` | **`extension/dist/chrome-mv3`** |
| Internal label “Path A” | Say **Browser Hand** / extension path |
| Agent rules only in `CLAUDE.md` | **`AGENTS.md` canonical**; `CLAUDE.md` is `@AGENTS.md` |
| Scripts `npm run path-a` / `install:path-a` / `build:path-a` | **`npm run browser-hand`** / **`npm run setup`** / **`npm run build:relay`** |

## What stays named `dev-browser` (on purpose)

These remain for the **headless / upstream packaging** line until a deliberate package rename:

| Artifact | Notes |
|---|---|
| Binary / npm package name `dev-browser` | Optional CI / empty-profile automation |
| `bin/dev-browser*` | Upstream-style launcher |
| Env vars `DEV_BROWSER_*` | Headless daemon config |
| Config dir `~/.dev-browser/` | Upstream config path |
| Cargo package / folder `cli/` | Rust crate for the upstream binary (not the product Node CLI) |

Do **not** teach agents that `dev-browser` is the way to drive daily Chrome. Prefer `browser-hand` + extension + relay.

## One-command install (current)

```bash
git clone https://github.com/verygoodplugins/browser-hand.git
cd browser-hand
npm run setup
# Chrome → Load unpacked → extension/dist/chrome-mv3  (Browser Hand)
npm run relay
npm run doctor   # want status: tab_bootstrap_works
```

Alias: `npm run install:extension` runs the same setup script. (`scripts/install-path-a.sh` still forwards to `setup.sh` for old muscle memory.)

### Optional: remove legacy `dev-browser` duplicates

```bash
npm run setup -- --cleanup-legacy
```

This removes skill dirs named `dev-browser` under `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`, and prints how to remove an old unpacked Chrome extension from `chrome://extensions`. It does **not** delete Chrome profile data, cookies, or `~/.dev-browser/`.

To keep a thin legacy skill pointer (off by default):

```bash
npm run setup -- --legacy-alias
```

Skill (AutoVault):

```bash
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
```

Without AutoVault, `npm run setup` copies `skills/browser-hand` into common agent skill dirs.

## Operator habits to update

| Habit | Replace with |
|---|---|
| `dev-browser-cli doctor` (AutoHub-era) | `browser-hand doctor` or `npm run doctor` |
| `node path-a/src/cli.js …` | `browser-hand …` or `node cli-js/src/cli.js …` |
| MCP tool `dev_browser` as primary | `browser-hand` CLI (or hub adapter that shells out) |
| Remote-debug everyday Chrome | Extension path; remote debug only on **non-default** profile |
| Edit only `CLAUDE.md` | Edit **`AGENTS.md`**; leave `CLAUDE.md` as `@AGENTS.md` |
| Load `extension/.output/chrome-mv3` | Load **`extension/dist/chrome-mv3`** |
| Talk about “Path A” | Talk about **Browser Hand** |
| Obstacle course under old extension-only clone | `extension/challenges/` in this repo (default port **8766**) |

## AutoHub cutover

**SSOT for real Chrome is this repo.** Hub integrations should:

1. Invoke the `browser-hand` CLI (or a thin wrapper), not reimplement the extension stack.
2. Keep any temporary `dev_browser` grant alias only as long as clients need it, then rename to `browser_hand`.
3. Not land parallel extension/relay trees inside AutoHub.

## Docs agents should trust

1. [AGENTS.md](./AGENTS.md) — how to work in this repo  
2. [skills/browser-hand/SKILL.md](./skills/browser-hand/SKILL.md) — when/how to drive real Chrome  
3. [README.md](./README.md) — user install  
4. [FORK.md](./FORK.md) — product differentiation  
5. This file — rename and migration  

## Ecosystem conventions

New VGP agent-facing projects should follow the same agent surface as recent MCP and product repos:

- `AGENTS.md` canonical  
- `CLAUDE.md` → `@AGENTS.md`  
- `MIGRATING.md` when renaming or forking  
- `.github/SECURITY.md` + PR/issue hygiene  

See skill **`vgp-repo-bootstrap`** (in this repo under `skills/vgp-repo-bootstrap/`) for the checklist and file templates used to spin up the next project without reinventing this layer.
