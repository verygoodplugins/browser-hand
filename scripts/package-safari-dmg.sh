#!/usr/bin/env bash
# Wrap a notarized app in a signed, separately notarized drag-to-install image.
set -euo pipefail
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: APPLE_DEVELOPER_IDENTITY="Developer ID Application: …" APPLE_NOTARY_PROFILE=profile bash scripts/package-safari-dmg.sh /path/to/Browser\ Hand.app /path/to/output.dmg'
  exit 0
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'Safari distribution requires macOS.' >&2; exit 1; }
[[ $# == 2 && -d "$1" && "$1" == *.app && "$2" == /*.dmg ]] || { echo 'Provide a notarized .app and an unused absolute .dmg path.' >&2; exit 2; }
[[ ! -e "$2" && ! -e "$2.sha256" && -d "$(dirname "$2")" ]] || { echo 'Output or checksum already exists, or its directory is missing.' >&2; exit 2; }
[[ -n "${APPLE_DEVELOPER_IDENTITY:-}" && -n "${APPLE_NOTARY_PROFILE:-}" ]] || { echo 'Set APPLE_DEVELOPER_IDENTITY and APPLE_NOTARY_PROFILE.' >&2; exit 2; }
APP="$1"
OUTPUT="$2"
codesign --verify --deep --strict "$APP"
xcrun stapler validate "$APP"
spctl --assess --type execute "$APP"
WORK="$(mktemp -d "$(dirname "$OUTPUT")/.browser-hand-dmg.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/volume"
ditto "$APP" "$WORK/volume/Browser Hand.app"
ln -s /Applications "$WORK/volume/Applications"
hdiutil create -quiet -volname 'Browser Hand' -srcfolder "$WORK/volume" -format UDZO "$WORK/final.dmg"
codesign --force --sign "$APPLE_DEVELOPER_IDENTITY" --timestamp --identifier ai.autojack.browserhand.dmg "$WORK/final.dmg"
codesign --verify --strict "$WORK/final.dmg"
xcrun notarytool submit "$WORK/final.dmg" --keychain-profile "$APPLE_NOTARY_PROFILE" --wait --output-format json > "$WORK/notary-result.json"
python3 - "$WORK/notary-result.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    result = json.load(f)
if result.get('status') != 'Accepted':
    raise SystemExit('Disk image notarization was not accepted (status: ' + str(result.get('status', 'unknown')) + ', submission: ' + str(result.get('id', 'unknown')) + ')')
print('Disk image notarization accepted:', result.get('id', 'unknown'))
PY
xcrun stapler staple "$WORK/final.dmg"
xcrun stapler validate "$WORK/final.dmg"
hdiutil verify -quiet "$WORK/final.dmg"
codesign --verify --strict "$WORK/final.dmg"
spctl --assess --type open --context context:primary-signature "$WORK/final.dmg"
ln "$WORK/final.dmg" "$OUTPUT" 2>/dev/null || { echo 'Could not create output without overwriting an existing file.' >&2; exit 1; }
(cd "$(dirname "$OUTPUT")" && shasum -a 256 "$(basename "$OUTPUT")") > "$WORK/checksum"
if ! ln "$WORK/checksum" "$OUTPUT.sha256" 2>/dev/null; then
  if [[ "$OUTPUT" -ef "$WORK/final.dmg" ]]; then rm "$OUTPUT"; fi
  echo 'Could not create checksum without overwriting an existing file.' >&2
  exit 1
fi
printf 'Ready for review: %s and %s.sha256\n' "$OUTPUT" "$OUTPUT"
