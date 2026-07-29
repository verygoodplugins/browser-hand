#!/usr/bin/env bash
# anon-screenshot.sh — screenshot an ANONYMOUS / public URL via a throwaway,
# isolated Google Chrome attached over CDP with `dev-browser --connect`.
#
# For unauthenticated captures ONLY (localhost dev servers, public pages). A
# throwaway profile has no cookies — never use this for signed-in work; for
# that, use the dev-browser skill's Path A (extension relay) or Path B
# (--connect to the user's real Chrome).
#
# Why it exists: when the extension relay's MV3 service worker is asleep (Path A
# down) and the user isn't around to wake it, and you don't want to relaunch the
# user's main Chrome with debug flags, this spins up a SEPARATE Chrome you fully
# own, shoots, and tears it down — without touching the user's browser. Bare
# `dev-browser run` (no --connect) is not an option: the daemon's bundled
# Chromium SIGABRTs on this machine.
#
# Usage:   anon-screenshot.sh <url> [output_name.png] [WIDTHxHEIGHT]
# Example: anon-screenshot.sh http://127.0.0.1:8788/cloud cloud.png 1440x1000
#
# Output:  a PNG under ~/.dev-browser/tmp/ ; its path is printed to stdout.
# Env:     CHROME_BIN overrides the Chrome binary path.
set -euo pipefail

URL="${1:?usage: anon-screenshot.sh <url> [output_name.png] [WxH]}"
OUT_NAME="${2:-anon-shot.png}"
VIEWPORT="${3:-1440x1000}"
WIDTH="${VIEWPORT%x*}"
HEIGHT="${VIEWPORT#*x}"

CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome binary not found/executable: $CHROME (set CHROME_BIN)" >&2; exit 1; }
command -v dev-browser >/dev/null || { echo "dev-browser not on PATH" >&2; exit 1; }

# Pick a free debug port away from the relay (:9333) and the user's Chrome (:9222).
PORT=""
for p in 9223 9224 9225 9226 9227; do
  if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then PORT="$p"; break; fi
done
[ -n "$PORT" ] || { echo "no free debug port in 9223-9227" >&2; exit 1; }

TMP_PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/anon-chrome.XXXXXX")"
CHROME_PID=""
cleanup() {
  if [ -n "$CHROME_PID" ]; then
    kill "$CHROME_PID" >/dev/null 2>&1 || true
    # Wait for Chrome to actually exit before removing its profile, else it
    # keeps writing into the dir and `rm` races to "Directory not empty".
    wait "$CHROME_PID" 2>/dev/null || true
  fi
  rm -rf -- "$TMP_PROFILE" 2>/dev/null || true
}
trap cleanup EXIT

"$CHROME" \
  --headless=new \
  --remote-debugging-port="$PORT" \
  --remote-allow-origins="http://127.0.0.1:$PORT" \
  --user-data-dir="$TMP_PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --no-first-run --no-default-browser-check \
  about:blank >/dev/null 2>&1 &
CHROME_PID=$!

# Wait (best effort) for the debug endpoint. /json/version can 404 on some
# builds even when the WS attach works, so this is a courtesy poll — the
# --connect step below surfaces the real error if Chrome never came up.
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/json/version"; then break; fi
  sleep 0.2
done

dev-browser --connect "http://127.0.0.1:$PORT" run /dev/stdin <<EOF
const pages = await browser.listPages();
if (!pages.length) { throw new Error("no page in throwaway Chrome"); }
const page = await browser.getPage(pages[0].id);
await page.setViewportSize({ width: $WIDTH, height: $HEIGHT });
// Clerk / analytics pages never reach networkidle — domcontentloaded + fixed wait.
await page.goto("$URL", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const shot = await page.screenshot();
console.log(await saveScreenshot(shot, "$OUT_NAME"));
EOF
