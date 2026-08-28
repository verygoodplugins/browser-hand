# Extension CLI reference

Drive logged-in Chrome through the local extension bridge. JSON on stdout, logs on stderr, exit 0 on success.

Entrypoint (any of):

```bash
browser-hand <op> ...
node cli-js/src/cli.js <op> ...
npm run doctor   # doctor only
```

## Doctor and open a named tab

```bash
browser-hand doctor
browser-hand tabs
browser-hand tabs --query stripe
browser-hand snapshot
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

### Batch (one attach)

Multi-step work on one named tab should use `batch` so open/fill/click/evaluate share a CDP session. Separate CLI calls reattach every time.

```bash
browser-hand batch --page-name smoke --steps '[{"operation":"open","url":"https://example.com"},{"operation":"fill_fields","fields":{"Email":"a@b.c"}},{"operation":"click","text":"Submit"},{"operation":"evaluate","code":"document.title"}]'
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

`browser-hand tabs` lists every `http(s)://` tab. A unique-active tab is first; `focused` is first when the extension stamps the last-focused window. Prefer:

- no flags — unique-active tab, or last-focused when `focused` is present
- `--query <text>` — title or URL substring (`tabs` and snapshot/click/etc)
- `--page-name <name>`
- `--target-url <substring>`
- `--target-title <substring>`
- `--target-id <id>`

Do not use `doctor` to find a tab. Doctor is a health check; `tabs` is the inventory.

## Agent-oriented recovery

- **Username / password manager:** debugger may detach while the tab stays open. The extension soft-detaches and can fall back to `chrome.scripting` for evaluate/fill/type/click. Re-open the page if a pure CDP feature (some screenshots) still fails.
- **Obstacle course:** `extension/challenges/` served on **:8766** by default (`extension/scripts/serve-challenges.sh`). Challenges expose `window.__oracle()` for pass/fail.

## Workflow

1. `doctor` once per session (health only)  
2. `tabs` or `snapshot` — confirm the unique-active / queried tab  
3. Write (`fill` / `click` / `type` / `goto`)  
4. Verify (`screenshot` / re-`snapshot` / `evaluate`)
