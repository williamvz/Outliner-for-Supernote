"""Draws the Today page background template from src/core/layout.json.

The plugin reads strokes against the same numbers, so regenerate the PNG
whenever layout.json changes:

    python3 tools/make_template.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / "src/core/layout.json").read_text())
OUT = ROOT / "assets/templates/tana_today.png"

WHITE = 255
CHECKBOX = 70
ROW_RULE = 200
DIVIDER = 60
RULED = 175
GUIDE = 205


def dotted_vline(draw, x, top, bottom, fill, dash=6, gap=10, w=2):
    y = top
    while y < bottom:
        draw.line([(x, y), (x, min(y + dash, bottom))], fill=fill, width=w)
        y += dash + gap


def main():
    base = SPEC["base"]
    margin = SPEC["margin"]
    header = SPEC["header"]
    tasks = SPEC["tasks"]
    writing = SPEC["writing"]
    left = margin["left"]
    right = base["width"] - margin["right"]

    img = Image.new("L", (base["width"], base["height"]), WHITE)
    draw = ImageDraw.Draw(img)

    draw.line([(left, header["bottom"]), (right, header["bottom"])], fill=ROW_RULE, width=2)

    for i in range(tasks["rows"]):
        top = tasks["top"] + i * tasks["rowHeight"]
        bottom = top + tasks["rowHeight"]
        box_top = top + (tasks["rowHeight"] - tasks["checkboxSize"]) // 2
        draw.rectangle(
            [
                tasks["checkboxLeft"],
                box_top,
                tasks["checkboxLeft"] + tasks["checkboxSize"],
                box_top + tasks["checkboxSize"],
            ],
            outline=CHECKBOX,
            width=3,
        )
        draw.line([(left, bottom), (right, bottom)], fill=ROW_RULE, width=2)

    draw.line([(left, SPEC["divider"]["y"]), (right, SPEC["divider"]["y"])], fill=DIVIDER, width=4)

    zone_top = writing["top"]
    zone_bottom = zone_top + writing["lines"] * writing["lineSpacing"]
    for k in range(1, writing["lines"] + 1):
        y = zone_top + k * writing["lineSpacing"]
        draw.line([(left, y), (right, y)], fill=RULED, width=2)
    for n in range(1, writing["indentGuides"] + 1):
        dotted_vline(draw, left + n * writing["indentStep"], zone_top + 8, zone_bottom, GUIDE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
