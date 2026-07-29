# Agent Obstacle Course Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local 12-challenge gym with oracles, dogfood Path A against it, and land stack fixes as commits with Problem/Fix/Expected improvement.

**Architecture:** Static HTML gym under `challenges/` served on port 8765. Path A CLI drives Chrome. Friction becomes extension, CLI, or skill commits. Ledger tracks pass/fail.

**Tech Stack:** Static HTML/CSS/JS gym; WXT Chrome MV3 extension; AutoHub `dev-browser-cli.js` / `dev-browser-tool.js`; optional skill doc updates.

**Spec:** `docs/superpowers/specs/2026-07-29-agent-obstacle-course-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `challenges/index.html` | Hub listing all challenges + links |
| `challenges/shared.css` | Shared layout / oracle banner |
| `challenges/shared.js` | Oracle helpers, status paint |
| `challenges/01-hello-form.html` … `12-idle-keepalive.html` | One page (or flow) per challenge |
| `challenges/frames/09-inner.html` | Same-origin iframe content for 09 |
| `challenges/LEDGER.md` | Run results |
| `challenges/README.md` | How to serve + dogfood |
| `scripts/serve-challenges.sh` | `python3 -m http.server 8765` from challenges/ |
| Extension / AutoHub / skill | Only when a dogfood run proves friction |

---

### Task 1: Gym foundation

**Files:**
- Create: `challenges/shared.css`
- Create: `challenges/shared.js`
- Create: `challenges/index.html`
- Create: `challenges/README.md`
- Create: `challenges/LEDGER.md`
- Create: `scripts/serve-challenges.sh`

- [ ] **Step 1: Create shared CSS**

```css
/* challenges/shared.css — minimal readable agent-friendly UI */
:root { font-family: system-ui, sans-serif; line-height: 1.4; color: #1a1a1a; }
body { max-width: 42rem; margin: 1.5rem auto; padding: 0 1rem; }
label { display: block; margin-top: 0.75rem; font-weight: 600; }
input, textarea, select, button { font: inherit; margin-top: 0.25rem; }
#oracle-status { margin-top: 1.5rem; padding: 0.75rem 1rem; border-radius: 6px; background: #f0f0f0; }
#oracle-status[data-ok="true"] { background: #d4edda; }
#oracle-status[data-ok="false"] { background: #f8d7da; }
.hint { color: #555; font-size: 0.9rem; }
```

- [ ] **Step 2: Create shared JS oracle helpers**

```js
// challenges/shared.js
export function paintOracle(result) {
  const el = document.getElementById('oracle-status');
  if (!el) return;
  el.dataset.ok = result.ok ? 'true' : 'false';
  el.textContent = result.ok
    ? `PASS: ${result.detail || 'all checks ok'}`
    : `FAIL: ${result.detail || JSON.stringify(result.checks)}`;
}

// Also attach non-module globals for evaluate():
// window.__paintOracle = paintOracle (via IIFE build without modules if needed)
```

Use a non-module IIFE so pages work without a bundler:

```js
// challenges/shared.js — IIFE, no import
(function () {
  function paintOracle(result) {
    const el = document.getElementById('oracle-status');
    if (!el) return;
    el.dataset.ok = result.ok ? 'true' : 'false';
    el.textContent = result.ok
      ? 'PASS: ' + (result.detail || 'all checks ok')
      : 'FAIL: ' + (result.detail || JSON.stringify(result.checks));
  }
  window.__paintOracle = paintOracle;
})();
```

- [ ] **Step 3: Create index hub + README + empty ledger + serve script**

`scripts/serve-challenges.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/challenges"
exec python3 -m http.server 8765
```

- [ ] **Step 4: Commit foundation**

```bash
git add challenges scripts/serve-challenges.sh docs/superpowers
git commit -m "docs+challenges: agent obstacle course foundation

Problem: no reproducible local gym for Path A agent dogfood
Fix: design/plan + shared gym scaffold and serve script
Expected improvement: agents can run the same 12 challenges without inventing targets"
```

---

### Task 2: Challenges 01–06

**Files:**
- Create: `challenges/01-hello-form.html`
- Create: `challenges/02-label-chaos.html`
- Create: `challenges/03-controlled-inputs.html`
- Create: `challenges/04-contenteditable-bio.html`
- Create: `challenges/05-synthetic-click.html`
- Create: `challenges/06-wizard.html`

Each page must set:

```js
window.__CHALLENGE__ = { id: '01', name: '...', version: 1 };
window.__oracle = function () { /* return { ok, checks, detail } */ };
```

**Oracle rules (summary):**

| ID | Pass when |
|---|---|
| 01 | Form submitted; name/email/message match filled values; `#success` visible |
| 02 | All three chaotic fields filled with expected values after submit |
| 03 | Internal JS state (not just DOM value) matches typed text |
| 04 | Internal editor state matches typed bio (not only textContent if diverged) |
| 05 | Success flag set only by full click handler path that ignores bare `.click()` unless full event sequence — implement: only `pointerdown+pointerup+click` user-like path OR host click; bare `el.click()` from evaluate without trusted path may fail — actually for local gym: store `ok` only if click event `isTrusted` OR a custom data attribute set by listening to full mousedown/mouseup/click sequence with detail |
| 06 | All three wizard fields collected and confirmed on step 3 |

- [ ] **Step 1: Implement 01–06 HTML pages with oracles**
- [ ] **Step 2: Manual browser smoke (or CLI if ready): open each, check `__oracle()` initial fail**
- [ ] **Step 3: Commit**

```bash
git commit -m "challenges: add 01-06 agent obstacle pages with oracles"
```

---

### Task 3: Challenges 07–12 + iframe

**Files:**
- Create: `challenges/07-dynamic-form.html`
- Create: `challenges/08-shadow-dom.html`
- Create: `challenges/09-iframe-form.html`
- Create: `challenges/frames/09-inner.html`
- Create: `challenges/10-validation.html`
- Create: `challenges/11-spa-routes.html`
- Create: `challenges/12-idle-keepalive.html`

| ID | Pass when |
|---|---|
| 07 | After country=US, zip+state filled and submitted |
| 08 | Shadow-root name field filled and submitted |
| 09 | iframe form fields filled and submitted (parent oracle reads iframe) |
| 10 | After recovery from invalid email, final submit succeeds |
| 11 | Visited `#/step-a` and `#/step-b` (or history routes) and final flag set |
| 12 | Started flow, waited ≥60s wall time recorded, then completed action |

- [ ] **Step 1: Implement 07–12**
- [ ] **Step 2: Update index links**
- [ ] **Step 3: Commit**

```bash
git commit -m "challenges: add 07-12 agent obstacle pages with oracles"
```

---

### Task 4: Path A preflight + serve gym

- [ ] **Step 1: Start gym server**

```bash
bash scripts/serve-challenges.sh
# or: (cd challenges && python3 -m http.server 8765)
```

- [ ] **Step 2: Doctor**

```bash
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js doctor
```

Expected: `status: "tab_bootstrap_works"` (or documented healthy equivalent). If relay down, start:

```bash
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js relay
```

- [ ] **Step 3: Open hub**

```bash
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js open \
  --url http://127.0.0.1:8765/ \
  --page-name obstacle-course
```

---

### Task 5: Dogfood challenges (batch with subagents when independent)

For each challenge 01–12:

- [ ] Open `http://127.0.0.1:8765/0N-….html` with `--page-name ch-0N`
- [ ] `snapshot --page-name ch-0N`
- [ ] Fill/type/click as a careful agent
- [ ] `evaluate --code 'JSON.stringify(window.__oracle())'`
- [ ] Update `LEDGER.md`
- [ ] On friction: fix smallest layer → re-run → commit with Problem/Fix/Expected

**Parallelization:** challenges that do not share tab state can run on separate named pages via subagents after gym is up. Do not parallelize 12 with long idle on the same relay if it starves other tabs — run 12 alone.

Public scavenger after local suite:

- [ ] `open https://example.com --page-name scavenger-1` → snapshot → confirm title/heading present (no submit)

---

### Task 6: Land first proven fix (mandatory)

- [ ] Identify highest-pain friction from ledger
- [ ] Implement fix in extension / CLI / skill
- [ ] Rebuild extension if needed (`npm run build`; reload unpacked in Chrome)
- [ ] Re-run the failing challenge
- [ ] Commit with full message body

---

## Self-review vs spec

| Spec requirement | Task |
|---|---|
| Local gym 01–12 + oracles | Tasks 1–3 |
| Serve + Path A dogfood | Tasks 4–5 |
| ≥1 improvement commit with evidence | Task 6 |
| Public read-only scavenger | Task 5 |
| LEDGER | Task 1 + 5 |
| Commit protocol | Tasks 1–3, 6 |

No placeholders remaining. Public = no submit. Fix ranking: CLI/skill first when CDP already enough.
