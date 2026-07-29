#!/usr/bin/env bash
# Install Browser Hand Path A stack from this monorepo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> npm install (workspaces)"
npm install

echo "==> build relay"
npm run build:relay

echo "==> build extension"
npm run build:extension || {
  echo "extension build failed — try: cd extension && npm i && npm run build" >&2
  exit 1
}

echo "==> link bins (optional global)"
if [[ "${BROWSER_HAND_NO_LINK:-}" != "1" ]]; then
  (cd path-a && npm link) || true
  (cd relay && npm link) || true
fi

# Skill install locations
SKILL_SRC="$ROOT/skills/browser-hand"
for dest in \
  "${HOME}/.claude/skills/browser-hand" \
  "${HOME}/.agents/skills/browser-hand" \
  "${HOME}/.codex/skills/browser-hand"
do
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$SKILL_SRC/." "$dest/"
  echo "installed skill → $dest"
done

# Optional: keep legacy skill name as a thin pointer
LEGACY="${HOME}/.claude/skills/dev-browser"
if [[ -d "$LEGACY" ]] || [[ "${BROWSER_HAND_LEGACY_ALIAS:-1}" == "1" ]]; then
  mkdir -p "$LEGACY"
  cat > "$LEGACY/SKILL.md" <<'MD'
---
name: dev-browser
description: Alias — prefer skill browser-hand. Path A extension relay for logged-in Chrome.
---

# dev-browser → browser-hand

This skill moved to **browser-hand** in the Very Good Plugins monorepo.

Use skill `browser-hand` and CLI:

```bash
node <browser-hand-repo>/path-a/src/cli.js doctor
```

See `~/.claude/skills/browser-hand/SKILL.md`.
MD
  echo "legacy alias skill → $LEGACY"
fi

echo ""
echo "Next:"
echo "  1. Chrome → chrome://extensions → Load unpacked → $ROOT/extension/.output/chrome-mv3"
echo "  2. Ensure relay on :9333:  npm run relay   # or keep existing launchd relay"
echo "  3. npm run doctor"
echo "  4. npm run smoke:live"
