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

# Xcode 27's converter derives the app target ID from the app name but uses the
# supplied ID for the extension. Match the app ID to its generated extension.
PROJECT="$OUTPUT/Browser Hand/Browser Hand.xcodeproj"
python3 - "$PROJECT" "$BUNDLE_ID" <<'PY'
from pathlib import Path
import re
import sys
project = Path(sys.argv[1])
bundle_id = sys.argv[2]
for name in ('project.xcproj', 'project.pbxproj'):
    path = project / name
    if path.exists():
        content = path.read_text()
        extension_id = bundle_id + '.Extension'
        patterns = [r'"PRODUCT_BUNDLE_IDENTIFIER"\s*:\s*"([^"]+)"',
                    r'PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)']
        ids = []
        for pattern in patterns:
            ids.extend(re.findall(pattern, content))
        app_ids = {item.strip('"') for item in ids if item.strip('"') != extension_id}
        if extension_id not in content or len(app_ids) != 1:
            raise SystemExit('Could not safely identify generated app and extension bundle identifiers')
        path.write_text(content.replace(app_ids.pop(), bundle_id))
        break
else:
    raise SystemExit('Cannot find the generated Xcode project settings')
PY
printf '\nProject ready: %s\nRelay port: %s\n' "$PROJECT" "$PORT"
printf '%s\n' 'Open in Xcode, select your signing team for both targets, build and run; then copy the signed app into Applications and enable its Safari extension.'
