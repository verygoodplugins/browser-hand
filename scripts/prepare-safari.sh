#!/usr/bin/env bash
# Prepare a locally signed Safari extension project without overwriting one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'HELP'
Usage: npm run safari:prepare -- [output-directory]

Build the Safari extension and generate a macOS Xcode project. Open the project,
select your Apple Development team for both targets, then build and run. Copy
Browser Hand.app from Xcode's Products folder to your Applications folder.

BROWSER_HAND_EXTENSION_RELAY_PORT selects the relay port embedded in the
extension (default 9333). Set DEV_BROWSER_RELAY_PORT to the same port when
running the relay and CLI. The output directory must not already exist.
BROWSER_HAND_SAFARI_BUNDLE_ID sets the app bundle identifier. Use an identifier
owned by your Apple Development team (default ai.autojack.browserhand.safari).
HELP
  exit 0
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'Safari packaging requires macOS and Xcode.' >&2
  exit 1
fi
OUTPUT="${1:-$ROOT/build/safari-project}"
if [[ -e "$OUTPUT" ]]; then
  echo "Refusing to overwrite existing path: $OUTPUT" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUTPUT")"
OUTPUT="$(cd "$(dirname "$OUTPUT")" && pwd)/$(basename "$OUTPUT")"
PORT="${BROWSER_HAND_EXTENSION_RELAY_PORT:-9333}"
BUNDLE_ID="${BROWSER_HAND_SAFARI_BUNDLE_ID:-ai.autojack.browserhand.safari}"
if [[ ! "$BUNDLE_ID" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo 'BROWSER_HAND_SAFARI_BUNDLE_ID must be a reverse-DNS bundle identifier.' >&2
  exit 1
fi
BROWSER_HAND_EXTENSION_RELAY_PORT="$PORT" npm run build:safari -w browser-hand-extension
xcrun safari-web-extension-converter extension/dist/safari-mv3 \
  --project-location "$OUTPUT" --app-name 'Browser Hand' \
  --bundle-identifier "$BUNDLE_ID" \
  --swift --macos-only --copy-resources --no-open --no-prompt

# Converter versions may derive either or both IDs from the app name, and may
# generate test targets. Set only the host and extension build settings.
PROJECT="$OUTPUT/Browser Hand/Browser Hand.xcodeproj"
python3 "$ROOT/scripts/fix-safari-identifiers.py" "$PROJECT" "$BUNDLE_ID"
printf '\nProject ready: %s\nRelay port: %s\n' "$PROJECT" "$PORT"
printf '%s\n' 'Open in Xcode, select your signing team for both targets, build and run; then copy the signed app into Applications and enable its Safari extension.'
