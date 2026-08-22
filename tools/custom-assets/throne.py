"""Roni's Developer Throne — a from-scratch pixel-art chair in the v83 style.

Draws the sprite and its 32x32 icon with PIL (no external art), and writes
TypeScript-Client/public/data/custom-items.json: a WZ-style overlay grafted
into Item.wz/Install/0301.img at runtime (see src/CustomWz.ts), so the chair
loads, draws, tooltips and relays exactly like a Nexon chair.

    python3 tools/custom-assets/throne.py
"""
import base64, io, json, os, sys
from PIL import Image, ImageDraw

W, H = 72, 96
OUT = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(OUT)

# Palette (MapleStory-ish: dark outline, two-tone cel shading)
OL   = (38, 22, 18, 255)      # outline
WOOD = (96, 52, 34, 255);  WOOD_L = (132, 78, 50, 255); WOOD_D = (70, 36, 24, 255)
GOLD = (232, 184, 62, 255); GOLD_L = (255, 232, 140, 255); GOLD_D = (160, 112, 28, 255)
VEL  = (150, 22, 40, 255);  VEL_L = (190, 44, 62, 255);  VEL_D = (104, 12, 28, 255)
SCR  = (22, 30, 44, 255);   SCR_L = (60, 190, 120, 255)  # the developer's screen: dark, green code

def rect(x0, y0, x1, y1, fill, outline=OL):
    d.rectangle([x0, y0, x1, y1], fill=fill, outline=outline)

def px(x, y, c):
    if 0 <= x < W and 0 <= y < H: OUT.putpixel((x, y), c)

# --- backrest slab (behind everything) -----------------------------------
rect(16, 8, 55, 62, WOOD)                      # frame
rect(20, 12, 51, 58, VEL)                      # velvet
for y in range(13, 58, 6):                     # velvet tufting highlights
    for x in range(23, 50, 7):
        px(x, y, VEL_L); px(x + 1, y, VEL_L)
for y in range(12, 58):                        # velvet shading: right edge darker
    px(50, y, VEL_D); px(49, y, VEL_D)
# gold inner trim
d.rectangle([19, 11, 52, 59], outline=GOLD)
d.line([(20, 12), (51, 12)], fill=GOLD_L)
# top crown: three points with gold knobs
d.polygon([(16, 8), (24, 0), (32, 8)], fill=GOLD, outline=OL)
d.polygon([(28, 8), (36, -2), (44, 8)], fill=GOLD, outline=OL)
d.polygon([(40, 8), (48, 0), (56, 8)], fill=GOLD, outline=OL)
for (x, y) in [(24, 1), (36, 0), (48, 1)]:
    px(x, y, GOLD_L)
# side finials
rect(13, 6, 18, 12, GOLD); px(15, 7, GOLD_L)
rect(53, 6, 58, 12, GOLD); px(55, 7, GOLD_L)

# --- the monogram: a gold "R" on the backrest ----------------------------
R = ["XXXX.", "X...X", "X...X", "XXXX.", "X..X.", "X...X", "X...X"]
for j, row in enumerate(R):
    for i, ch in enumerate(row):
        if ch == "X":
            px(31 + i, 22 + j, GOLD_L)
            px(31 + i, 23 + j, GOLD_D) if j == 6 else None
# re-draw proper R (two-tone: light with dark shadow one px down-right)
for j, row in enumerate(R):
    for i, ch in enumerate(row):
        if ch == "X":
            px(32 + i, 23 + j, GOLD_D)
for j, row in enumerate(R):
    for i, ch in enumerate(row):
        if ch == "X":
            px(31 + i, 22 + j, GOLD_L)

# --- the developer's touch: a small screen set into the backrest ---------
rect(26, 38, 45, 52, SCR)
for (x0, x1, y) in [(28, 35, 41), (28, 41, 44), (30, 38, 47), (28, 33, 50)]:
    d.line([(x0, y), (x1, y)], fill=SCR_L)
px(43, 41, (255, 230, 90, 255))                # cursor

# --- seat cushion -----------------------------------------------------------
rect(10, 60, 61, 74, VEL)
d.line([(11, 61), (60, 61)], fill=VEL_L)
d.line([(11, 73), (60, 73)], fill=VEL_D)
d.rectangle([10, 60, 61, 74], outline=OL)
d.line([(12, 66), (59, 66)], fill=GOLD)        # gold piping

# --- armrests -----------------------------------------------------------
for x0 in (4, 58):
    rect(x0, 52, x0 + 9, 60, GOLD)             # gold cap
    px(x0 + 2, 53, GOLD_L); px(x0 + 3, 53, GOLD_L)
    rect(x0 + 1, 60, x0 + 8, 74, WOOD)         # post
    px(x0 + 2, 62, WOOD_L)

# --- base / legs ----------------------------------------------------------
rect(8, 74, 63, 82, WOOD)
d.line([(9, 75), (62, 75)], fill=WOOD_L)
for x0 in (9, 28, 47):
    rect(x0, 82, x0 + 14, 94, WOOD_D)
    rect(x0, 92, x0 + 14, 95, GOLD)            # gold feet
    px(x0 + 2, 93, GOLD_L)

os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
here = os.path.dirname(os.path.abspath(__file__))
OUT.save(os.path.join(here, "throne.png"))

# If a hand-made/AI-made sprite is provided (throne_source.png, transparent
# PNG at 1x, feet at the bottom edge, seat ~22px above it), it replaces the
# drawn one. throne_ai_original.png is the untouched source it was cut from.
SRC = os.path.join(here, "throne_source.png")
if os.path.exists(SRC):
    OUT = Image.open(SRC).convert("RGBA")
    W, H = OUT.size
    print("using", SRC, OUT.size)

# icon: the top of the backrest (crown + R) scaled into 32x32, with the
# inventory's 2px drop shadow baked like a Nexon `icon`
if os.path.exists(SRC):
    # the throne's upper centre (crown, backrest, lion heads) as the icon
    cw = int(W * 0.5); cx0 = (W - cw) // 2
    crop = OUT.crop((cx0, 0, cx0 + cw, cw)).resize((32, 32), Image.LANCZOS)
else:
    crop = OUT.crop((8, 0, 64, 56)).resize((32, 32), Image.NEAREST)
icon_raw = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); icon_raw.paste(crop, (0, 0), crop)
icon = Image.new("RGBA", (34, 34), (0, 0, 0, 0))
sh = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
for x in range(32):
    for y in range(32):
        if icon_raw.getpixel((x, y))[3] > 0: sh.putpixel((x, y), (0, 0, 0, 120))
icon.paste(sh, (2, 2), sh); icon.paste(icon_raw, (0, 0), icon_raw)
icon_raw.save(os.path.join(here, "throne_iconRaw.png")); icon.save(os.path.join(here, "throne_icon.png"))

def b64(im):
    buf = io.BytesIO(); im.save(buf, "PNG"); return base64.b64encode(buf.getvalue()).decode()
def canvas(name, im, ox, oy, extra=()):
    node = {"$canvas": name, "width": str(im.width), "height": str(im.height), "basedata": b64(im),
            "$$": [{"$vector": "origin", "x": str(ox), "y": str(oy)}] + list(extra)}
    return node

# --- the maker's cigar and its smoke (drawn at the mouth while seated) ----
CIG = Image.new("RGBA", (11, 4), (0, 0, 0, 0)); cd = ImageDraw.Draw(CIG)
cd.rectangle([0, 0, 8, 3], fill=(112, 66, 38, 255), outline=(52, 30, 18, 255))   # wrapper
cd.line([(1, 1), (7, 1)], fill=(150, 96, 58, 255))                               # highlight
cd.rectangle([2, 0, 3, 3], fill=(200, 160, 80, 255))                             # gold band
cd.rectangle([9, 0, 10, 3], fill=(255, 120, 40, 255)); CIG.putpixel((10, 1), (255, 220, 120, 255))  # ember
CIG.save(os.path.join(here, "cigar.png"))
SMOKE = []
for i, r in enumerate((3, 5, 7, 9)):
    sz = r * 2 + 2; im = Image.new("RGBA", (sz, sz), (0, 0, 0, 0)); sd = ImageDraw.Draw(im)
    a = (200, 160, 120, 80)[i]
    sd.ellipse([1, 1, sz - 2, sz - 2], fill=(236, 236, 240, a))
    sd.ellipse([r // 2 + 1, r // 2 + 1, r + 2, r + 2], fill=(255, 255, 255, min(255, a + 40)))
    SMOKE.append(im); im.save(os.path.join(here, f"smoke{i}.png"))

ITEM_ID = 3019999
overlay = {
    "_comment": "Custom items grafted into the WZ tree at load (src/CustomWz.ts). Generated by tools/custom-assets/throne.py — edit the script, not this file.",
    "wz": {
        "Item.wz/Install/0301.img": [
            {"$imgdir": f"{ITEM_ID:08d}", "$$": [
                {"$imgdir": "info", "$$": [
                    canvas("icon", icon, -1, 34), canvas("iconRaw", icon_raw, -1, 32),
                    {"$int": "price", "value": "1"}, {"$int": "slotMax", "value": "1"},
                    {"$int": "recoveryHP", "value": "500"}, {"$int": "recoveryMP", "value": "500"},
                    {"$int": "tradeBlock", "value": "1"}, {"$int": "notSale", "value": "1"},
                    {"$int": "cash", "value": "0"}, {"$int": "devOnly", "value": "1"},
                ]},
                {"$imgdir": "effect", "$$": [canvas("0", OUT, W // 2, H)]},
            ]},
        ],
    },
    "fx": {
        "cigar": canvas("cigar", CIG, 0, 2),
        "smoke": [canvas(str(i), im, im.width // 2, im.height // 2) for i, im in enumerate(SMOKE)],
    },
    "names": {
        str(ITEM_ID): {
            "name": "Roni's Developer Throne",
            "desc": "The seat the world was built from. Crimson velvet, gold, a screen still scrolling code.\\n#cOnly its maker may sit here.#",
        },
    },
}
root = os.path.abspath(os.path.join(here, "..", ".."))
dst = os.path.join(root, "TypeScript-Client", "public", "data", "custom-items.json")
with open(dst, "w") as f:
    json.dump(overlay, f)
print("wrote", dst, os.path.getsize(dst), "bytes")
# preview sheet at 3x for a look
prev = Image.new("RGBA", (W * 3 + 120, H * 3), (120, 160, 200, 255))
prev.paste(OUT.resize((W * 3, H * 3), Image.NEAREST), (0, 0), OUT.resize((W * 3, H * 3), Image.NEAREST))
prev.paste(icon.resize((102, 102), Image.NEAREST), (W * 3 + 10, 10), icon.resize((102, 102), Image.NEAREST))
prev.save(os.path.join(here, "throne_preview.png"))
