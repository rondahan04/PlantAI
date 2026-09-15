/*
 * Which part of a plant's photo to show, and how close in.
 *
 * Every surface used to render the photo with `contentFit="cover"`, which
 * fills the box and centres what it cannot fit. That is the right default and
 * the wrong answer for a photo taken one-handed over a shelf: the plant sits
 * low in the frame, the thumb holding the leaf sits high, and the centre crop
 * keeps the thumb. The user could see the plant fine when they took the
 * picture, so the card looks like the app chose the worst possible crop.
 *
 * So the framing is a stored fact about the plant, not a property of any one
 * screen. Two numbers:
 *
 *   `focusY`  which point down the IMAGE sits at the centre of the frame,
 *             0 the top edge, 1 the bottom.
 *   `zoom`    a multiplier on the COVER fit. 1 exactly fills the frame and is
 *             what the app always did; above 1 crops tighter; below 1 shrinks
 *             the picture until the whole of it is visible inside the frame.
 *
 * BOTH ARE RELATIVE, which is the property that makes one saved value correct
 * on a 56pt square card, a full-width hero and the edit sheet at once. A pixel
 * offset would mean something different on each.
 *
 * NON-DESTRUCTIVE, deliberately. The photograph is never re-encoded, so the
 * framing can be changed again next week at no cost and with no loss - unlike
 * an actual crop, which throws away pixels the user may want back and degrades
 * a little more on every adjustment.
 *
 * Horizontal is always centred: the request was up and down, and a second axis
 * is a second stored value and a second way for a drag to go wrong.
 *
 * Pure - no react-native import - so `node --test` covers the geometry, which
 * is the part worth covering.
 */

/* What `cover` did on its own, and what every plant saved before this had. */
export const DEFAULT_FOCUS_Y = 0.5;
export const DEFAULT_ZOOM = 1;

/*
 * Far enough out to show the whole of any ordinary photograph inside any of
 * the app's frames, and far enough in to pull one leaf out of a shelf shot.
 */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/*
 * Two decimals. A drag produces a float with fifteen of them; storing that
 * writes a new value for every pixel of travel and fills the column with
 * precision nobody aimed for. A hundredth is already finer than a fingertip.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function clampFocusY(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FOCUS_Y;
  return round2(Math.min(1, Math.max(0, value)));
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  return round2(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
}

/*
 * The stored values, made safe to render.
 *
 * They cross a database and a network, so anything that is not a usable number
 * - absent on an old record, null from a column, a string from a hand-edited
 * row - resolves to the default rather than throwing. A photo framed as it
 * always was is a far better failure than a screen that will not draw.
 */
export function readFocusY(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampFocusY(value) : DEFAULT_FOCUS_Y;
}

export function readZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampZoom(value) : DEFAULT_ZOOM;
}

export interface Size {
  width: number;
  height: number;
}

/* Where to draw the image inside its frame, in frame pixels. */
export interface PhotoLayout extends Size {
  left: number;
  top: number;
}

/*
 * The geometry, given a measured frame and the image's natural size.
 *
 * This replaced `contentFit="cover"` plus `contentPosition` because those can
 * only ever crop INTO an image - there is no way to express "show me all of
 * it, with space around", which is exactly what zooming out has to mean. So
 * the size and offset are computed here and the image is placed absolutely.
 * One function, used by the editor and by every surface that displays a photo,
 * so what the user framed cannot render differently from what they saw.
 *
 * Scale is anchored to COVER rather than to the image's own pixels: `zoom: 1`
 * has to mean "fills the frame" on every frame shape, or a value saved against
 * the edit sheet would crop differently on a square card.
 */
export function photoLayout(frame: Size, natural: Size, focusY: number, zoom: number): PhotoLayout {
  /* Nothing measured yet, or a broken image. Fill the frame and draw no
   * geometry from numbers that would come out NaN. */
  if (
    !(frame.width > 0) ||
    !(frame.height > 0) ||
    !(natural.width > 0) ||
    !(natural.height > 0)
  ) {
    return { width: frame.width, height: frame.height, left: 0, top: 0 };
  }

  const cover = Math.max(frame.width / natural.width, frame.height / natural.height);
  const scale = cover * readZoom(zoom);
  const width = natural.width * scale;
  const height = natural.height * scale;

  const left = (frame.width - width) / 2;

  /*
   * The focus names a point on the image; that point is put at the middle of
   * the frame. Then it is pulled back so no background shows while the image
   * is still big enough to cover - a drag that could expose a strip of dead
   * colour above a plant is a drag that should have stopped.
   *
   * When the image is SMALLER than the frame there is nothing to pan and
   * nothing to clamp against, so it is simply centred and the focus is
   * ignored. That is the zoomed-out case, where the whole photo is visible by
   * definition.
   */
  if (height <= frame.height) {
    return { width, height, left, top: (frame.height - height) / 2 };
  }

  const wanted = frame.height / 2 - readFocusY(focusY) * height;
  const top = Math.min(0, Math.max(frame.height - height, wanted));
  return { width, height, left, top };
}

/*
 * The inverse, for the editor's drag: the focus that would put the image at
 * this offset. Kept beside `photoLayout` so the two cannot disagree about
 * which direction is which.
 */
export function focusForTop(frame: Size, height: number, top: number): number {
  if (!(height > 0)) return DEFAULT_FOCUS_Y;
  return clampFocusY((frame.height / 2 - top) / height);
}
