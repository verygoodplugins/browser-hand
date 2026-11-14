#!/usr/bin/env bash
# Build and notarize a self-contained Safari app. The destination must be unused.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: APPLE_DEVELOPER_IDENTITY="Developer ID Application: …" APPLE_NOTARY_PROFILE=profile npm run safari:standalone -- /path/to/output.dmg'
  exit 0
fi
[[ $# == 1 && "$1" == /*.dmg && ! -e "$1" && ! -e "$1.sha256" ]] || { echo 'Provide an unused absolute .dmg output path.' >&2; exit 2; }
[[ -n "${APPLE_DEVELOPER_IDENTITY:-}" && -n "${APPLE_NOTARY_PROFILE:-}" ]] || { echo 'Set APPLE_DEVELOPER_IDENTITY and APPLE_NOTARY_PROFILE.' >&2; exit 2; }
[[ "$(uname -s)" == Darwin ]] || { echo 'Requires macOS and Xcode.' >&2; exit 1; }
OUTPUT="$1"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/browser-hand-standalone.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
VERSION=24.22.3
BASE="https://nodejs.org/dist/v$VERSION"
curl -fsSL "$BASE/node-v$VERSION-darwin-arm64.tar.gz" -o "$WORK/arm64.tar.gz"
curl -fsSL "$BASE/node-v$VERSION-darwin-x64.tar.gz" -o "$WORK/x64.tar.gz"
(cd "$WORK" && printf '%s  %s\n' \
  'ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd' arm64.tar.gz \
  '977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7' x64.tar.gz | shasum -a 256 -c -)
tar -xzf "$WORK/arm64.tar.gz" -C "$WORK"
tar -xzf "$WORK/x64.tar.gz" -C "$WORK"
BROWSER_HAND_EXTENSION_RELAY_PORT=19334 npm run safari:prepare -- "$WORK/project"
PROJECT_DIR="$WORK/project/Browser Hand"
PROJECT="$PROJECT_DIR/Browser Hand.xcodeproj"
HOST_DIR="$PROJECT_DIR/Browser Hand"
cp safari/standalone/ViewController.swift "$HOST_DIR/ViewController.swift"
cp safari/standalone/Main.html "$HOST_DIR/Resources/Base.lproj/Main.html"
cp safari/standalone/Script.js safari/standalone/Style.css "$HOST_DIR/Resources/"
npx -y xcodebuildmcp@2.7.0 macos build --project-path "$PROJECT" --scheme 'Browser Hand' \
  --configuration Release --derived-data-path "$WORK/derived" --extra-args \
  'CODE_SIGNING_ALLOWED=NO' 'ARCHS=arm64 x86_64' 'ONLY_ACTIVE_ARCH=NO' 'MACOSX_DEPLOYMENT_TARGET=13.5'
APP="$WORK/derived/Build/Products/Release/Browser Hand.app"
RES="$APP/Contents/Resources"
EXT="$APP/Contents/PlugIns/Browser Hand Extension.appex"
mkdir -p "$RES/runtime" "$RES/cli" "$RES/bin" "$RES/licenses"
lipo -create "$WORK/node-v$VERSION-darwin-arm64/bin/node" "$WORK/node-v$VERSION-darwin-x64/bin/node" -output "$RES/runtime/node"
cp safari/standalone/setup.mjs "$RES/runtime/setup.mjs"
cp cli-js/src/*.js "$RES/cli/"
printf '{"type":"module"}\n' > "$RES/cli/package.json"
cp safari/standalone/browser-hand-safari safari/standalone/browser-hand-safari-relay "$RES/bin/"
chmod 755 "$RES/runtime/node" "$RES/bin/"*
npm run build:relay
./node_modules/.bin/esbuild relay/dist/standalone.js --bundle --platform=node --format=esm --target=node24 \
  --banner:js='import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' \
  --outfile="$RES/runtime/relay.mjs" --legal-comments=external
cp "$WORK/node-v$VERSION-darwin-arm64/LICENSE" "$RES/licenses/Node.js.txt"
cp LICENSE "$RES/licenses/Browser-Hand.txt"
cp node_modules/hono/LICENSE "$RES/licenses/Hono.txt"
cp node_modules/@hono/node-server/LICENSE "$RES/licenses/Hono-Node-Server.txt"
cp node_modules/ws/LICENSE "$RES/licenses/ws.txt"
curl -fsSL https://raw.githubusercontent.com/honojs/middleware/main/LICENSE -o "$RES/licenses/Hono-Middleware.txt"
codesign --force --sign "$APPLE_DEVELOPER_IDENTITY" --options runtime --timestamp \
  --entitlements safari/standalone/node-entitlements.plist "$RES/runtime/node"
codesign --force --sign "$APPLE_DEVELOPER_IDENTITY" --options runtime --timestamp \
  --entitlements safari/standalone/extension-entitlements.plist "$EXT"
codesign --force --sign "$APPLE_DEVELOPER_IDENTITY" --options runtime --timestamp "$APP"
APPLE_NOTARY_PROFILE="$APPLE_NOTARY_PROFILE" bash scripts/package-safari-release.sh "$APP" "$WORK/app-notarized.zip"
APPLE_NOTARY_PROFILE="$APPLE_NOTARY_PROFILE" bash scripts/package-safari-dmg.sh "$APP" "$OUTPUT"
