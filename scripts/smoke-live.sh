#!/usr/bin/env bash
# Live Browser Hand smoke: doctor + named open of a real site + snapshot/evaluate/screenshot.
# Requires: Chrome running, extension connected, relay on :9333.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI=(node "$ROOT/cli-js/src/cli.js")
PAGE_NAME="${BROWSER_HAND_SMOKE_PAGE:-bh-smoke-live}"
# Default to GitHub — most agents have a session; override with BROWSER_HAND_SMOKE_URL
URL="${BROWSER_HAND_SMOKE_URL:-https://github.com}"
OUT_DIR="${BROWSER_HAND_SMOKE_OUT:-$ROOT/.smoke}"
mkdir -p "$OUT_DIR"
# Also prove a live authenticated tab via --target-url when present
AUTH_URL_SUBSTR="${BROWSER_HAND_SMOKE_AUTH_URL:-mail.google.com}"

json_field() {
  # usage: json_field file key — crude node one-liner
  node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const k=process.argv[2].split('.'); let v=j; for (const p of k) v=v?.[p]; if (v===undefined||v===null) process.exit(2); process.stdout.write(String(v));" "$1" "$2"
}

echo "==> doctor"
"${CLI[@]}" doctor | tee "$OUT_DIR/doctor.json"
STATUS="$(json_field "$OUT_DIR/doctor.json" status || true)"
if [[ "$STATUS" != "tab_bootstrap_works" ]]; then
  echo "FAIL: doctor status=$STATUS (want tab_bootstrap_works)" >&2
  # still print action if present
  node -e "const j=require(process.argv[1]); console.error('action:', j.action||j.message||j);" "$OUT_DIR/doctor.json" 2>/dev/null || true
  exit 1
fi
echo "OK doctor"

echo "==> open $URL as $PAGE_NAME"
"${CLI[@]}" open --url "$URL" --page-name "$PAGE_NAME" | tee "$OUT_DIR/open.json"
OPEN_OK="$(json_field "$OUT_DIR/open.json" success || true)"
if [[ "$OPEN_OK" != "true" ]]; then
  echo "FAIL: open" >&2
  exit 1
fi
echo "OK open"

echo "==> snapshot"
"${CLI[@]}" snapshot --page-name "$PAGE_NAME" | tee "$OUT_DIR/snapshot.json"
SNAP_OK="$(json_field "$OUT_DIR/snapshot.json" success || true)"
TITLE="$(json_field "$OUT_DIR/snapshot.json" snapshot.title || true)"
SNAP_URL="$(json_field "$OUT_DIR/snapshot.json" snapshot.url || true)"
if [[ "$SNAP_OK" != "true" ]]; then
  echo "FAIL: snapshot" >&2
  exit 1
fi
echo "OK snapshot title=$TITLE url=$SNAP_URL"

echo "==> evaluate document.title + login heuristic"
"${CLI[@]}" evaluate --page-name "$PAGE_NAME" --code "$(cat <<'JS'
(() => {
  const title = document.title;
  const url = location.href;
  // soft auth signals — not a hard fail if logged out
  const body = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 4000) : '';
  const html = document.documentElement ? document.documentElement.outerHTML.slice(0, 20000) : '';
  const signedInGuess =
    /sign out|log out|your profile|account settings|@/i.test(body) ||
    !!document.querySelector('[data-login], img.avatar, .Header-link, [aria-label*="View profile"], [data-testid="user-avatar"]');
  const signedOutGuess =
    /sign in|log in|sign up/i.test(body) && !signedInGuess;
  return { title, url, signedInGuess, signedOutGuess, sample: body.slice(0, 200) };
})()
JS
)" | tee "$OUT_DIR/evaluate.json"

EVAL_OK="$(json_field "$OUT_DIR/evaluate.json" success || true)"
if [[ "$EVAL_OK" != "true" ]]; then
  echo "FAIL: evaluate" >&2
  exit 1
fi
echo "OK evaluate"

echo "==> screenshot"
"${CLI[@]}" screenshot --page-name "$PAGE_NAME" | tee "$OUT_DIR/screenshot.json"
SHOT_OK="$(json_field "$OUT_DIR/screenshot.json" success || true)"
FILE="$(json_field "$OUT_DIR/screenshot.json" filePath || true)"
if [[ "$SHOT_OK" != "true" || -z "$FILE" ]]; then
  echo "FAIL: screenshot" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "FAIL: screenshot file missing: $FILE" >&2
  exit 1
fi
cp -f "$FILE" "$OUT_DIR/live.png" 2>/dev/null || true
echo "OK screenshot $FILE"

echo "==> authenticated tab snapshot ($AUTH_URL_SUBSTR)"
if "${CLI[@]}" snapshot --target-url "$AUTH_URL_SUBSTR" | tee "$OUT_DIR/auth-snapshot.json"; then
  AUTH_OK="$(json_field "$OUT_DIR/auth-snapshot.json" success || true)"
  AUTH_TITLE="$(json_field "$OUT_DIR/auth-snapshot.json" snapshot.title || true)"
  if [[ "$AUTH_OK" == "true" ]]; then
    echo "OK auth snapshot title=$AUTH_TITLE"
  else
    echo "WARN: auth snapshot failed for $AUTH_URL_SUBSTR (not fatal if tab absent)" >&2
  fi
else
  echo "WARN: auth snapshot command failed for $AUTH_URL_SUBSTR" >&2
fi

echo ""
echo "=== SMOKE PASS ==="
echo "doctor=$STATUS open=ok snapshot_title=$TITLE evaluate=ok screenshot=$FILE"
echo "Artifacts: $OUT_DIR"
echo "Review signedInGuess in $OUT_DIR/evaluate.json for live-session confidence."
