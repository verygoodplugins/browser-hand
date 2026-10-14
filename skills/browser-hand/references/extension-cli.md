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
browser-hand doctor --verbose   # full tab list; avoid this in normal sessions
browser-hand tabs
browser-hand tabs --query stripe
browser-hand snapshot --quiet
browser-hand open --url https://example.com --page-name smoke
```

Run `doctor` before authenticated multi-step work. Only `status: "tab_bootstrap_works"` means the bridge is healthy.

Default doctor JSON is `status`, `tabCount`, `active` (the one current tab), and a hint. It does not list every tab. `tabs` is the inventory.

`open` creates or reuses a **named** tab, then navigates. Prefer names for anything longer than one command.

On the first `open` of a task, add a short `--group-title`. Tabs Browser Hand creates join a Chrome tab group with that title and a color chosen from Chrome's palette (grey excluded). The same title keeps joining that group. A different title starts a new group and a new color. Omit the flag and the group stays named Browser Hand.

```bash
browser-hand open --url https://example.com --page-name smoke --group-title "DNS records"
```

## Snapshot

```bash
browser-hand snapshot --page-name smoke --quiet
browser-hand snapshot --page-name smoke --scope full
browser-hand snapshot --page-name smoke --scope nav
# or target an existing tab:
browser-hand snapshot --target-url github.com --quiet
```

Default scope is the open dialog (plus an open listbox or menu) and the main landmark. `snapshot.nodes` is `{ ref, role, name, value?, ariaChecked? }`. Nav links are not included, and the body text is not copied.

`--scope full` adds `nav` and `text`. `--scope nav` is only the navigation landmark. Refs from `--scope nav` or `--scope full` are not the refs `--ref` clicks; `--ref` always uses the default scope.

`snapshot.forms` is still the labeled fields inside that same scope. Fill from `nodes` or `forms`, not from nav.

Pass `--quiet` so the response is the snapshot, not a second copy of the page URL and title.

## Fill / click / type / evaluate / screenshot / goto

```bash
browser-hand fill --page-name smoke --fields '{"Email":"a@b.c","First name":"Ada"}' --quiet
browser-hand click --page-name smoke --role button --name "Submit" --quiet
browser-hand click --page-name smoke --ref e12 --quiet
browser-hand click --page-name smoke --text "Submit" --quiet
browser-hand click --page-name smoke --selector 'button[type=submit]' --quiet
browser-hand type --page-name smoke --label "Bio" --text "Hello"
browser-hand evaluate --page-name smoke --code 'document.title' --quiet
browser-hand screenshot --page-name smoke
browser-hand goto --page-name smoke --url https://example.com/next
```

- `--fields` must be a **JSON object** of label → value.
- Keys match the visible label, aria-label, placeholder, name, or id. An exact label beats a substring of the name attribute.
- The process exits 1 when any key is unmatched or the value does not stick. Read `result.filled` and `result.failed`. `success: true` means every requested field was written.
- Click by `--ref` (from the default snapshot) or `--role` plus `--name` (exact accessible name). `--text` still works and is ambiguous when the same string is a value and a label (`A`, `CNAME`).
- Click uses a full pointer sequence (not bare `el.click()`). It does not focus the tab or the window.
- The click result includes `state` (`ariaChecked`, `checked`, `value`, `ariaPressed`, `ariaExpanded` when the control has them) and `stateChanged` for toggles and fields. `success: true` means the events were dispatched. `documentHidden: true`, or `stateChanged: false` on a switch, means the click may not have landed.
- `--quiet` drops `mode`, `target`, and the extra url/title copy. Use it on every repeated call.
- Type/fill on contenteditable fire `beforeinput` + `input` for editors like Lexical.
- Screenshots land under `~/.browser-hand/screenshots/` (override with `BROWSER_HAND_SCREENSHOT_DIR`).

## Steps

One invocation for a form you fill the same way several times. The call stops at the first miss.

```bash
browser-hand steps --page-name smoke --quiet --steps '[
  {"op":"click","role":"combobox","name":"Type"},
  {"op":"click","role":"option","name":"CNAME"},
  {"op":"fill","fields":{"Name":"www","Content":"example.com"}},
  {"op":"click","role":"switch","name":"Proxy"},
  {"op":"evaluate","code":"document.querySelector(\"table\")?.innerText"}
]'
```

Ops: `click`, `fill`, `type`, `evaluate`, `snapshot`. At most 20. Click steps use `ref`, `role`+`name`, `text`, or `selector`. Each step result omits url and title. `failedAt` is the index that stopped the list.

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

`focus --focus tab` activates the tab in its window and returns `focus.visibilityState`. That can stay `"hidden"` while the Chrome window is in the background, and clicks in a hidden document often do not land. `focus --focus window` is what makes the document visible. Click never does either on its own.

### Debugger infobar

Chrome shows "Browser Hand started debugging this browser" when `chrome.debugger.attach` runs. Cancel or the X is detach reason `canceled_by_user`.

Browser Hand keeps that tab in the session and does not reattach. Later commands on the tab use the scripting transport, so the bar stays dismissed until the extension is reloaded or toggled off and on. Do not focus the window to dismiss or fight the bar.

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

1. `doctor` once per session (health only: status, tabCount, active tab)
2. `tabs` or `snapshot --quiet` — confirm the tab, then read `nodes`
3. Write (`steps`, or `fill` / `click --role --name` / `type` / `goto`), with `--quiet`
4. Read `state` / `stateChanged` / `documentHidden` on the click. Re-snapshot or evaluate only when that is not enough.
