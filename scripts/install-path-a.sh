#!/usr/bin/env bash
# Compat wrapper — prefer `npm run setup` / scripts/setup.sh.
# Historical name: install-path-a.sh (Path A was the AutoHub-era label for this CLI).
exec "$(cd "$(dirname "$0")" && pwd)/setup.sh" "$@"
