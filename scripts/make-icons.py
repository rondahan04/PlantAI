"""
Turn the two supplied 1024x1024 icons into the asset set Expo actually wants.

Both sources are full-bleed art with rounded corners baked in and an alpha
channel. That is wrong for both platforms in different ways:

  iOS      applies its own corner mask, so pre-rounded art is masked twice and
           shows a teal crescent in each corner. App Store review also rejects
           any icon carrying an alpha channel.
  Android  adaptive icons crop a 108dp canvas to an OEM shape; only the centre
           ~66% survives on every device. Full-bleed art loses its edges.

Fix: recover the background gradient by fitting a plane to the pixels that are
opaque, extend it across the whole square (killing the corners and the alpha),
and for Android split the artwork into a foreground (leaf, inside the safe
zone) over a background (the gradient).
"""

import numpy as np
from PIL import Image

SRC_IOS = 'assets/icon-source/Plantin_iOS_App_Icon.png'
SRC_AND = 'assets/icon-source/Plantin_Android_App_Icon_png.png'
OUT = 'assets/'
SIZE = 1024

# Fraction of the adaptive canvas the artwork may occupy. Android guarantees
# the centre 66% is never cropped; 60% leaves margin for the more aggressive
# OEM masks without making the leaf look lost.
SAFE = 0.60


def fit_gradient(img):
    """Least-squares fit colour = a + b*x + c*y over the opaque pixels.

    The backgrounds are linear diagonal gradients, so three coefficients per
    channel reproduce them almost exactly - and unlike sampling a single
    colour, extending the fit into the transparent corners is seamless.
    """
    arr = np.asarray(img, dtype=np.float64)
    h, w = arr.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    opaque = arr[:, :, 3] > 250

    # Ignore the white leaf: it is artwork, not background, and would drag the
    # fit towards white. The background is the saturated teal.
    rgb = arr[:, :, :3]
    is_teal = (rgb[:, :, 1] > rgb[:, :, 0] + 20) & (rgb[:, :, 2] > rgb[:, :, 0] + 20)
    mask = opaque & is_teal

    A = np.stack([np.ones(mask.sum()), xs[mask], ys[mask]], axis=1)
    coeffs = [np.linalg.lstsq(A, arr[:, :, c][mask], rcond=None)[0] for c in range(3)]

    ys_f, xs_f = np.mgrid[0:SIZE, 0:SIZE]
    planes = [c[0] + c[1] * xs_f + c[2] * ys_f for c in coeffs]
    out = np.clip(np.stack(planes, axis=2), 0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGB')


def flatten(src, background):
    """Composite the art onto the extended gradient, dropping alpha."""
    out = background.copy()
    out.paste(src, (0, 0), src)
    return out.convert('RGB')


def leaf_mask(img):
    """Alpha mask of the white artwork only."""
    arr = np.asarray(img, dtype=np.int16)
    rgb, a = arr[:, :, :3], arr[:, :, 3]
    # The leaf is near-white and desaturated; the background is saturated teal.
    whiteness = rgb.min(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    m = (whiteness > 170) & (sat < 60) & (a > 128)
    return Image.fromarray((m * 255).astype(np.uint8), 'L')


def bbox_of(mask):
    a = np.asarray(mask) > 127
    ys, xs = np.where(a)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def build_foreground(mask, colour):
    """Leaf, scaled into the adaptive safe zone, centred on transparency."""
    x0, y0, x1, y1 = bbox_of(mask)
    art = mask.crop((x0, y0, x1, y1))

    target = int(SIZE * SAFE)
    scale = min(target / art.width, target / art.height)
    art = art.resize((max(1, int(art.width * scale)), max(1, int(art.height * scale))),
                     Image.LANCZOS)

    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    solid = Image.new('RGBA', art.size, colour)
    canvas.paste(solid, ((SIZE - art.width) // 2, (SIZE - art.height) // 2), art)
    return canvas


src_ios = Image.open(SRC_IOS).convert('RGBA')
src_and = Image.open(SRC_AND).convert('RGBA')

# ── iOS: square, opaque, no baked corners ────────────────────────────────────
grad_ios = fit_gradient(src_ios)
ios_icon = flatten(src_ios, grad_ios)
ios_icon.save(OUT + 'icon.png')

# ── Android adaptive: foreground + background + monochrome ───────────────────
grad_and = fit_gradient(src_and)
grad_and.save(OUT + 'android-icon-background.png')

mask = leaf_mask(src_and)
build_foreground(mask, (255, 255, 255, 255)).save(OUT + 'android-icon-foreground.png')
# Monochrome (themed icons, Android 13+): the silhouette only. The system
# recolours it, so the fill colour is irrelevant - the alpha is the icon.
build_foreground(mask, (0, 0, 0, 255)).save(OUT + 'android-icon-monochrome.png')

# ── Web favicon ──────────────────────────────────────────────────────────────
ios_icon.resize((48, 48), Image.LANCZOS).save(OUT + 'favicon.png')

# Report the corner colour so app.json's backgroundColor can match the gradient
# instead of the old navy that no longer relates to the artwork.
px = np.asarray(grad_and)
print('gradient corners TL/BR:', tuple(px[2, 2]), tuple(px[-3, -3]))
print('gradient centre:', tuple(px[SIZE // 2, SIZE // 2]))
print('leaf bbox in source:', bbox_of(mask))
