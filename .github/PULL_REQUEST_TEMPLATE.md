<!--
  Title format: <type>[(<scope>)]: <summary>  — scope is optional.
  Examples: fix(cli-js): honor --page-name on fill · docs: AGENTS.md canonical
  See https://www.conventionalcommits.org
-->

## Summary

<!-- 1-3 sentences describing the change and why. -->

## Changes

- 

## Test plan

- [ ] Extension path: `npm run build:relay` / extension tests as applicable
- [ ] `npm run doctor` healthy when touching attach/CDP/relay (`tab_bootstrap_works`)
- [ ] Upstream path (only if daemon/cli touched): `cd daemon && npx tsc --noEmit && pnpm vitest run`
- [ ] Manual verification (describe below)

## Notes for reviewers

<!-- Risk areas, focus-policy impact, migration notes, follow-ups. -->
