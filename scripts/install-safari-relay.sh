#!/usr/bin/env bash
# Install a user-scoped launchd relay for Safari; never replace an existing job.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEV_BROWSER_RELAY_PORT:-19333}"
LABEL="com.browser-hand.safari-relay"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.browser-hand/logs"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '%s\n' 'Usage: DEV_BROWSER_RELAY_PORT=19333 npm run safari:relay:install' 'Installs a persistent user LaunchAgent; it refuses an existing job or occupied port.'
  exit 0
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'Requires macOS.' >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]+$ ]] && (( 10#$PORT >= 1 && 10#$PORT <= 65535 )) || { echo 'Invalid relay port.' >&2; exit 1; }
[[ ! -e "$PLIST" ]] || { echo "Refusing to overwrite existing job: $PLIST" >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port $PORT is already in use; stop its relay before installing this job." >&2
  exit 1
fi
NODE="$(command -v node)"
[[ -f "$ROOT/relay/dist/standalone.js" ]] || { echo 'Build the relay first: npm run build:relay' >&2; exit 1; }
mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
python3 - "$PLIST" "$LABEL" "$NODE" "$ROOT/relay/dist/standalone.js" "$PORT" "$LOG_DIR" <<'PY'
import plistlib, sys
path, label, node, entry, port, logs = sys.argv[1:]
job = {'Label': label, 'ProgramArguments': [node, entry],
       'EnvironmentVariables': {'HOST': '127.0.0.1', 'PORT': port},
       'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
       'StandardOutPath': f'{logs}/safari-relay-{port}.out',
       'StandardErrorPath': f'{logs}/safari-relay-{port}.err'}
with open(path, 'xb') as stream:
    plistlib.dump(job, stream)
PY
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  rm "$PLIST"
  exit 1
fi
printf 'Installed %s for relay port %s.\n' "$PLIST" "$PORT"
printf 'To remove: launchctl bootout gui/%s %s; then remove that plist.\n' "$(id -u)" "$PLIST"
