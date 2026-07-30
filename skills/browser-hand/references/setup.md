# Setup

One-time setup for Browser Hand on a developer machine.

## Requirements

- Google Chrome with your normal profile (cookies, logins, open tabs)
- Node.js ≥ 18
- This repository cloned locally (for the runtime)
- Optional: [AutoVault](https://github.com/autoworks-ai/autovault) for skill install/sync

## One-command runtime setup

From the repo root:

```bash
npm run setup
# alias: npm run install:extension
```

That installs workspace deps, builds the local relay and extension into
`extension/dist/chrome-mv3`, optionally `npm link`s the `browser-hand` bin, and
copies the agent skill to:

- `~/.claude/skills/browser-hand`
- `~/.agents/skills/browser-hand`
- `~/.codex/skills/browser-hand`

On macOS it opens the load folder in Finder.

### Flags

```bash
npm run setup -- --cleanup-legacy   # drop legacy skill aliases named "dev-browser"
npm run setup -- --legacy-alias     # keep a thin ~/.claude/skills/dev-browser pointer
npm run setup -- --no-link          # skip npm link
```

`--cleanup-legacy` does **not** delete Chrome profile data or `~/.dev-browser/`.

## Skill via AutoVault (optional)

[AutoVault](https://autovault.dev) is a local skill vault — validate, sign, and sync skills into Claude Code / Codex / etc. without hand-copying `SKILL.md`.

```bash
autovault add verygoodplugins/browser-hand:skills/browser-hand/SKILL.md --sync-profiles
```

Then you still need `npm run setup` for the **runtime** (extension + relay). AutoVault only delivers the skill.

## Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose `extension/dist/chrome-mv3` in this repo
4. Confirm the extension name reads **Browser Hand**

If you previously loaded `dev-browser` or `extension/.output/chrome-mv3`, remove that unpacked extension first (or run `npm run setup -- --cleanup-legacy` for skill cleanup + printed Chrome steps).

Leave the extension **enabled**. The toolbar popup should eventually show connected once the relay is up.

## Start the relay

The extension connects to `ws://127.0.0.1:9333/extension`. Something must listen there for the whole session (not only for a single CLI call).

```bash
npm run relay
# or: browser-hand relay
# or: node cli-js/src/cli.js relay
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
      "Bash(node */cli-js/src/cli.js:*)",
      "Bash(npm run doctor:*)",
      "Bash(npm run relay:*)",
      "Bash(npm run setup:*)"
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
