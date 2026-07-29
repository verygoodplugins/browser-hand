# Agent Obstacle Course

Local gym for dogfooding Path A (`dev-browser` extension relay + AutoHub CLI).

## Serve

```bash
# from repo root
bash scripts/serve-challenges.sh
# → http://127.0.0.1:8765/
```

## Dogfood (Path A)

```bash
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js doctor
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js open \
  --url http://127.0.0.1:8765/01-hello-form.html \
  --page-name ch-01
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js snapshot --page-name ch-01
# fill / type / click …
node ~/Projects/OpenAI/autohub/bin/dev-browser-cli.js evaluate \
  --page-name ch-01 \
  --code 'JSON.stringify(window.__oracle())'
```

## Oracle contract

- `window.__CHALLENGE__` — `{ id, name, version }`
- `window.__oracle()` — `{ ok, checks, detail? }`
- `#oracle-status` — `data-ok="true|false"`

## Safety

Local submits only. Public scavenger pages are navigate/snapshot-only — no form submit on third-party sites.

## Ledger

Update `LEDGER.md` after each challenge attempt.
