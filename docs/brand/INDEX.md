# Browser Hand brand pack

Locked 2026-08-25 from option **A** (low-poly ghost glove) plus wrist mist stolen from the parked photoreal take. Product name stays **Browser Hand**. Informal: *the glove*. No character name, no face.

| Piece | Call |
|---|---|
| Mark | Puffy four-digit cartoon glove (3 fingers + thumb), three stitch dashes, cyan spark at the fingertip |
| Wrist | Soft cyan mist dissolving from the cuff — ghost, not luxury CGI smoke |
| Hero | Glove in a dark void, reaching to click |
| Palette | Bone white, ink `#0B0A12` / `#15111F`, cyan spark `#7EE7FF`. No Google-blue. No Mario-red. No leftover teal **D** |
| Type | CLI `browser-hand`. Display **Browser Hand** |
| Voice | Quiet, precise, a little uncanny |
| IS NOT | Robot claw, pointing emoji, photoreal leather butler glove, kawaii face, Nintendo/Mario likeness |

Inspired by SM64 cartoon gloves. Not Mario, not Boo, not a Nintendo asset.

## Where each file goes

| Surface | File | Size |
|---|---|---|
| Chrome toolbar (active) | `extension/public/icons/icon-{16,32,48,128}.png` | glove on full alpha, green status dot |
| Chrome toolbar (inactive) | `extension/public/icons/icon-inactive-{16,32,48,128}.png` | same, quiet glove, no dot |
| Popup | toggle + Active/Inactive + connection line + focus dropdown | |
| GitHub repo page (README hero) | `derived/github-social-1280x640.png` | 1280×640 |
| GitHub **Settings → Social preview** (link unfurls) | same 1280×640 file | 1280×640 |
| Open Graph / Slack / iMessage | `derived/og-1200x630.png` | 1200×630 |
| README / docs mark on light or dark | `derived/mark-transparent-512.png` (or 1024) | alpha PNG |
| Future / retina | `derived/extension/icon-{256,512}.png` | 256 / 512 |

Toolbar icons follow the Evernote pattern: **PNG with full transparency**, no circular plate, mark filling the square (their elephant is ~84% wide and edge-to-edge tall; corners are `(0,0,0,0)`). Chrome squircle-masks the canvas; the toolbar shows through the alpha. A thin ink outline keeps the bone-white glove readable on a light bar. Active status is a **green dot on the icon** — Chrome badges cannot be a circle.

Not selling, so no Chrome Web Store promo tiles (440×280 / 1400×560). Re-derive from masters if that ever changes.

## Masters

Editable HTML for the banners lives in `src/`. Raster masters:

- `masters/mark-dark-1024.png` — canonical square; source for the **active** toolbar icon
- `masters/mark-inactive-1024.png` — same glove at rest; source for the **inactive** toolbar icon
- `masters/mark-chromakey-1024.png` — magenta plate; source for the transparent cutout
- `masters/banner-scene.png` — wide glove + mist, type-free
- `masters/icon-1024.png` — squircle app icon (marketing only)

Re-pack icons:

```bash
python3 -m venv /tmp/brand-pack && /tmp/brand-pack/bin/pip install pillow
/tmp/brand-pack/bin/python docs/brand/scripts/pack-icons.py
```

Re-render banners:

```bash
node ~/.autovault/skills/html-asset-renderer/scripts/render-html-assets.mjs \
  docs/brand/src docs/brand/derived \
  --manifest docs/brand/src/assets.manifest.json \
  --selector .canvas
```

After changing `extension/public/icons/`, rebuild and reload the unpacked extension (`extension/dist/chrome-mv3`).

A global `Icon?` gitignore (meant for macOS `Icon\r` files) also matches `icons/` on case-insensitive volumes. Force-add toolbar PNGs with `git add -f extension/public/icons/`.
