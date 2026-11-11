# Releasing Browser Hand

This monorepo ships two related surfaces:

| Surface | What ships | Audience |
|---|---|---|
| **Browser Hand** (product) | Extension + relay + `browser-hand` CLI + skill | Logged-in Chrome agents |
| **Upstream headless** | `dev-browser` binary + daemon (historical package name) | CI / disposable Chromium |

Versioning follows the mcp-ecosystem Release Please setup. Merges into `main` are squash-only, the PR title is the commit Release Please reads, and the Release PR is the only version bump.

See [MIGRATING.md](./MIGRATING.md) for the rename map.

## Versioning

Release Please tracks the root package (`package.json` `0.3.0` today). On each push to `main` it updates one Release PR. Merging that PR:

- bumps `package.json` and `package-lock.json`
- bumps `cli/Cargo.toml`, `cli/Cargo.lock`, and `.claude-plugin/marketplace.json`
- writes `CHANGELOG.md`
- tags `browser-hand-vX.Y.Z` and opens the GitHub Release

| PR title on `main` | While 0.x | From 1.0.0 |
|---|---|---|
| `fix:` | patch | patch |
| `feat:` | minor | minor |
| `feat!:` or `BREAKING CHANGE` | minor | major |
| `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `build:`, `ci:` | no release | no release |

`bump-minor-pre-major` is on, so a breaking change does not jump `0.3.0` to `1.0.0`. `bump-patch-for-minor-pre-major` is off: a feature still bumps the minor, matching the releases already in `CHANGELOG.md`. The TypeScript template sets that second flag because those servers start at `1.0.0`, where the flag does nothing.

Tags are `browser-hand-vX.Y.Z`, not `vX.Y.Z`. This repo already has `v1.2.0` (extension) and `v1.0.0-rc.*` (older headless candidates). A bare `v*` tag would make Release Please treat `v1.2.0` as the package version.

The extension (`extension/package.json`, currently `1.2.0`), relay, `cli-js`, and daemon keep their own versions. Release Please does not bump them.

`scripts/sync-version.js` remains for a local `npm version` experiment. Do not use it to cut a release.

History before the `v0.3.0` commit (`516db83049d624c62ccb71d7e6e2eb55f7dedfee`) is the bootstrap point. Release Please will not replay it. Merge commits already on `main` are not conventional titles, so they do not open a release by themselves. The next conventional squash does.

## What you do

1. Open a PR whose title is a Conventional Commit. `.github/workflows/pr-title.yml` checks it.
2. Squash-merge into `main` after CI is green.
3. Review the Release PR (`chore: release X.Y.Z`) and merge it when the notes look right. That merge is the release.

Do not bump the version by hand, and do not push a tag yourself.

## First-time setup

`RELEASE_PLEASE_TOKEN` is an org secret. This repo has to be on its selected-repository list. PRs opened with the default `GITHUB_TOKEN` do not trigger CI, so the Release PR would sit with required checks pending.

npm publishing uses GitHub Actions trusted publishing (OIDC). The release workflow does not need an `NPM_TOKEN`. When publishing the headless package still named `dev-browser`, configure a trusted publisher for `verygoodplugins/browser-hand` and workflow filename `release.yml`.

The workflow needs `id-token: write`, which is already configured in `.github/workflows/release.yml`.

## What the tag workflow does

See `.github/workflows/release.yml`. On `browser-hand-v*` (the tag Release Please pushes):

| Step | What happens |
|------|-------------|
| **Decide** | Publishes npm only when the tag version matches `package.json` and the `PUBLISH_NPM` repository variable is `true` |
| **GitHub Release** | Leaves the Release Please notes in place. Creates a release only if one does not exist yet |
| **Bundle** | When publishing: `pnpm bundle` and `pnpm bundle:sandbox-client` in `daemon/` |
| **Build** | Cross-compiles the Rust CLI for each platform target, embedding the generated daemon bundles |
| **Assemble** | Copies bin wrapper, postinstall, daemon bundles, README, LICENSE into the publish dir |
| **Publish npm** | OIDC trusted publishing runs `npm publish` from the assembled directory |
| **Attach binaries** | Uploads the platform binaries onto the existing GitHub Release without rewriting the notes |

Product-only changes still cut a GitHub Release and a tag. They do not republish the `dev-browser` npm package unless `PUBLISH_NPM=true`.

If publishing fails after npm accepts the version, do not reuse that version. Fix the workflow and ship a new patch.

```bash
gh run list --workflow release.yml --limit 1
npm info dev-browser version
```

## Branch protection

`main` is a repository ruleset: no force-push, no deletion, pull request required, linear history, conversations resolved, squash only, code owner review. Admins can bypass on a pull request. Required checks are the CI jobs that already run on pull requests: `Build Daemon Bundles`, `Format Checks`, `Daemon (TypeScript + Tests)` on `ubuntu-24.04` and `windows-latest`, and `CLI (Rust)` on `ubuntu-latest` and `windows-latest`.

`Lint PR Title` runs on pull requests. It is not a required check yet, because `pull_request_target` reads the workflow from `main` and the check does not exist until this workflow is on `main`. Add it to the ruleset after that.

Merge queue stays off until the `merge_group` trigger in `.github/workflows/ci.yml` is on `main`. Enabling it earlier waits forever for checks the workflow on `main` never reports. That workflow does not cancel an in-progress merge-queue run.

Release tags (`v*` and `browser-hand-v*`) cannot be deleted or moved. Admins can bypass that rule.

Non-major Dependabot updates are approved and set to auto-merge by the shared workflow in `verygoodplugins/.github`. Major updates are labeled for review. Auto-merge still waits for the required checks and code owner review.

## Platform Binaries

| Platform | Rust Target | Binary Name |
|----------|------------|-------------|
| macOS Apple Silicon | `aarch64-apple-darwin` | `dev-browser-darwin-arm64` |
| macOS Intel | `x86_64-apple-darwin` | `dev-browser-darwin-x64` |
| Linux x64 | `x86_64-unknown-linux-gnu` | `dev-browser-linux-x64` |
| Linux ARM64 | `aarch64-unknown-linux-gnu` | `dev-browser-linux-arm64` |
| Linux x64 (musl) | `x86_64-unknown-linux-musl` | `dev-browser-linux-musl-x64` |
| Windows x64 | `x86_64-pc-windows-msvc` | `dev-browser-windows-x64.exe` |

## How Users Install

```bash
# Global install (postinstall downloads binary, patches shims for zero Node startup)
npm install -g dev-browser
dev-browser install    # installs Playwright + Chromium

# Or one-off via npx (uses Node wrapper, slightly slower startup)
npx dev-browser --help
```

Windows PowerShell:

```powershell
npm install -g dev-browser
dev-browser install
chrome.exe --remote-debugging-port=9222
dev-browser --connect
```
