# Extension CLI reference

Drive logged-in Chrome through the local extension bridge. JSON on stdout, logs on stderr, exit 0 on success.

Entrypoint (any of):

```bash
browser-hand <op> ...
node path-a/src/cli.js <op> ...
npm run doctor   # doctor only
```

## Doctor and open a named tab

```bash
browser-hand doctor
browser-hand open --url https://example.com --page-name smoke
```

Run `doctor` before authenticated multi-step work. Only `status: "tab_bootstrap_works"` means the bridge is healthy.

`open` creates or reuses a **named** tab, then navigates. Prefer names for anything longer than one command.

## Snapshot

```bash
browser-hand snapshot --page-name smoke
# or target an existing tab:
browser-hand snapshot --target-url github.com
```

Returns URL, title, controls (with labels), headings, links, text; pierces open shadow roots and same-origin iframes.

Always snapshot before a write when the active tab is ambiguous.

## Fill / click / type / evaluate / screenshot / goto

```bash
browser-hand fill --page-name smoke --fields '{"Email":"a@b.c","First name":"Ada"}'
browser-hand click --page-name smoke --text "Submit"
browser-hand click --page-name smoke --selector 'button[type=submit]'
browser-hand type --page-name smoke --label "Bio" --text "Hello"
browser-hand evaluate --page-name smoke --code 'document.title'
browser-hand screenshot --page-name smoke
browser-hand goto --page-name smoke --url https://example.com/next
```

- `--fields` must be a **JSON object** of label → value.
- Click uses a full pointer sequence (not bare `el.click()`).
- Type/fill on contenteditable fire `beforeinput` + `input` for editors like Lexical.
- Screenshots land under `~/.browser-hand/screenshots/` (override with `BROWSER_HAND_SCREENSHOT_DIR`).

### Placeholders (optional autofill file)

If `~/.browser-hand/autofill.json` (or legacy `~/.autohub/autofill.json`) exists:

- `{me:KEY}` — plain JSON profile
- `{secure:KEY}` / `{secret:KEY}` — macOS keychain (see autofill docs in tool help)

```bash
browser-hand autofill-profile --page-name smoke --context personal
```

## Focus policy

**Default: background** — do not activate the tab or focus the Chrome window.

Popup → Focus while automating: Background | Tab only | Window.

### One-shot focus (human in the loop)

Only when the **user** must see the tab (2FA, captcha, confirm):

```bash
browser-hand focus --page-name checkout --focus window --reason "2fa-sms"
browser-hand open --url https://example.com/pay --page-name checkout \
  --focus window --reason "confirm order"
```

Agents must pass `--reason`. Do **not** focus for routine automation.

## Tab targeting

Only `http(s)://` tabs are listed. Prefer:

- `--page-name <name>`
- `--target-url <substring>`
- `--target-title <substring>`
- `--target-id <id>`

## Agent-oriented recovery

- **Username / password manager:** debugger may detach while the tab stays open. The extension soft-detaches and can fall back to `chrome.scripting` for evaluate/fill/type/click. Re-open the page if a pure CDP feature (some screenshots) still fails.
- **Obstacle course:** `extension/challenges/` served on **:8766** by default (`extension/scripts/serve-challenges.sh`). Challenges expose `window.__oracle()` for pass/fail.

## Workflow

1. `doctor` once per session  
2. `open` or `snapshot` — confirm the right tab  
3. Write (`fill` / `click` / `type` / `goto`)  
4. Verify (`screenshot` / re-`snapshot` / `evaluate`)
