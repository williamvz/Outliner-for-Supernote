"""Draws the toolbar icons (black on transparent) into assets/icons/.

    python3 tools/make_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/icons"
SIZE = 96
INK = (0, 0, 0, 255)
W = 7


def canvas():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def today():
    img, d = canvas()
    d.rectangle([12, 18, 84, 84], outline=INK, width=W)
    d.line([(12, 36), (84, 36)], fill=INK, width=W)
    d.line([(30, 8), (30, 26)], fill=INK, width=W)
    d.line([(66, 8), (66, 26)], fill=INK, width=W)
    d.rectangle([30, 50, 46, 66], fill=INK)
    return img


def sync():
    img, d = canvas()
    d.arc([14, 14, 82, 82], start=200, end=340, fill=INK, width=W)
    d.arc([14, 14, 82, 82], start=20, end=160, fill=INK, width=W)
    d.polygon([(74, 22), (88, 40), (66, 42)], fill=INK)
    d.polygon([(22, 74), (8, 56), (30, 54)], fill=INK)
    return img


def tana():
    img, d = canvas()
    for i, y in enumerate((16, 42, 68)):
        d.rectangle([10, y, 26, y + 16], outline=INK, width=4)
        d.line([(36, y + 8), (86 - i * 12, y + 8)], fill=INK, width=W)
    d.line([(12, 25), (17, 30), (25, 18)], fill=INK, width=4)
    return img


def ping():
    img, d = canvas()
    d.ellipse([14, 14, 82, 82], outline=INK, width=W)
    d.ellipse([38, 38, 58, 58], fill=INK)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, draw in (("today", today), ("sync", sync), ("tana", tana), ("ping", ping)):
        draw().save(OUT / f"{name}.png", optimize=True)
        print(f"wrote assets/icons/{name}.png")
    tana().resize((192, 192)).save(ROOT / "assets/icon.png", optimize=True)
    print("wrote assets/icon.png")


if __name__ == "__main__":
    main()
