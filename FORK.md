# Browser Hand

**Product name:** Browser Hand  
**Org:** [verygoodplugins](https://github.com/verygoodplugins)  
**Upstream:** [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) (MIT)  
**Repo:** https://github.com/verygoodplugins/browser-hand

This is a Very Good Plugins fork of Sawyer Hood’s `dev-browser`. We keep upstream CLI/daemon compatibility while productizing the **Path A** path: drive the user’s real logged-in Chrome via a local extension relay, without stealing OS focus.

## Why a fork (and why not `dev-browser-enhanced`)

| Project | What it is | Delta vs Sawyer |
|---|---|---|
| **SawyerHood/dev-browser** | Skill + CLI + sandboxed daemon, optional `--connect` to remote-debug Chrome | Baseline |
| **code-yeongyu/dev-browser-enhanced** | Same stack + **rebrowser-patches** npm alias for anti-detection | **2 commits ahead**, **~38 behind** main. No agent UX work. |
| **verygoodplugins/browser-hand** (this repo) | Upstream baseline + **Path A extension** agent UX (focus policy, soft-detach, scripting fallback, obstacle-course dogfood) | Product fork for real-session agent use |

`dev-browser-enhanced` is **not** a meaningful product alternative for our goals: it only patches Playwright for bot detection and has drifted far behind upstream.

## Eval / benchmarking note

[SawyerHood/dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval) is a Claude Code **game-tracker** harness that compares:

| Method | Avg time | Cost | Turns | Success |
|---|---|---|---|---|
| Dev Browser | 3m 53s | $0.88 | 29 | 100% |
| Playwright MCP | 4m 31s | $1.45 | 51 | 100% |
| Playwright Skill | 8m 07s | $1.45 | 38 | 67% |
| Claude native Chrome | 12m 54s | $2.81 | 80 | 100% |

That suite is **not apples-to-apples** for Browser Hand Path A:

1. Hard-codes `CLAUDE_PATH=/Users/sawyerhood/.claude/local/claude`
2. Expects Sawyer’s private-ish local `~/game-tracker/.env.local` and plugin marketplace layout
3. Measures full **Claude Code agent runs** on a greenfield app (account create → login → CRUD), not extension-relay reliability on real sessions
4. Methods are plugin/MCP variants of Path B / headless, not “logged-in Chrome without focus steal”

**Published upstream numbers still matter:** they show the skill+CLI approach beats Playwright MCP/skill and native Chrome on that task. We use them as a ceiling reference, not as our dogfood suite.

Our internal validation is the **agent obstacle course** under `extension/challenges/` (password-manager wedges, focus, soft-detach, ARIA, shadow/iframe, multi-step same-target).

## Path A product shape (Browser Hand)

1. **Chrome MV3 extension** (`extension/`) — CDP router, named targets, soft-detach, scripting fallback, `focusPolicy` default `background`
2. **Local relay** (port 9333) — WebSocket bridge agent ↔ extension
3. **CLI / skill** — agent-facing API; prefer named pages + human-like I/O
4. **Optional** headless/`--connect` kept from upstream for CI and break-glass; Path A is the default product story

### Agent UX wins already in `extension/`

- **No OS focus steal by default** (`focusPolicy: background`; one-shot agent override for human-in-the-loop)
- **Soft-detach** when debugger wedges (password managers / username fields) without dropping named targets
- **Scripting fallback** (`chrome.scripting`) when CDP `Runtime.enable` is stuck after remaps
- **Reconnect hygiene** — late close of a replaced socket must not tear down the live extension↔relay link
- Obstacle-course LEDGER for regression confidence

## Naming

CLI binary remains `dev-browser` for upstream compatibility (native release assets still download from Sawyer until we cut our own). Product and npm scope name is **browser-hand**; `browser-hand` is also registered as a bin alias.

## License

MIT. Upstream copyright Sawyer Hood; Browser Hand modifications © Very Good Plugins / contributors.
