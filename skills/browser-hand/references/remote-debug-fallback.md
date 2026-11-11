# Headless and remote-debug fallback

Use this only when you need a **disposable** browser or CI — anonymous captures, not the user’s everyday logged-in browser.

For real sessions, use the extension CLI (`extension-cli.md`).

## Why this is the fallback

- Chrome **136+** ignores `--remote-debugging-port` on the **default** profile unless you also set a **non-default** `--user-data-dir`.
- Many sites (including **Google OAuth**) block or challenge debugger/automation-shaped browsers.
- You will re-login every service on that isolated profile.

## Headless (upstream CLI)

```bash
dev-browser install
dev-browser --headless <<'EOF'
const page = await browser.getPage("main");
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
console.log(await page.title());
EOF
```

## Connect to a dedicated debug profile

Quit the connected browser fully first (macOS single-instance ignores flags otherwise). Then launch the executable `browser-hand browser-path` prints, with a user-data directory that is not the everyday profile:

```bash
EXE="$(browser-hand browser-path | node -e 'let raw="";process.stdin.on("data",(c)=>raw+=c);process.stdin.on("end",()=>{process.stdout.write(JSON.parse(raw).executablePath)})')"
"$EXE" \
  --remote-debugging-port=9222 \
  --remote-allow-origins=http://127.0.0.1:9222 \
  --user-data-dir="$HOME/.browser-hand/debug-profile"
```

```bash
dev-browser --connect http://127.0.0.1:9222 <<'EOF'
const tabs = await browser.listPages();
console.log(JSON.stringify(tabs, null, 2));
EOF
```

Log into sites **once** in that profile if you need auth; do not expect it to share cookies with the everyday browser. The everyday profile still does not get a debugging port.

## When agents may use this

- Unauthenticated scrapes in a clean browser  
- File-upload / multi-step scripts that require the sandboxed Playwright API  
- CI  

Do **not** use it as a substitute for “drive the tab I’m looking at.”
