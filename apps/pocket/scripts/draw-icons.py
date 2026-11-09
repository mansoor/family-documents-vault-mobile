"""The app's icon and splash (P10), drawn from the vault's own mark.

The shield is the web's Logo (apps/web/src/ui.tsx in the vault): the path
"M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6z" on a 24-unit grid,
stroked with round ends and joins. The colours are the shared tokens': the
accent and the page, light and dark (packages/shared/src/tokens.ts).

    python apps/pocket/scripts/draw-icons.py

writes apps/pocket/assets/. Needs Pillow; nothing in the build runs it.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / 'assets'

ACCENT = '#1F5D4C'
ACCENT_DARK = '#6DB89E'
WHITE = '#FFFFFF'

# Drawn this many times larger, then shrunk: smooth edges.
SS = 4


def cubic(p0, p1, p2, p3, steps=48):
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        pts.append((
            u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
            u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
        ))
    return pts


def shield():
    """The Logo's path as points on its 24-unit grid, closed."""
    pts = [(12, 3), (4, 6), (4, 12)]
    pts += cubic((4, 12), (4, 16.4), (7.4, 20.3), (12, 21))
    pts += cubic((12, 21), (16.6, 20.3), (20, 16.4), (20, 12))
    pts += [(20, 6), (12, 3)]
    return pts


def draw(size, colour, background=None, height=0.56, stroke=2.0):
    """The shield `height` of the canvas tall, centred, its line `stroke` grid units wide."""
    big = size * SS
    img = Image.new('RGBA', (big, big), background or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    scale = big * height / 18  # the shield is 18 units tall (3 to 21)
    width = stroke * scale
    pts = [((x - 12) * scale + big / 2, (y - 12) * scale + big / 2) for x, y in shield()]
    d.line(pts, fill=colour, width=round(width), joint='curve')
    # Round ends and corners: a dot of the line's width at every point.
    r = width / 2
    for x, y in pts:
        d.ellipse((x - r, y - r, x + r, y + r), fill=colour)
    return img.resize((size, size), Image.LANCZOS)


def main():
    # The icon the store and iOS use: white on the accent, no transparency.
    draw(1024, WHITE, ACCENT).convert('RGB').save(ASSETS / 'icon.png')
    # Android's adaptive icon: the shield inside the 66% the launcher may show,
    # on the accent; and alone for a themed (monochrome) icon.
    draw(512, WHITE, height=0.40).save(ASSETS / 'android-icon-foreground.png')
    Image.new('RGB', (512, 512), ACCENT).save(ASSETS / 'android-icon-background.png')
    draw(512, WHITE, height=0.40).save(ASSETS / 'android-icon-monochrome.png')
    # The splash: the shield in the accent on the page's colour, light and dark.
    draw(1024, ACCENT, height=0.80, stroke=1.8).save(ASSETS / 'splash-icon.png')
    draw(1024, ACCENT_DARK, height=0.80, stroke=1.8).save(ASSETS / 'splash-icon-dark.png')
    # The web build's tab.
    draw(48, WHITE, ACCENT, height=0.62, stroke=2.4).convert('RGB').save(ASSETS / 'favicon.png')


if __name__ == '__main__':
    main()
