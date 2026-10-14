# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-10-14

- Added `--group-title` on `open` and `goto`. Tabs for one task join a Chrome tab group with that title and a color. The same title keeps joining the group. A different title starts a new group. With no title, the group stays named Browser Hand. If a saved group cannot be reused in that tab's window, Browser Hand opens a replacement group instead of failing the command.
- Added `steps`, one call for a repeated form (click, fill, type, evaluate, snapshot). The call stops at the first miss, and step snapshots leave formatted secrets out.
- Added a scoped snapshot (open dialog plus main by default) and clicks by snapshot ref or by role and accessible name. Covered controls are skipped. `doctor` stays a short health check. `tabs` is the inventory.
- Snapshot `forms` lists the labeled fields in that same scope.
- Fixed fill so a missed field fails the command, and the read-back keeps unicode and punctuation. A control whose form id is missing is not attached.
- Fixed combobox fill so it types, then chooses the matching option.
- Fixed `open` so an existing tab is reused instead of a new blank one. Snapshot and evaluate no longer create a named tab just to read the page.
- Fixed the debugger infobar: after you dismiss "Browser Hand started debugging this browser", that tab stays on the scripting path and the bar is not brought back.
- Improved the toolbar icon so the crop is the solid glove, not the wrist mist.

## [0.2.9] - 2026-07-14

- Added configurable per-browser idle cleanup with `--idle-timeout`, `DEV_BROWSER_IDLE_TIMEOUT_MS`, and `~/.dev-browser/config.json` support. Idle cleanup preserves persistent profiles, excludes externally connected Chrome, and safely rechecks activity under the per-browser lock before closing.

## [0.2.8] - 2026-06-05

- Added the `page.cua.*` pixel/vision toolset: coordinate-based `click`, `doubleClick`, `drag`, `move`, `scroll`, `keypress`, and `type`, plus a JPEG `screenshot()` whose pixels map 1:1 onto click coordinates at any DPR.
- Added the `page.domCua.*` DOM-id toolset: `getVisibleDom()` snapshots visible interactive elements as `node_id=N` lines, with `click`, `doubleClick`, `scroll`, `type`, and `keypress` acting against the latest snapshot's ids.
- Fixed script error messages being dropped from CLI output; thrown errors now report their name and message alongside the stack.
- Documented the vision and DOM-id workflows in the `--help` LLM usage guide.
- Capped the daemon's per-connection request buffer so a local client can no longer exhaust daemon memory with an unterminated frame.
- Serialized `browser-stop` with the per-browser lock so a browser can no longer be torn down while another client's script is running.
- Hardened daemon cold start against duplicate daemons when concurrent CLI invocations race to spawn one.
- Defaulted `PW_CHROMIUM_ATTACH_TO_OTHER=1` so attaching over CDP to Chrome 147's built-in remote debugging no longer hangs.

## [0.2.7] - 2026-04-09

- Updated documentation to recommend `domcontentloaded` for dev server navigation.

## [0.2.6] - 2026-03-30

- Pinned Playwright version.

## [0.2.5] - 2026-03-30

- Updated Windows documentation with PowerShell examples.
- Use null viewport for headed mode.

## [0.2.4] - 2026-03-26

- Added `--ignore-https-errors` flag for self-signed certificates.

## [0.2.3] - 2026-03-25

- Added Windows x64 compatibility.

## [0.2.1] - 2026-03-19

- Added an interactive `install-skill` TUI command to install the skill into `~/.claude/skills/` and `~/.agents/skills/`.
- Added a `--timeout` flag for script execution with a 30-second default.
- Documented `page.snapshotForAI()` for LLM-friendly page inspection.
- Expanded the `--help` LLM usage guide with approach guidance, screenshots, waiting patterns, and error recovery.
- Simplified the README, added a Windows-not-supported note, and attributed Do Browser.
- Aligned marketplace versioning with `package.json` and added auto-sync support.
- Added `rustfmt` and Prettier plus CI format checks.

## [0.2.0] - 2026-03-19

Initial CLI release.
