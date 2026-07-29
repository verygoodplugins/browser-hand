# Agent Obstacle Course — Design Spec

**Date:** 2026-07-29  
**Status:** Approved  
**Product:** Path A stack (dev-browser Chrome extension + AutoHub CLI + `dev-browser` skill)

## 1. Goal

Turn Path A into a **reproducible agent obstacle course**: invent challenges → drive them like a careful human agent → when the stack burns tokens, lies, or forces workarounds, **fix the right layer** and commit with problem / fix / expected improvement.

Primary consumer: coding agents (especially Claude Sonnet-class tool users) driving real Chrome via the extension relay.

## 2. Success bar

This phase is complete when:

1. A local gym exists with the defined challenge set and pass oracles.
2. Each challenge has been attempted end-to-end via Path A (`doctor` healthy first).
3. At least one improvement landed with evidence (before/after behavior or command output).
4. Commit messages follow the required shape (below).
5. No real-web form submits; public sites stay navigate/snapshot-only.

## 3. Constraints (locked)

| Decision | Choice |
|---|---|
| Stack write surface | Full Path A: extension source, AutoHub CLI/tool, skill/docs |
| Safety | Local gym + public read-only (no third-party submits) |
| Approach | Agent Obstacle Course (Approach A) with light oracle spine |
| Operator input | Prefer subagents; if confidence ≥ ~70%, proceed without asking |
| Primary proof | Pass oracle + CLI output (screenshots secondary) |

## 4. Stack & write surfaces

| Layer | Path | When we change it |
|---|---|---|
| Extension (WXT source) | `~/Code/dev-browser-extension` | Relay reliability, tab targeting, debugger attach, CDP plumbing, keepalive |
| Built load path | `wxt build` → Chrome unpacked (today often `~/Code/dev-browser-extension-unpacked` or `.output/chrome-mv3`) | After every extension change |
| CLI | `~/Projects/OpenAI/autohub/bin/dev-browser-cli.js` + `tools/dev-browser-tool.js` | Command ergonomics, snapshot shape, fill/type/click semantics, actionable errors |
| Skill/docs | AutoVault / `dev-browser` skill + references | Decision rules, recipes, gotchas, autonomy contract |

## 5. Curriculum

Local static site under `challenges/`, served via `python3 -m http.server` (or equivalent). Default port **8765**.

Each challenge provides:

- **Intent** — what a careful human would do
- **Hard part** — why agents fail
- **Pass oracle** — DOM/JSON check after actions (not screenshot-only)
- **Path A only** for the dogfood run

| # | Challenge | Human task | Agent pain target |
|---|---|---|---|
| 01 | Hello form | Fill name/email/message, submit, see success | Baseline fill + submit + verify |
| 02 | Label chaos | Fill fields with poor `for`/aria/placeholder-only labels | Snapshot control labeling |
| 03 | Controlled inputs | Type into controlled inputs (value only on real input events) | `evaluate` value-set traps |
| 04 | Contenteditable bio | Multi-line bio; state only on real keystrokes | `type` vs `fill` vs execCommand |
| 05 | Synthetic click | `div[role=button]` ignoring bare DOM `.click()` in evaluate | Host-side click chain |
| 06 | Wizard (3 steps) | Next/back, preserve state, final confirm | Multi-step without losing context |
| 07 | Dynamic form | Country select injects fields; fill new fields | Re-snapshot after mutation |
| 08 | Shadow DOM | Fill inside open shadow root | Snapshot/selector piercing |
| 09 | Iframe form | Fill form in same-origin iframe | Target/frame selection |
| 10 | Validation gauntlet | Bad data → errors → correct and resubmit | Error text in snapshot; recovery |
| 11 | SPA client routes | Hash/history routes without full reload | Stale snapshot / wait discipline |
| 12 | Idle keepalive | Wait ~60–90s mid-flow, then continue | MV3 SW / WS survival |

**Public scavenger (read-only):** 2–3 pages (e.g. `example.com` + one docs page): open, snapshot structure, find heading/link — **no form submit**.

Optional later (out of v1 unless friction demands it): file input, sticky click-target occlusion, modals, captcha-shaped detect-and-stop.

## 6. Run loop (per challenge)

```
doctor → open gym URL / page-name
→ snapshot (confirm tab + controls)
→ act (fill/type/click; re-snapshot after DOM changes)
→ verify via oracle (evaluate or re-snapshot values + success marker)
→ screenshot as secondary evidence only
→ if friction: capture problem → fix smallest layer → rebuild if extension → re-run → commit
```

**Act like a human agent means:**

- Prefer labels and visible text over brittle CSS
- Re-read state after every mutation
- Prefer real keyboard/pointer paths for contenteditable and `role=button`
- Do not invent parallel CDP when Path A already exposes a command

## 7. Improvement rules

**In scope:**

- Snapshot missing labels, roles, disabled/error text, frame/shadow context
- Fill/type that looks successful but does not commit framework state
- Click paths that do not fire synthetic listeners
- Opaque errors → structured, actionable messages
- Skill rules that prevent repeated dead-end strategies
- Relay flakiness proven by a challenge

**Out of scope this phase:**

- Path B as default
- Real-account autofill on live sites
- Captcha solving, payment, email verification
- Full Playwright rewrite or new MCP surface without evidence
- Unrelated AutoHub refactors

**Fix ranking:** prefer CLI/skill if CDP capability exists and agents just cannot see/use it; prefer extension when the relay/session/target layer is wrong.

## 8. Commit protocol

Every improvement commit (any write surface):

```
<area>: <short title>

Problem: <what the agent hit during challenge N / scavenger>
Fix: <what changed>
Expected improvement: <how the next agent run is cheaper/safer/clearer>
```

`<area>` ∈ `extension` | `cli` | `skill` | `challenges` | `docs`

Fixture-only gym pages may use a shorter `challenges: add …` message; if a fixture is added *because* of a failed run, include Problem/Fix/Expected.

## 9. Evidence ledger

`challenges/LEDGER.md` — one row per challenge:

`id | status (pass/fail/partial) | friction notes | fix commit(s) | re-run result`

No “done” claim without command evidence (`doctor` status, snapshot snippet, oracle pass).

## 10. Oracle contract

Each challenge page exposes a stable API for agents:

- `window.__CHALLENGE__` — `{ id, name, version }`
- `window.__oracle()` — returns `{ ok: boolean, checks: Record<string, boolean|string>, detail?: string }`
- Visible success region: `#oracle-status` with `data-ok="true|false"`

Oracles must not pass on “DOM looks filled” alone when the hard part is framework state (challenges 03–05).

## 11. Non-goals / refusals

- No submit on real third-party forms
- No authenticated product surfaces (IG, DSP dashboards, etc.) in this phase
- No force-push / destructive git without clear product need
- No claiming Sonnet-specific optimization without a concrete observation

## 12. Autonomy (operator preference)

- Use subagents for independent streams (gym page batches, dogfood runs, CLI fixes).
- Confidence ≥ ~70%: choose and execute; do not re-ask micro-forks.
- Less operator input is better; surface a short decision ledger only when something was auto-picked that Jack might veto later.

## 13. Spec self-review

| Check | Result |
|---|---|
| Placeholders | None intentional |
| Consistency | Curriculum IDs 01–12 match oracle IDs |
| Scope | Single phase: gym + dogfood + stack fixes |
| Ambiguity | Public = read-only; submit only on local gym |
