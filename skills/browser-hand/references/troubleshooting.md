# Troubleshooting, doctor status codes, and anti-patterns

## Doctor status codes (extension mode)

`node cli-js/src/cli.js doctor` checks the relay, extension socket, named-page registry, `Target.getTargets`, and a create/close smoke tab. Use its `status` + `action` as authoritative:

- **`relay_down`** → no relay is listening. This is the usual cause of
  "connecting…". Start the persistent relay (`references/setup.md`, extension mode
  step 2). **Programmatically fixable — do not ask the user.**
- **`extension_asleep`** → click the Browser Hand Chrome toolbar icon once to
  wake the MV3 service worker; relay-side traffic does not wake it.
- **`extension_disconnected`** → enable the extension in the default Chrome
  profile and confirm it points at `ws://127.0.0.1:9333/extension`.
- **`target_registry_empty`** → the socket is alive but tab inventory is not
  reaching the relay. Reload the extension in `chrome://extensions`, confirm
  same-profile permissions, then rerun doctor.
- **`extension_unstable`** → the extension socket reconnected during tab
  creation (`Extension connection replaced`). Reload the extension before
  retrying browser work; repeated `open`/`snapshot` calls will be flaky.
- **`tab_bootstrap_works`** → extension mode is healthy. Continue with `open` or
  `snapshot`.

Two failure modes look identical but have different owners — probe first, then route to the right fix:
- `curl :9333` **refused** = no relay listening → the extension has nothing to connect to → start a persistent relay. This is yours to fix, don't ask the user.
- `curl :9333` returns **`extensionConnected: false`** = relay is up but the extension is disabled/misconfigured in Chrome → that one needs the user.
- An **asleep MV3 service worker** (recent `[relay] Extension disconnected` in the relay log) just needs one click on the extension icon; a **disabled extension** needs the user to enable it. Relay-side `goto`/`snapshot` traffic does NOT wake a sleeping worker — don't burn calls trying. Grep the relay log to tell them apart.

---

## Read-only review mode

Use this stricter mode for audits, adversarial reviews, launch checks, compliance checks, or any task where the user says observation only.

1. **Authoritative evidence must come from the user's authenticated Chrome.** extension mode `snapshot`/`screenshot` and headless/remote-debug mode `--connect` both qualify. If you accidentally capture unauthenticated or managed-browser evidence, keep it only as scratch and recapture before reporting.
2. **Do not open apply scripts.** Probe pages, inspect forms, capture screenshots, read current values. Do not click Save, Publish, Share, Upload, Schedule, Delete, or final confirmation controls.
3. **Name files with provenance.** `soundcloud_track_auth.png`, `youtube_studio_details_auth.json`, `instagram_profile_auth.png`, `soundcloud_public_logged_out.png`. Never leave the reader guessing which session produced the evidence.
4. **Separate confidence levels.** `Public` selected in an authenticated edit UI is verified account state; logged-out reachability is a separate public-visibility check. If logged-out verification is unavailable or unsafe, mark unverifiable instead of stretching the account-state evidence.
5. **If the user corrects tool choice mid-run, restart evidence collection** for the affected surfaces. Don't mix earlier artifacts into the final report unless explicitly labeled superseded.

---

## Output locations

- extension mode: JSON results on stdout from the CLI (parse before reasoning). Screenshots under `~/.browser-hand/screenshots/`.
- headless/remote-debug mode: a repeatable script pattern that survives Chrome restarts (target IDs change; the `dev-browser --connect ... run /dev/stdin` inventory step regenerates them). Pre/mid/post screenshots under `~/.dev-browser/tmp/`.
- An updated platform gotchas table (`references/platform-gotchas.md`) — every new DOM oddity hit lands in this skill on the same PR/commit that handled it.

---

## Anti-patterns

- **Reaching for headless/remote-debug mode when extension mode would do.** Default to relay. Only escalate when the task is in the gotchas table, needs `setInputFiles`/upload, or genuinely needs script-style multi-step orchestration.
- **Skipping the snapshot/probe.** Writes against the wrong tab silently mutate something else the user has open. extension mode: always `snapshot` first. headless/remote-debug mode: always run the read-only probe script first.
- **Hard-coding tab IDs across sessions.** CDP target IDs reset on Chrome restart. Re-discover them.
- **Running headless/remote-debug mode `dev-browser run` without `--connect` against a dedicated authenticated debug profile.** You'll get `about:blank`. If you are in headless/remote-debug mode, include `--connect`; if you need the default Chrome profile, use extension mode instead.
- **Running bare `dev-browser --connect http://127.0.0.1:9222` as a health check.** It only prints help. Use `... run /dev/stdin <<'EOF' ... EOF`.
- **Letting unauthenticated Browser evidence satisfy an authenticated-session request.** If the user asked for real account state, recapture through extension mode after doctor passes and label earlier artifacts non-authoritative.
- **Treating raw CDP `/json` 404 as headless/remote-debug mode failure.** For headless/remote-debug mode only, run the `dev-browser --connect ... run /dev/stdin` probe before declaring the debug Chrome unreachable. For default-profile auth work, run extension mode doctor instead.
- **Calling `setInputFiles` with a host path.** Fails with "fs is not available." Use stage-in-tmp or evaluate-File-bypass.
- **Trusting "click returned" as "save succeeded."** Verify via screenshot + re-read.
- **Letting the platform gotchas table go stale.** When you hit a new IG/SC/YT/whatever DOM quirk, write it into `references/platform-gotchas.md` in the same commit that resolves it. The table is the value of this skill.
- **Conflating "connecting…" with `extensionConnected: false`.** They are different failures with different owners — see the doctor status section above.
- **Relying on the per-call ephemeral relay for the extension connection.** A relay that lives only for one CLI invocation races the extension's reconnect interval and usually loses. Keep a persistent relay up (`references/setup.md`, extension mode step 2).
- **Treating an asleep MV3 service worker like a disabled extension (or vice versa).** Both surface as `extensionConnected: false`, but the fix differs — see the doctor status section above.
- **Skipping `doctor` before authenticated multi-step work.** Run doctor once per session. If not `tab_bootstrap_works`, fix the bridge before continuing.
- **Treating `Extension connection replaced` as a page or auth failure.** That means the extension socket reconnected mid-command. Reload the extension; retrying open/snapshot loops before reload just produces flaky evidence.
- **Reaching for bare `dev-browser run` (no `--connect`) to grab a screenshot.** If headless Chromium fails to launch, use the throwaway debug-profile escape hatch (`references/remote-debug-fallback.md`) for anonymous captures; for authenticated work use the extension CLI against the user's real Chrome.
- **Using `waitUntil: "networkidle"` on Clerk/analytics pages.** It never settles; the script hangs to the ~30s sandbox timeout. Use `domcontentloaded` + a fixed `waitForTimeout`.
- **Echoing resolved secret values.** The CLI redacts in output, but copying a `{secure:KEY}` value into a follow-up message or commit leaks it. Treat placeholder resolution as one-way.
- **Storing the avatar/asset in a random path and copying into `~/.dev-browser/tmp/` on every run.** Stage once, keep there, version it next to your source if needed.
- **Using `bypassPermissions` as a default.** It ablates the safety net for *every* tool, not just dev-browser. Scoped allow-rules are the right default; bypass is the escape hatch.
