---
name: dev-browser
description: Sandboxed throwaway-Chromium scripting via the upstream `dev-browser` CLI. Use ONLY for unauthenticated QA in a clean browser profile. For anything touching the user's real Chrome — the active tab, signed-in pages, filling forms, clicking, screenshotting "this page" — use the `browser-hand` skill instead.
---

# Dev Browser (upstream headless line)

A CLI for controlling a sandboxed, throwaway browser with JavaScript scripts.

This is **not** the skill for driving the user's own browser. Browser Hand's
extension relay does that — it keeps the user's session and cookies and does not
trigger Chrome's WebDriver banner. Reach for `browser-hand` first, and drop to
this only when a clean, unauthenticated profile is specifically what you want.

## Installation

```bash
npm install -g dev-browser
dev-browser install
```

## Usage

Run `dev-browser --help` to learn more.

Named daemon-launched browsers persist by default. For unattended work, `--idle-timeout 5m` closes each launched browser after inactivity while preserving its profile and login state. The setting never closes Chrome attached with `--connect`; use `--idle-timeout 0` to disable configured cleanup.
