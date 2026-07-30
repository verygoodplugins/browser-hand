#!/usr/bin/env bash
# One-command Browser Hand product setup: deps, relay, extension, skill.
# Usage:
#   npm run setup
#   npm run setup -- --cleanup-legacy
#   bash scripts/setup.sh [--cleanup-legacy] [--no-link] [--legacy-alias]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CLEANUP_LEGACY=0
NO_LINK=0
LEGACY_ALIAS=0

for arg in "$@"; do
  case "$arg" in
    --cleanup-legacy) CLEANUP_LEGACY=1 ;;
    --no-link) NO_LINK=1 ;;
    --legacy-alias) LEGACY_ALIAS=1 ;;
    -h|--help)
      cat <<'EOF'
Browser Hand setup — build the product stack (extension + relay + CLI skill).

Usage: bash scripts/setup.sh [options]

Options:
  --cleanup-legacy   Remove legacy skill aliases (dev-browser) and print how
                     to remove an old unpacked Chrome extension. Does NOT
                     touch Chrome profile data or ~/.dev-browser/.
  --legacy-alias     Keep installing a thin ~/.claude/skills/dev-browser pointer
                     (off by default; prefer skill browser-hand).
  --no-link          Skip npm link for browser-hand / relay bins.
  -h, --help         Show this help.

Env:
  BROWSER_HAND_NO_LINK=1     Same as --no-link
  BROWSER_HAND_LEGACY_ALIAS=1  Same as --legacy-alias
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

if [[ "${BROWSER_HAND_NO_LINK:-}" == "1" ]]; then
  NO_LINK=1
fi
if [[ "${BROWSER_HAND_LEGACY_ALIAS:-}" == "1" ]]; then
  LEGACY_ALIAS=1
fi

EXT_LOAD_DIR="$ROOT/extension/dist/chrome-mv3"

echo "==> npm install (workspaces)"
npm install

echo "==> build relay"
npm run build:relay

echo "==> build extension (Browser Hand → extension/dist/chrome-mv3)"
npm run build:extension || {
  echo "extension build failed — try: cd extension && npm i && npm run build" >&2
  exit 1
}

if [[ ! -d "$EXT_LOAD_DIR" ]]; then
  echo "error: expected unpacked extension at $EXT_LOAD_DIR" >&2
  exit 1
fi

echo "==> link bins (optional global)"
if [[ "$NO_LINK" != "1" ]]; then
  (cd cli-js && npm link) || true
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

LEGACY_SKILL="${HOME}/.claude/skills/dev-browser"
LEGACY_CODEX="${HOME}/.codex/skills/dev-browser"
LEGACY_AGENTS="${HOME}/.agents/skills/dev-browser"

if [[ "$CLEANUP_LEGACY" == "1" ]]; then
  echo "==> cleanup legacy skill aliases"
  for legacy in "$LEGACY_SKILL" "$LEGACY_CODEX" "$LEGACY_AGENTS"; do
    if [[ -e "$legacy" ]]; then
      rm -rf "$legacy"
      echo "removed $legacy"
    fi
  done
  # Cursor / Claude plugin marketplace copies sometimes use this name
  for legacy in \
    "${HOME}/.cursor/skills/dev-browser" \
    "${HOME}/.claude/plugins/cache"/*/dev-browser
  do
    if [[ -e "$legacy" ]]; then
      echo "note: left alone (plugin cache): $legacy — remove manually if unused"
    fi
  done
  cat <<EOF

Legacy skill aliases removed (or were already gone).

Still remove the OLD Chrome extension by hand (safe — does not delete profile data):
  1. Open chrome://extensions
  2. Find any extension named "dev-browser" (or an old unpacked load from
     …/extension/.output/chrome-mv3 or a separate clone)
  3. Remove it
  4. Load unpacked → $EXT_LOAD_DIR  (name should read "Browser Hand")

Upstream headless leftovers (left alone on purpose):
  - binary / npm package "dev-browser"
  - ~/.dev-browser/ config
  - DEV_BROWSER_* env vars
EOF
elif [[ "$LEGACY_ALIAS" == "1" ]]; then
  mkdir -p "$LEGACY_SKILL"
  cat > "$LEGACY_SKILL/SKILL.md" <<'MD'
---
name: dev-browser
description: Alias — prefer skill browser-hand for real logged-in Chrome.
---

# dev-browser → browser-hand

This skill moved to **browser-hand**.

```bash
browser-hand doctor
# or: npm run doctor
```

See `~/.claude/skills/browser-hand/SKILL.md`.
MD
  echo "legacy alias skill → $LEGACY_SKILL"
fi

# Reveal load folder on macOS for one less mystery step
if [[ "$(uname -s)" == "Darwin" ]] && [[ -d "$EXT_LOAD_DIR" ]]; then
  open "$EXT_LOAD_DIR" 2>/dev/null || true
fi

cat <<EOF

✅ Browser Hand product stack is ready.

Next (one-time Chrome step — Chrome cannot be automated for this):
  1. chrome://extensions → Developer mode → Load unpacked
  2. Select this folder:
       $EXT_LOAD_DIR
     (extension name should be "Browser Hand")
  3. npm run relay          # leave running
  4. npm run doctor         # want status: tab_bootstrap_works

Drive a tab:
  browser-hand open --url https://example.com --page-name demo
  browser-hand snapshot --page-name demo

Switching from old "dev-browser" skill/extension installs?
  npm run setup -- --cleanup-legacy
  See MIGRATING.md

Upstream headless CLI (optional CI): still "dev-browser" — see README § Headless.
EOF
