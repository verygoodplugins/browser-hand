# Agent Obstacle Course

Local gym for dogfooding Browser Hand (extension relay + `browser-hand` CLI).

## Serve

```bash
# from extension/
bash scripts/serve-challenges.sh
# → http://127.0.0.1:8766/  (default; 8765 often taken)
```

## Dogfood

```bash
# from repository root (not extension/)
npm run doctor
browser-hand open \
  --url http://127.0.0.1:8766/01-hello-form.html \
  --page-name ch-01
browser-hand snapshot --page-name ch-01
# fill / type / click …
browser-hand evaluate \
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
