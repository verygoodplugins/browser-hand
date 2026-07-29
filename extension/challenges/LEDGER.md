# Obstacle Course Ledger

Updated 2026-07-29 after Path A dogfood + stack fixes.

| id | status | friction notes | fix commit(s) | re-run |
|---|---|---|---|---|
| 01 | pass | snapshot labels empty; fill ignored `--page-name` | autohub `158bf180` pageName + label[for] | pass end-to-end with `--page-name` |
| 02 | pass | array `--fields` silent no-op; object fill OK | autohub array-fields reject (dogfood CLI commit) | pass |
| 03 | pass | Chrome password heuristics on id/label "username" caused debugger target_closed; gym renamed to Handle | soft-detach harden + gym de-autofill `8d129d9` | pass same targetId multi-step |
| 04 | pass | type lacked beforeinput → editor state empty | CLI type InputEvent pipeline | pass type+click |
| 05 | pass | bare `el.click()` ignored by role=button | CLI pointer sequence | pass click --text Done |
| 06 | pass | click-by-text hit hidden Next; visible-first fixed | CLI visible-first click | pass fill+Next×2+Confirm |
| 07 | pass | re-snapshot after country required (works) | — | pass |
| 08 | pass | snapshot/fill missed shadow | CLI shadow pierce | pass fill+click in shadow |
| 09 | pass | snapshot/fill missed iframe | CLI same-origin iframe pierce | pass fill+click in iframe |
| 10 | pass | alerts only in free text | snapshot `alerts[]` added | pass recovery path |
| 11 | pass | re-snapshot after hash nav | — | pass |
| 12 | pass | 65s idle; same targetId; doctor still healthy | MV3 alarms+WS heartbeat | pass waitedMs=65305 |
| scavenger-example | pass | example.com read-only snapshot | — | title/heading/link OK |
| focus | fixed | activateTarget stole OS focus | extension `275f74a` focusPolicy=background | reload unpacked ext |
| 13 | pass | re-snapshot after open modal | — | pass |
| 14 | pass | no native scroll op; evaluate scrollIntoView | optional scroll CLI | pass |
| 15 | pass | boolean fill works | — | pass |
| 16 | pass | role=option missing from click pool | CLI ARIA roles commit | pass text click |
| 17 | pass | click-open menu works | — | pass |
| 18 | pass | policy: stop not solve | skill captcha rule | pass |
| 19 | pass | username type → target_closed → scripting fallback; multi-step same targetId | extension `7df684b` scripting fallback | pass oracle; logs show fallback |

\* ch-03: soft-detach is in unpacked build; reload Chrome extension once more for full stickiness without re-navigate recovery.

\* ch-03 multi-step page-name stickiness after username still needs investigation (extension/relay).
