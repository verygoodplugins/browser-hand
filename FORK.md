# Browser Hand — fork notes

**Repo:** https://github.com/verygoodplugins/browser-hand  
**Upstream:** [SawyerHood/dev-browser](https://github.com/SawyerHood/dev-browser) (MIT)  
**Maintainer:** [Very Good Plugins](https://github.com/verygoodplugins)

Browser Hand keeps upstream’s sandboxed CLI for headless/CI use and adds a **first-class extension bridge** so agents can drive the user’s **normal Chrome profile**.

## Why this exists

Remote debugging and WebDriver-style attach are the usual way to automate Chrome. They work poorly for “use my real Gmail / GitHub / admin session”:

1. **Chrome 136+** will not open a remote-debugging port on the **default** profile without a separate `--user-data-dir`.
2. **Many sites** (including Google sign-in/OAuth flows) treat debugger/automation surfaces as hostile and block or throttle them.
3. **Focus** — attach APIs tend to activate tabs and steal the OS window mid-work.
4. Agents need **recovery** when password managers and multi-step forms detach the debugger, plus **tests** that match those failure modes.

The extension + local relay path avoids putting a debug port on the daily profile, keeps work in the background by default, and ships an obstacle course for agent UX.

## What’s different from upstream

| Area | Upstream `dev-browser` | Browser Hand |
|---|---|---|
| Daily logged-in Chrome | Optional `--connect` (remote debug) | **Default:** MV3 extension + local relay |
| Default profile | Debug port blocked on modern Chrome | Extension works in the normal profile |
| Focus | Typical CDP activate behavior | Background-first; optional one-shot focus for humans |
| Recovery | Standard CDP | Soft-detach, scripting fallback, reconnect hygiene |
| Agent practice | General skill docs | Local challenge gym under `extension/challenges/` |

## Nearby forks

**[dev-browser-enhanced](https://github.com/code-yeongyu/dev-browser-enhanced)** applies Playwright anti-detection patches only (few commits, far behind upstream). It does not address logged-in default-profile use, focus, or agent recovery.

**[dev-browser-eval](https://github.com/SawyerHood/dev-browser-eval)** benchmarks full agent runs on a sample app (greenfield login/CRUD). Useful for CLI skill cost/latency; not a substitute for extension reliability on real sessions.

## Layout

| Path | Role |
|---|---|
| `cli-js/` | Product Node CLI (`browser-hand` bin; workspace `browser-hand-cli`) |
| `relay/` | Local WebSocket bridge |
| `extension/` | Chrome MV3 extension + challenges (load `extension/dist/chrome-mv3`) |
| `skills/browser-hand/` | Agent skill |
| `cli/` + `daemon/` + `bin/dev-browser` | Upstream headless CLI |
| `AGENTS.md` | Canonical agent guide (`CLAUDE.md` → `@AGENTS.md`) |
| `MIGRATING.md` | Rename map from historical “dev-browser” / Path A naming |

## License

MIT. Upstream copyright Sawyer Hood; Browser Hand modifications © Very Good Plugins / contributors.
