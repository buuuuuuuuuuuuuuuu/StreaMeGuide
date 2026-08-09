from PIL import Image, ImageDraw
import os

# Sorbet-Palette (identisch zum App-Design)
INK      = (36, 17, 70, 255)
PAPER    = (244, 240, 255, 255)
WHITE    = (255, 255, 255, 255)
MINT     = (140, 232, 199, 255)
LAVENDER = (195, 180, 255, 255)
BUBBLE   = (255, 159, 203, 255)
BUTTER   = (255, 224, 102, 255)
SKY      = (159, 214, 255, 255)
PEACH    = (255, 176, 160, 255)

SS = 4  # Supersampling-Faktor

def new_canvas(S):
    return Image.new("RGBA", (S, S), (0, 0, 0, 0))

def bg(img, S, color=PAPER, radius=0.225):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=color)
    return img

def paste_rot(base, layer, angle, center):
    """Layer um ihren Mittelpunkt drehen und auf base setzen."""
    rot = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    x = int(center[0] - rot.width / 2)
    y = int(center[1] - rot.height / 2)
    base.alpha_composite(rot, (x, y))


# ---------------------------------------------------------------
# Variante A — "Der Stapel"
# Drei aufgefächerte Sticker-Karten. Greift das Signature-Element
# der App auf (gestapelte Empfehlungskarten).
# ---------------------------------------------------------------
def variant_stack(S):
    img = new_canvas(S)
    bg(img, S, PAPER)
    lw = int(S * 0.030)

    cards = [
        (BUBBLE, -14, (0.44, 0.55)),
        (SKY,     -1, (0.50, 0.51)),
        (BUTTER,  12, (0.56, 0.47)),
    ]
    w, h = int(S * 0.46), int(S * 0.58)

    for color, angle, (cx, cy) in cards:
        pad = lw * 2
        layer = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle(
            [pad, pad, pad + w, pad + h],
            radius=int(S * 0.075), fill=color, outline=INK, width=lw
        )
        paste_rot(img, layer, angle, (S * cx, S * cy))

    # Play-Dreieck auf der vordersten Karte
    d = ImageDraw.Draw(img)
    cx, cy = S * 0.575, S * 0.465
    r = S * 0.105
    tri = [
        (cx - r * 0.62, cy - r * 0.92),
        (cx - r * 0.62, cy + r * 0.92),
        (cx + r * 0.95, cy),
    ]
    d.polygon(tri, fill=INK)
    return img


# ---------------------------------------------------------------
# Variante B — "Play-Blob"
# Organische Blob-Form mit kräftigem Play-Zeichen. Reduziert,
# funktioniert auch bei sehr kleiner Darstellung.
# ---------------------------------------------------------------
def variant_blob(S):
    img = new_canvas(S)
    bg(img, S, LAVENDER)
    lw = int(S * 0.036)

    # Marken-Blob: drei runde Ecken, eine spitz — exakt die Form des
    # Logo-Punkts in der App (border-radius: 50% 50% 50% 12px).
    m = S * 0.155
    box = [m, m, S - m, S - m]
    r = int((S - 2 * m) / 2)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle(box, radius=r, fill=BUTTER, outline=INK, width=lw,
                         corners=(True, True, True, False))
    paste_rot(img, layer, -8, (S * 0.5, S * 0.5))

    # Play-Dreieck, leicht aus der Mitte für Spannung
    d = ImageDraw.Draw(img)
    cx, cy = S * 0.525, S * 0.485
    t = S * 0.155
    d.polygon([
        (cx - t * 0.58, cy - t),
        (cx - t * 0.58, cy + t),
        (cx + t * 0.90, cy),
    ], fill=INK)

    # zwei Sorbet-Punkte als Gegengewicht
    for (px, py, col, rad) in [(0.215, 0.225, BUBBLE, 0.055),
                               (0.800, 0.790, MINT, 0.042)]:
        rr = S * rad
        d.ellipse([S * px - rr, S * py - rr, S * px + rr, S * py + rr],
                  fill=col, outline=INK, width=int(lw * 0.85))
    return img


# ---------------------------------------------------------------
# Variante C — "Sorbet-Trio"
# Drei Kugeln = die drei Quellen (Netflix, Prime, Mediathek).
# Am nächsten an der Designsprache, am verspieltesten.
# ---------------------------------------------------------------
def variant_scoops(S):
    img = new_canvas(S)
    bg(img, S, WHITE)
    lw = int(S * 0.033)

    # Kugeln zuerst (hintere unten), damit die Schale davor sitzt
    d = ImageDraw.Draw(img)
    scoops = [
        (0.320, 0.455, 0.150, SKY),
        (0.680, 0.455, 0.150, BUBBLE),
        (0.500, 0.335, 0.170, MINT),
    ]
    for cx, cy, rr, col in scoops:
        d.ellipse([S * (cx - rr), S * (cy - rr), S * (cx + rr), S * (cy + rr)],
                  fill=col, outline=INK, width=lw)

    # Becher: nach unten verjüngt, wirkt weniger kastig als ein Rechteck
    top_y, bot_y = S * 0.565, S * 0.860
    cup = [
        (S * 0.225, top_y),
        (S * 0.775, top_y),
        (S * 0.665, bot_y),
        (S * 0.335, bot_y),
    ]
    d.polygon(cup, fill=PAPER)
    d.line(cup + [cup[0]], fill=INK, width=lw, joint="curve")

    # Rand als eigene Kante, damit die Kugeln sauber abschließen
    d.line([S * 0.225, top_y, S * 0.775, top_y], fill=INK, width=lw)

    # Play-Dreieck in der oberen Kugel
    cx, cy = S * 0.500, S * 0.335
    t = S * 0.085
    d.polygon([
        (cx - t * 0.58, cy - t * 0.95),
        (cx - t * 0.58, cy + t * 0.95),
        (cx + t * 0.90, cy),
    ], fill=INK)
    return img


VARIANTS = {
    "a-stapel": variant_stack,
    "b-blob": variant_blob,
    "c-sorbet": variant_scoops,
}

os.makedirs("/home/claude/icons/out", exist_ok=True)

for name, fn in VARIANTS.items():
    big = fn(512 * SS)
    for size in (512, 192):
        out = big.resize((size, size), Image.LANCZOS)
        out.convert("RGB").save(f"/home/claude/icons/out/{name}-{size}.png")
    # Vorschau-Kachel
    big.resize((360, 360), Image.LANCZOS).convert("RGB").save(
        f"/home/claude/icons/out/preview-{name}.png"
    )
    print("gebaut:", name)
