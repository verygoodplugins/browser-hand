# Setup and prerequisites

One-time and per-machine setup for both paths of dev-browser. Read the section for the path you're using; skip the other.

## Both paths

- Chrome running locally with the user's normal profile (cookies, logins, open tabs).
- Browser Hand monorepo (`browser-hand`) with `path-a/`, `relay/`, and `extension/`.

## Path A — extension relay

1. **`dev-browser-mcp` on PATH.** Install once:
   ```bash
   brew install dev-browser-mcp  # or: npm install -g @browser-hand/relay (or legacy dev-browser-mcp)
   ```
   Verify: `which browser-hand-relay || ls relay/dist/standalone.js` resolves.
2. **A persistent relay on `:9333`.** Each CLI call *can* spawn an ephemeral
   relay, but it dies when the call exits — and the Chrome extension reconnects
   on its own interval, so it keeps missing that brief window and sits on
   "connecting…" forever. The relay must outlive any single call. It binds
   `:9333` (NOT `:9222` — Chrome's own `--remote-debugging-port` owns that; bare
   `dev-browser-mcp` defaults to 9222 and will `EADDRINUSE`).

   **On this machine the relay is a launchd LaunchAgent** (`RunAtLoad` +
   `KeepAlive`, so it starts at login and respawns within ~1s if it dies; the
   extension auto-reconnects ~2s later):
   - Label: `com.browser-hand.relay`
   - Launcher (resolves nvm node, then `exec`s `dev-browser-mcp` with `PORT=9333`):
     `~/.dev-browser/relay-launchd.sh`
   - Plist: `~/Library/LaunchAgents/com.browser-hand.relay.plist`
   - Logs: `~/.dev-browser/relay-9333.{out,err}`
   - Manage: `launchctl kickstart -k gui/$(id -u)/com.browser-hand.relay`
     to force-restart; `launchctl print gui/$(id -u)/com.browser-hand.relay`
     for status. Do NOT start a competing `browser-hand relay` while the agent
     owns `:9333` — kickstart the agent instead.

   If the LaunchAgent is somehow gone, the manual fallback is idempotent (exits
   0 if a relay is already up):
   ```bash
   node path-a/src/cli.js relay   # foreground; Ctrl-C to stop
   # or background it: ... relay &
   ```
3. **Chrome extension enabled, pointed at the relay.** Run doctor first and branch on the result:
   ```bash
   node path-a/src/cli.js doctor
   ```
   The command checks the relay, extension socket, named-page registry,
   `Target.getTargets`, and a create/close smoke tab. Use its `status` +
   `action` as authoritative — see `references/troubleshooting.md` for what
   each status (`relay_down`, `extension_asleep`, `extension_disconnected`,
   `target_registry_empty`, `extension_unstable`, `tab_bootstrap_works`) means
   and how to fix it. Only `tab_bootstrap_works` means Path A is healthy;
   everything else is a blocker to resolve before dispatching browser work.
4. **Bash allow-rule** (project-scoped `.claude/settings.local.json`):
   ```json
   { "permissions": { "allow": ["Bash(node */path-a/src/cli.js:*)"] } }
   ```

## Path B — `--connect` headless

1. **`dev-browser` CLI on PATH** (`which dev-browser` resolves).
2. **Chrome started with `--remote-debugging-port=9222`.** Verify with the primary health check:
   ```bash
   dev-browser --connect http://127.0.0.1:9222 run /dev/stdin <<'EOF'
   const tabs = await browser.listPages();
   console.log(JSON.stringify({ ok: true, tab_count: tabs.length }, null, 2));
   EOF
   ```
   Raw CDP HTTP endpoints (`/json`, `/json/version`) may return 404 on newer Chrome builds even when the websocket attach path works. Treat the `dev-browser --connect ... run /dev/stdin` probe as the canonical health check.

   **Chrome 136+ refuses `--remote-debugging-port` on the default profile —
   `--user-data-dir` (non-default) is mandatory.** Since Chrome 136 (this
   machine runs 148) the remote-debugging switches are *silently ignored*
   unless you also pass `--user-data-dir` pointing at a NON-default directory;
   the launch otherwise logs `DevTools remote debugging requires a non-default
   data directory` and no port opens. This is a deliberate security change to
   stop cookie-stealers attaching over CDP to your live profile (official:
   developer.chrome.com/blog/remote-debugging-port). **Consequences that change
   how Path B is used:**
   - The debug Chrome runs an *isolated* profile with NONE of your logins, so
     **Path B cannot drive your real authenticated default-profile Chrome** —
     that is Path A's job. For Path B work that needs auth, log into the target
     platform once in the dedicated profile below (it persists across launches,
     so it is a one-time cost).
   - No flag and no enterprise policy re-opens the port on the default profile
     (`RemoteDebuggingAllowed` does *not* override it). Only Chrome for Testing
     still honors the old behavior, and it is a separate binary with its own
     empty profile.
   - macOS single-instance: if Chrome is already running, a launch flag is
     ignored (it just opens a window in the live process). Fully quit Chrome
     before launching the debug instance.

   **`--remote-allow-origins` is also required on modern Chrome (M111+).**
   `--connect` attaches at the browser level (`connectOverCDP`), and modern
   Chrome rejects that WebSocket handshake unless the launch flags allow the
   origin. Symptom: `--connect` hangs and times out even though
   `--remote-debugging-port` is listening and `/json/version` answers.

   Launch with all three (quit Chrome first):
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222 \
     --remote-allow-origins=http://127.0.0.1:9222 \
     --user-data-dir="$HOME/.dev-browser/chrome-pathb"   # non-default ⇒ M136-compliant; log in once
   ```
   Prefer the specific origin over the `*` wildcard. If you do use the
   wildcard, **quote it** — `"--remote-allow-origins=*"` — because zsh expands a
   bare `*` as a glob and the command dies with `no matches found`.
3. **Bash allow-rules** (project-scoped `.claude/settings.local.json`):
   ```json
   {
     "permissions": {
       "allow": [
         "Bash(dev-browser run:*)",
         "Bash(dev-browser:*)",
         "Bash(curl http://127.0.0.1:*)",
         "Bash(curl http://localhost:*)"
       ]
     }
   }
   ```
   Restart Claude Code after writing settings — permission changes load at session start.
