#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 8765 is often taken on this machine (Slack MCP). Default 8766.
PORT="${OBSTACLE_COURSE_PORT:-8766}"
cd "$ROOT/challenges"
echo "Agent Obstacle Course → http://127.0.0.1:${PORT}/"
exec python3 -m http.server "$PORT"