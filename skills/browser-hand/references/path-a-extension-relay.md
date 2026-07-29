# Path A — Extension relay CLI (default)

Prerequisites (relay, extension, doctor, Bash allow-rule) are in `references/setup.md`. This file is the command reference and workflow once Path A is set up.

Single entrypoint: `path-a/src/cli.js`. JSON to stdout, logs to stderr, exits 0 on success.

## Doctor and open a named tab

```bash
node path-a/src/cli.js doctor
node path-a/src/cli.js open \
  --url https://example.com \
  --page-name smoke
```

Run `doctor` once before dispatching any social/authenticated subagent. If it
does not return `status: "tab_bootstrap_works"`, do not spawn social agents;
follow the returned `action` (see `references/troubleshooting.md` for what each
status means) and report the blocker. `open` creates or reuses a
named relay tab via the extension socket, then navigates it. `goto` can also
bootstrap the default named page (`browser-hand-current`) when no `http(s)` tab is
visible.

## Snapshot the active tab

```bash
node path-a/src/cli.js snapshot --target-url <substring>
```

Returns `{ success, target, snapshot: { url, title, focused, controls, headings, links, text, frames?, alerts? } }`. Always run this before any write to verify the right tab.

Controls include `label[for]` / wrapping label / aria-label / placeholder (first non-empty). Open **shadow roots** and **same-origin iframes** are pierced (`shadow: true` / `frame: "<id>"` on controls). `alerts` lists visible `[role=alert]` / `.error` text.

## Autofill from the local profile

```bash
node path-a/src/cli.js autofill-profile \
  --target-url <substring> \
  [--profile default] \
  [--context personal|work|financial|travel]
```

Inspects the form, classifies labels (`firstName`/`email`/`address-line1`/…), resolves values against `~/.autohub/autofill.json` and the macOS keychain, fills in one call. Resolved secrets are redacted from the response.

`context` shifts which email/address profile is used — `work` picks the work email, `financial` picks the billing address. Defaults to `default`.

## Fill specific labels

```bash
# --page-name works for fill/click/type (same named tab as open/snapshot)
node path-a/src/cli.js fill \
  --page-name <name> \
  --target-url <substring> \
  --fields '{"Email":"a@b.c","First name":"Ada"}'
```

**`--fields` must be a JSON object** (`{"Label":"value"}`), never an array. Arrays are rejected with an error (they used to silently no-op).

Values may use placeholders that resolve from the local profile/keychain (and get redacted from output):
- `{me:KEY}` — `~/.autohub/autofill.json`
- `{secure:KEY}` — macOS keychain service `autohub-profile-<KEY>` (mailing/billing, SSN, card data)
- `{secret:KEY}` — macOS keychain service `autohub-autofill-<KEY>` (legacy alias)

Fill/type also pierce open shadow roots and same-origin iframes (same as snapshot).

## Focus policy (extension)

By default the extension **does not steal OS focus**. `Target.activateTarget` and `Page.bringToFront` are no-ops so agent runs stay in the background while you keep typing in the editor.

Popup → **Focus while automating**:
- **Background (default)** — never activate tab / never focus Chrome
- **Activate tab only** — switch tab inside its window, leave other apps focused
- **Focus Chrome window** — legacy behavior

### Agent one-shot override (human-in-the-loop)

When the agent needs **you** to look at a tab (2FA, captcha, confirm publish), it may request a **one-shot** focus without changing the popup default:

```bash
# Bring named tab to the front for the human
node path-a/src/cli.js focus \
  --page-name checkout \
  --focus window \
  --reason "2fa-sms"

# Or open and focus in one step
node path-a/src/cli.js open \
  --url https://example.com/login \
  --page-name checkout \
  --focus window \
  --reason "confirm order"
```

| Policy | Effect |
|---|---|
| `window` (default for `focus`) | Activate tab + focus Chrome window |
| `tab` | Activate tab only; leave other apps focused |
| `background` | Clear override; stay out of the way |

Rules for agents:
- **Do not** use focus for ordinary fill/click/snapshot.
- **Do** pass `--reason` (e.g. `2fa`, `captcha`, `confirm-publish`).
- Override is **consume-on-use** (cleared after one successful focus apply) and TTL-limited (default 2 min).

Reload the unpacked extension after updating for this to apply.

## Click, type, evaluate, screenshot, goto

```bash
node path-a/src/cli.js click --text "Submit"
node path-a/src/cli.js click --selector 'button[type=submit]'
node path-a/src/cli.js type --label "Bio" --text "Hello"
node path-a/src/cli.js evaluate --code 'document.title'
node path-a/src/cli.js screenshot [--full-page]
node path-a/src/cli.js goto --url https://example.com
```

**Click fidelity:** host click dispatches a full pointer sequence (mousedown→mouseup→click), not bare `el.click()`. Text matches prefer **visible** elements (hidden wizard steps / duplicate labels).

**Type / contenteditable:** `type` and fill on contenteditable fire `beforeinput` + `InputEvent('input')` so Lexical-style editors commit state (not only visible textContent).

Screenshots land in `~/.browser-hand/screenshots/` with timestamped names. The CLI returns `{ filePath: "..." }` — read that file with the Read tool to see the result.

## Known agent gotchas (Path A)

- **Username field + debugger detach:** Chrome often fires debugger `onDetach` with `target_closed` during username/password-manager activity even when the tab is still open. Extension soft-detach keeps the tab registered; if `chrome.debugger` is wedged (`Cannot access a chrome-extension:// URL…`), the extension switches that tab to **scripting fallback** (`chrome.scripting.executeScript` MAIN world) so `evaluate` / fill / type / click can continue. Gym stress: `http://127.0.0.1:8766/19-real-username.html` (port **8766** — 8765 is often Slack MCP on this machine). Reload the unpacked extension after updates that add the `scripting` permission.
- **Evaluate:** prefer an IIFE that `return`s a value for multi-statement code.
- **Obstacle course:** local gym at `extension/challenges/` (`bash scripts/serve-challenges.sh` → **`:8766`** by default; override with `OBSTACLE_COURSE_PORT`). Challenges 01–19; pass via `evaluate JSON.stringify(window.__oracle())`.

## Tab targeting

The relay only enumerates `http(s)://` tabs (no `file://`, no `chrome://`). With many tabs open the "active" heuristic may be ambiguous — prefer explicit targeting:

- `--target-url <substring>` — case-insensitive match against tab URL
- `--target-title <substring>` — case-insensitive match against tab title
- `--target-id <CDP id>` — exact match (from a prior snapshot's `target.id`)

If none match, the CLI returns an error with the candidate tab list — read that, pick the right one, retry.

## Path A workflow

1. **Run doctor** (once per session): `node path-a/src/cli.js doctor`.
   - Healthy means `status: "tab_bootstrap_works"`.
   - Anything else is a browser-tool blocker; follow the returned `action` before dispatching social/auth subagents.
2. **Open or snapshot.** Use `open --url ... --page-name ...` when you need to bootstrap a tab; otherwise snapshot the existing active tab. Always confirm the tab before writing.
3. **Write.** For a form: `autofill-profile` is the one-shot path; `fill --fields '<json>'` is the surgical path. For navigation/interaction: `click`, `type`, `goto`.
4. **Verify.** Take a `screenshot` and Read it, or re-`snapshot` and check the active-element or relevant control value.
