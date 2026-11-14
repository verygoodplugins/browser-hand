#!/usr/bin/env bash
# Produce a notarized, stapled Safari app zip. Never publish or overwrite.
set -euo pipefail
if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  cat <<'HELP'
Usage: APPLE_NOTARY_PROFILE=<keychain-profile> npm run safari:package -- /path/to/Browser\ Hand.app /path/to/output.zip

Takes an already Developer ID Application-signed app and its signed Safari
extension, verifies the signatures and bundle identifiers, submits a temporary
archive to Apple's notary service, staples and validates the app, then creates
an installable zip and SHA-256 checksum. Nothing is published. The notary
profile contains credentials in the macOS keychain; do not pass passwords on
the command line. This modifies the app by stapling the notarization ticket.
HELP
  exit 0
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'Safari distribution requires macOS.' >&2; exit 1; }
[[ $# == 2 ]] || { echo 'Pass a signed .app and an unused .zip output path; see --help.' >&2; exit 2; }
APP="$1"
OUTPUT="$2"
PROFILE="${APPLE_NOTARY_PROFILE:-}"
[[ -n "$PROFILE" ]] || { echo 'Set APPLE_NOTARY_PROFILE to a notarytool keychain profile name.' >&2; exit 2; }
[[ -d "$APP" && "$APP" == *.app ]] || { echo 'Input must be an existing .app bundle.' >&2; exit 2; }
[[ "$OUTPUT" == *.zip && ! -e "$OUTPUT" && ! -e "$OUTPUT.sha256" ]] || { echo 'Output must be an unused .zip path with no existing checksum.' >&2; exit 2; }
[[ -d "$(dirname "$OUTPUT")" ]] || { echo 'Output directory does not exist.' >&2; exit 2; }
EXTENSIONS=("$APP"/Contents/PlugIns/*.appex)
[[ ${#EXTENSIONS[@]} == 1 && -d "${EXTENSIONS[0]}" ]] || { echo 'Expected exactly one embedded Safari extension.' >&2; exit 1; }
EXT="${EXTENSIONS[0]}"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$EXT/Contents/Info.plist")" == 'com.apple.Safari.web-extension' ]] || { echo 'Embedded extension is not a Safari web extension.' >&2; exit 1; }
APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")"
EXT_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$EXT/Contents/Info.plist")"
[[ "$EXT_ID" == "$APP_ID".* ]] || { echo 'Extension bundle identifier must be prefixed by the app identifier.' >&2; exit 1; }
codesign --verify --deep --strict "$APP"
codesign --verify --strict "$EXT"
for BUNDLE in "$APP" "$EXT"; do
  DETAILS="$(codesign -dv --verbose=4 "$BUNDLE" 2>&1)"
  printf '%s\n' "$DETAILS" | grep -q '^Authority=Developer ID Application:' || { echo 'Both app and extension must be signed with Developer ID Application; development or ad hoc signatures cannot be distributed.' >&2; exit 1; }
  printf '%s\n' "$DETAILS" | grep -q 'flags=.*runtime' || { echo 'Hardened Runtime is required for notarization.' >&2; exit 1; }
  printf '%s\n' "$DETAILS" | grep -q '^Timestamp=' || { echo 'Both signatures need a secure timestamp for notarization.' >&2; exit 1; }
  if codesign -d --entitlements :- "$BUNDLE" 2>/dev/null | grep -q 'com.apple.security.get-task-allow'; then
    echo 'Debugging entitlement get-task-allow must be removed before notarization.' >&2
    exit 1
  fi
done
APP_TEAM="$(codesign -dv --verbose=4 "$APP" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
EXT_TEAM="$(codesign -dv --verbose=4 "$EXT" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
[[ -n "$APP_TEAM" && "$APP_TEAM" != 'not set' && "$APP_TEAM" == "$EXT_TEAM" ]] || { echo 'App and extension must be signed by the same team.' >&2; exit 1; }
WORK="$(mktemp -d "$(dirname "$OUTPUT")/.browser-hand-notary.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
/usr/bin/ditto -c -k --keepParent "$APP" "$WORK/submission.zip"
# notarytool uses the named keychain profile directly; no credentials appear in arguments.
xcrun notarytool submit "$WORK/submission.zip" --keychain-profile "$PROFILE" --wait --output-format json > "$WORK/notary-result.json"
python3 - "$WORK/notary-result.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    result = json.load(f)
if result.get('status') != 'Accepted':
    raise SystemExit('Notarization was not accepted (status: ' + str(result.get('status', 'unknown')) + ', submission: ' + str(result.get('id', 'unknown')) + ')')
print('Notarization accepted:', result.get('id', 'unknown'))
PY
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"
codesign --verify --deep --strict "$APP"
spctl --assess --type execute "$APP"
/usr/bin/ditto -c -k --keepParent "$APP" "$WORK/final.zip"
# Hard-link atomically; do not replace an output created concurrently.
ln "$WORK/final.zip" "$OUTPUT" 2>/dev/null || { echo 'Could not create output without overwriting an existing file.' >&2; exit 1; }
(cd "$(dirname "$OUTPUT")" && shasum -a 256 "$(basename "$OUTPUT")") > "$WORK/checksum"
if ! ln "$WORK/checksum" "$OUTPUT.sha256" 2>/dev/null; then
  if [[ "$OUTPUT" -ef "$WORK/final.zip" ]]; then rm "$OUTPUT"; fi
  echo 'Could not create checksum without overwriting an existing file.' >&2
  exit 1
fi
printf 'Ready for review: %s and %s.sha256\n' "$OUTPUT" "$OUTPUT"
