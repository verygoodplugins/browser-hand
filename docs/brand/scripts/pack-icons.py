#!/usr/bin/env python3
"""Derive extension icons and the transparent mark from locked masters."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / "masters"
DERIVED = ROOT / "derived"
EXT_PUBLIC = ROOT.parent.parent / "extension" / "public" / "icons"

INK = (21, 17, 31)
DOT_ACTIVE = (76, 175, 80, 255)
DOT_RING = (255, 255, 255, 255)


def chroma_to_alpha(src: Image.Image) -> Image.Image:
    """Key near-magenta backdrop; keep bone glove, cyan mist, and spark."""
    rgba = src.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = pixels[x, y]
            magenta = min(r, b) - g
            if min(r, b) > 170 and g < 90 and magenta > 90:
                pixels[x, y] = (r, g, b, 0)
                continue
            if min(r, b) > 140 and g < 130 and magenta > 40:
                t = max(0.0, min(1.0, (magenta - 40) / 90.0))
                alpha = int(255 * (1.0 - t))
                g2 = min(255, g + int(40 * t))
                r2 = max(0, r - int(50 * t))
                b2 = max(0, b - int(20 * t))
                pixels[x, y] = (r2, g2, b2, alpha)
    return rgba.filter(ImageFilter.UnsharpMask(radius=1, percent=40, threshold=2))


def ink_to_alpha(src: Image.Image, threshold: int = 34, feather: int = 28) -> Image.Image:
    """Drop the charcoal void from the dark master; keep glove, mist, cursor."""
    rgba = src.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = pixels[x, y]
            dist = abs(r - INK[0]) + abs(g - INK[1]) + abs(b - INK[2])
            if dist <= threshold:
                pixels[x, y] = (r, g, b, 0)
            elif dist < threshold + feather:
                pixels[x, y] = (r, g, b, int(255 * (dist - threshold) / feather))
    return rgba


def opaque_bbox(im: Image.Image, min_alpha: int = 24) -> tuple[int, int, int, int]:
    px = im.load()
    w, h = im.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] >= min_alpha:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if max_x <= min_x:
        return (0, 0, w, h)
    return (min_x, min_y, max_x + 1, max_y + 1)


# Bone of the glove. The cyan plume is bright enough to pass a luminance
# count, and the inactive smoke is dim. Neither is a solid glove pixel.
SOLID_MIN_ALPHA = 80
SOLID_MIN_LUMA = 118
SOLID_MAX_CHROMA = 36
SOLID_MIN_RUN = 40
ISLAND_MIN_RUN = 6
TRAIL_GAP = 2


def solid_glove_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < SOLID_MIN_ALPHA:
        return False
    if (r + g + b) / 3 < SOLID_MIN_LUMA:
        return False
    if max(r, g, b) - min(r, g, b) > SOLID_MAX_CHROMA:
        return False
    return True


def glove_rows(im: Image.Image) -> list[tuple[int, list[tuple[int, int]]]]:
    """Rows of the solid glove, as inclusive-exclusive x runs.

    A row counts when its longest bone run is the glove. A short island
    in the plume does not count, so it cannot hold the crop open.
    """
    rgba = im.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    found: list[tuple[int, list[tuple[int, int]]]] = []
    for y in range(h):
        spans: list[tuple[int, int]] = []
        start: int | None = None
        for x in range(w + 1):
            bone = x < w and solid_glove_pixel(*px[x, y])
            if bone and start is None:
                start = x
            elif not bone and start is not None:
                spans.append((start, x))
                start = None
        if not spans or max(b - a for a, b in spans) < SOLID_MIN_RUN:
            continue
        kept = [span for span in spans if span[1] - span[0] >= ISLAND_MIN_RUN]
        if kept:
            found.append((y, kept))
    return found


def glove_bbox(im: Image.Image, pad: int = 8) -> tuple[int, int, int, int]:
    """Bounding box of the solid glove, so the crop is not stretched by the trail."""
    rows = glove_rows(im)
    if not rows:
        return opaque_bbox(im)
    xs = [x for _y, spans in rows for a, b in spans for x in (a, b - 1)]
    ys = [y for y, _spans in rows]
    w, h = im.size
    return (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(w, max(xs) + 1 + pad),
        min(h, max(ys) + 1 + pad),
    )


def clear_mist_in_bbox(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Drop the trail that hangs below the glove in each column.

    Fingers reach lower than the wrist, so one horizontal floor keeps the
    plume beside them. The cyan rim on the cuff stays: it sits on the
    solid row, and columns with no glove are left alone.
    """
    last: dict[int, int] = {}
    for y, spans in glove_rows(im):
        for a, b in spans:
            for x in range(a, b):
                last[x] = y
    out = im.copy()
    px = out.load()
    x0, _y0, x1, y1 = box
    for x in range(x0, x1):
        floor = last.get(x)
        if floor is None:
            continue
        for y in range(min(y1, floor + TRAIL_GAP), y1):
            if px[x, y][3] > 8:
                px[x, y] = (0, 0, 0, 0)
    return out


def with_outline(src: Image.Image, width: int) -> Image.Image:
    """Dark silhouette ring so a bone-white mark reads on a light toolbar."""
    if width <= 0:
        return src
    alpha = src.split()[-1]
    dilated = alpha
    for _ in range(width):
        dilated = dilated.filter(ImageFilter.MaxFilter(3))
    ring = Image.new("RGBA", src.size, (*INK, 255))
    ring.putalpha(dilated)
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    out.alpha_composite(ring)
    out.alpha_composite(src)
    return out


def add_status_dot(icon: Image.Image, size: int) -> Image.Image:
    r = max(3, round(size * 0.14))
    ring = max(1, round(size * 0.03))
    cx = size - r - max(1, round(size * 0.02))
    cy = size - r - max(1, round(size * 0.02))
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT_RING)
    draw.ellipse(
        [cx - r + ring, cy - r + ring, cx + r - ring, cy + r - ring],
        fill=DOT_ACTIVE,
    )
    out = icon.copy()
    out.alpha_composite(overlay)
    return out


def transparent_icon(glove: Image.Image, size: int, status_dot: bool) -> Image.Image:
    """Glove fills the square. The status dot is painted on top and may cover it."""
    box = glove_bbox(glove)
    cropped = clear_mist_in_bbox(glove, box).crop(box)
    long_side = max(cropped.width, cropped.height)
    scale = size / long_side
    new_w = max(1, round(cropped.width * scale))
    new_h = max(1, round(cropped.height * scale))
    if cropped.width >= cropped.height:
        new_w = size
    else:
        new_h = size
    fitted = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    outlined = with_outline(fitted, width=1 if size <= 32 else 2)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - outlined.width) // 2
    y = (size - outlined.height) // 2
    canvas.alpha_composite(outlined, (x, y))
    if status_dot:
        canvas = add_status_dot(canvas, size)
    return canvas


def save_png(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", optimize=True)


def main() -> None:
    dark = Image.open(MASTERS / "mark-dark-1024.png")
    chroma = Image.open(MASTERS / "mark-chromakey-1024.png")
    cutout = chroma_to_alpha(chroma)
    save_png(cutout, DERIVED / "mark-transparent-1024.png")
    save_png(cutout.resize((512, 512), Image.Resampling.LANCZOS), DERIVED / "mark-transparent-512.png")

    gloves = {
        "": ink_to_alpha(dark),
        "-inactive": ink_to_alpha(Image.open(MASTERS / "mark-inactive-1024.png")),
    }
    save_png(gloves[""], DERIVED / "mark-glove-only-1024.png")
    save_png(gloves["-inactive"], DERIVED / "mark-glove-only-inactive-1024.png")

    sizes = [16, 32, 48, 128, 256, 512]
    ext_dir = DERIVED / "extension"
    for suffix, glove in gloves.items():
        for size in sizes:
            out = transparent_icon(glove, size, status_dot=(suffix == ""))
            dest = ext_dir / f"icon{suffix}-{size}.png"
            save_png(out, dest)
            if size in {16, 32, 48, 128}:
                public = EXT_PUBLIC / f"icon{suffix}-{size}.png"
                public.parent.mkdir(parents=True, exist_ok=True)
                save_png(out, public)
                print(f"wrote {dest.relative_to(ROOT)} and extension/public/icons/{dest.name}")
            else:
                print(f"wrote {dest.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
