# Setup

One-time setup for Browser Hand on a developer machine.

## Requirements

- Google Chrome with your normal profile (cookies, logins, open tabs)
- Node.js ≥ 18
- This repository cloned locally (for the runtime)
- Optional: [AutoVault](https://github.com/autoworks-ai/autovault) for skill install/sync

## Skill install (recommended: AutoVault)

[AutoVault](https://autovault.dev) is a local skill vault — validate, sign, and sync skills into Claude Code / Codex / etc. without hand-copying `SKILL.md`.

```bash
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
```

Then install the **runtime** below (extension + relay). AutoVault only delivers the skill.

## Runtime install

From the repo root:

```bash
npm run install:extension
```

That builds the local relay and extension, and (if you skipped AutoVault) copies the agent skill to:

- `~/.claude/skills/browser-hand`
- `~/.agents/skills/browser-hand` (if present)
- `~/.codex/skills/browser-hand` (if present)

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose `extension/.output/chrome-mv3` in this repo

Leave the extension **enabled**. The toolbar popup should eventually show connected once the relay is up.

## Start the relay

The extension connects to `ws://127.0.0.1:9333/extension`. Something must listen there for the whole session (not only for a single CLI call).

```bash
npm run relay
# or: browser-hand relay
# or: node path-a/src/cli.js relay
```

Foreground process; Ctrl-C to stop. Idempotent if something is already bound to `:9333`.

You can also run `browser-hand-relay` after `cd relay && npm run build && npm link`.

> Port **9333** is the bridge. Port **9222** is Chrome’s own remote-debugging default — do not collide them.

## Health check

```bash
npm run doctor
# or: browser-hand doctor
```

Healthy output includes `"status": "tab_bootstrap_works"` and `extensionConnected: true`.

Other statuses mean fix the bridge or reload the extension before agent work — see `troubleshooting.md`.

## Agent allow-rules (Claude Code)

If the project gates shell commands, allow the CLI:

```json
{
  "permissions": {
    "allow": [
      "Bash(browser-hand:*)",
      "Bash(node */path-a/src/cli.js:*)",
      "Bash(npm run doctor:*)",
      "Bash(npm run relay:*)"
    ]
  }
}
```

Restart the agent session after changing permissions.

## Optional: headless / remote-debug CLI

Only for disposable browsers or CI — not your daily profile:

```bash
dev-browser install
dev-browser --headless <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(await page.title());
EOF
```

See `remote-debug-fallback.md` before using `--connect`.
