"""
ROMulus icon generator v2.
The cartridge body fills the entire canvas — no separate background element.
The canvas background is solid dark navy; macOS/Windows/Linux apply their own
platform rounding on top.  Do NOT use a transparent canvas — transparent icons
composite against white in Finder, DMG windows, and most non-Dock contexts.

Usage:
  python scripts/generate_icon.py
  npx tauri icon src-tauri/icons/app-icon.png
"""

from PIL import Image, ImageDraw, ImageFont
import os

OUT  = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "app-icon.png")
SIZE = 1024

# ── Palette ───────────────────────────────────────────────────────────────────
BODY_TOP    = (30, 36, 62)      # deep indigo-navy (top)
BODY_BOT    = (14, 18, 38)      # darker navy (bottom)
LABEL_BG    = (22, 56, 132)     # vivid NES blue
LABEL_EDGE  = (12, 36, 100)     # label border
RIDGE_COLOR = (48, 56, 88)      # body ridge / divider line
CONN_BG     = (10, 13, 28)      # PCB-dark connector strip
PIN_MAIN    = (215, 178, 82)    # gold pin
PIN_HI      = (255, 228, 140)   # gold pin highlight (left edge glint)
TEXT_WHITE  = (255, 255, 255)
TEXT_GOLD   = (255, 212, 64)
TEXT_DIM    = (155, 188, 255)   # subtitle pale blue

# ── Layout ────────────────────────────────────────────────────────────────────
PAD  = 40    # canvas edge padding (breathing room before macOS rounding)
BRAD = 88    # body corner radius — matches macOS large-icon rounding feel

body_x = PAD
body_y = PAD
body_w = SIZE - 2 * PAD   # 944
body_h = SIZE - 2 * PAD   # 944

# Proportional zones (relative to body)
CONN_H      = int(body_h * 0.175)    # connector strip height
CONN_INSET  = 88                      # connector is narrower than body
conn_y      = body_y + body_h - CONN_H

RIDGE_DIV_H = 8
ridge_div_y = conn_y - RIDGE_DIV_H

LBL_MARGIN  = 52
lbl_x       = body_x + LBL_MARGIN
lbl_y       = body_y + 56
lbl_w       = body_w - 2 * LBL_MARGIN
lbl_h       = ridge_div_y - lbl_y - 22
lbl_r       = 26

# ── Base canvas — solid dark navy background ──────────────────────────────────
# Must be opaque: transparent icons composite against white in Finder / DMG.
# macOS applies its own squircle rounding at display time.
img  = Image.new("RGBA", (SIZE, SIZE), BODY_BOT + (255,))
draw = ImageDraw.Draw(img)

# ── Body gradient — dark navy, top → bottom ───────────────────────────────────
for i in range(body_h + 1):
    t = i / body_h
    r = int(BODY_TOP[0] + (BODY_BOT[0] - BODY_TOP[0]) * t)
    g = int(BODY_TOP[1] + (BODY_BOT[1] - BODY_TOP[1]) * t)
    b = int(BODY_TOP[2] + (BODY_BOT[2] - BODY_TOP[2]) * t)
    draw.line(
        [(body_x, body_y + i), (body_x + body_w, body_y + i)],
        fill=(r, g, b, 255),
    )

# ── Top rib ───────────────────────────────────────────────────────────────────
draw.rectangle(
    [body_x + 16, body_y + 30,
     body_x + body_w - 16, body_y + 36],
    fill=RIDGE_COLOR,
)

# ── Label area ────────────────────────────────────────────────────────────────
draw.rounded_rectangle(
    [lbl_x, lbl_y, lbl_x + lbl_w, lbl_y + lbl_h],
    radius=lbl_r,
    fill=LABEL_BG,
    outline=LABEL_EDGE,
    width=3,
)

# ── Typography ────────────────────────────────────────────────────────────────
FONT_PATHS = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNSDisplay.ttf",
]

def load_font(size):
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

font_rom  = load_font(160)
font_ulus = load_font(160)   # same size — inline wordmark
font_sub  = load_font(34)

lbl_cx = lbl_x + lbl_w // 2
lbl_cy = lbl_y + lbl_h // 2

# Advance widths for accurate inline positioning
rom_adv  = draw.textlength("ROM",  font=font_rom)
ulus_adv = draw.textlength("ulus", font=font_ulus)

# Actual pixel offsets from the draw origin (top=36, bottom=156 at 160pt Helvetica)
rom_bb     = draw.textbbox((0, 0), "ROM", font=font_rom)
pix_top    = rom_bb[1]   # pixels start this many px below the draw y
pix_bottom = rom_bb[3]   # pixels end this many px below the draw y
pix_h      = pix_bottom - pix_top   # visual rendered height

# Center the whole content block (text + gap + rule + gap + subtitle) in the label
SUB_H    = 40    # approximate subtitle height
GAP_RULE = 20    # gap below text to rule
GAP_SUB  = 12    # gap below rule to subtitle
content_h = pix_h + GAP_RULE + 2 + GAP_SUB + SUB_H

# Visual content top is at wordmark_y + pix_top; center it at lbl_cy
wordmark_y = lbl_cy - pix_top - content_h // 2
wordmark_x = lbl_cx - int(rom_adv + ulus_adv) // 2

# "ROM" — white
draw.text((wordmark_x, wordmark_y), "ROM", fill=TEXT_WHITE, font=font_rom)

# "ulus" — gold, flush after "ROM" on same baseline
draw.text((wordmark_x + int(rom_adv), wordmark_y), "ulus", fill=TEXT_GOLD, font=font_ulus)

# Rule: below the actual rendered pixel bottom of the text
rule_y = wordmark_y + pix_bottom + GAP_RULE
draw.rectangle(
    [lbl_x + 50, rule_y, lbl_x + lbl_w - 50, rule_y + 2],
    fill=(255, 255, 255, 50),
)

# "Collection Hub" subtitle
sub_bb = draw.textbbox((0, 0), "Collection Hub", font=font_sub)
sub_w  = sub_bb[2] - sub_bb[0]
draw.text(
    (lbl_cx - sub_w // 2, rule_y + GAP_SUB),
    "Collection Hub",
    fill=TEXT_DIM,
    font=font_sub,
)

# ── Ridge divider (body → connector) ─────────────────────────────────────────
draw.rectangle(
    [body_x, ridge_div_y,
     body_x + body_w, ridge_div_y + RIDGE_DIV_H],
    fill=RIDGE_COLOR,
)

# ── Connector strip ───────────────────────────────────────────────────────────
draw.rectangle(
    [body_x + CONN_INSET, conn_y,
     body_x + body_w - CONN_INSET, body_y + body_h],
    fill=CONN_BG,
)

# ── Gold connector pins ───────────────────────────────────────────────────────
n_pins       = 13
pin_w        = 10
conn_inner_w = body_w - 2 * CONN_INSET
pin_gap      = (conn_inner_w - n_pins * pin_w) // (n_pins + 1)
pin_y0       = conn_y + 16
pin_y1       = body_y + body_h - 16

for i in range(n_pins):
    px = body_x + CONN_INSET + pin_gap + i * (pin_w + pin_gap)
    draw.rectangle([px, pin_y0, px + pin_w, pin_y1], fill=PIN_MAIN)
    draw.rectangle([px, pin_y0, px + 3,     pin_y1], fill=PIN_HI)

img.save(OUT, "PNG")
print(f"Saved: {OUT}  ({SIZE}×{SIZE})")
