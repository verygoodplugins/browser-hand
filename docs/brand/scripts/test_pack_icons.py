"""The toolbar crop is the solid glove, not the bright wrist trail."""

import importlib.util
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).with_name("pack-icons.py")
spec = importlib.util.spec_from_file_location("pack_icons", SCRIPT)
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


def _blank() -> Image.Image:
    return Image.new("RGBA", (200, 220), (0, 0, 0, 0))


def _fill(im: Image.Image, box, color) -> None:
    px = im.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            px[x, y] = color


def test_bright_plume_does_not_stretch_the_crop():
    im = _blank()
    bone = (230, 228, 220, 255)
    _fill(im, (30, 40, 170, 120), bone)
    # Finger reaches below the wrist. The plume beside it is bright cyan.
    _fill(im, (110, 120, 165, 150), bone)
    _fill(im, (40, 120, 100, 210), (90, 210, 235, 255))
    im.putpixel((60, 180), bone)

    box = pack.glove_bbox(im, pad=0)
    assert box[1] == 40
    assert box[3] == 150

    cleared = pack.clear_mist_in_bbox(im, box)
    assert cleared.getpixel((80, 80))[3] == 255
    assert cleared.getpixel((130, 140))[3] == 255
    assert cleared.getpixel((50, 140))[3] == 0
    assert box[3] < 180


def test_dim_smoke_beside_a_finger_is_cleared():
    im = _blank()
    bone = (210, 208, 200, 255)
    _fill(im, (30, 40, 170, 120), bone)
    _fill(im, (110, 120, 165, 150), bone)
    _fill(im, (40, 120, 100, 200), (70, 70, 72, 255))

    box = pack.glove_bbox(im, pad=0)
    assert box[3] == 150
    cleared = pack.clear_mist_in_bbox(im, box)
    assert cleared.getpixel((50, 140))[3] == 0
    assert cleared.getpixel((130, 140))[3] == 255


def test_cuff_rim_on_the_solid_row_stays():
    im = _blank()
    bone = (230, 228, 220, 255)
    _fill(im, (40, 40, 160, 140), bone)
    # Cyan rim on the same rows as the glove, not a trail below it.
    _fill(im, (20, 40, 40, 140), (80, 190, 220, 255))

    box = pack.glove_bbox(im, pad=8)
    cleared = pack.clear_mist_in_bbox(im, box)
    assert cleared.getpixel((35, 80))[3] == 255
    assert cleared.getpixel((80, 80))[3] == 255
