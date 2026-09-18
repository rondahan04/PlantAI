/**
 * Unit tests for the saved photo framing.
 * Run: node --test src/lib/media/photoFocus.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FOCUS_Y,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clampFocusY,
  clampZoom,
  photoLayout,
  readFocusY,
  readZoom,
} from './photoFocus.ts';

const WIDE = { width: 300, height: 200 };       // the frame
const TALL = { width: 1000, height: 2000 };     // a portrait photograph

test('the defaults are what the app did before any of this existed', () => {
  assert.equal(DEFAULT_FOCUS_Y, 0.5);
  assert.equal(DEFAULT_ZOOM, 1);
  assert.equal(readFocusY(undefined), 0.5);
  assert.equal(readZoom(undefined), 1);
});

/*
 * Zoom 1 must be EXACTLY `contentFit="cover"`, because that is what every
 * plant saved before this was rendered with. If it drifted, adding the field
 * would silently re-crop a library nobody asked to change.
 */
test('zoom 1 reproduces a centred cover crop exactly', () => {
  const l = photoLayout(WIDE, TALL, 0.5, 1);
  /* cover scale = max(300/1000, 200/2000) = 0.3 -> 300 x 600 */
  assert.equal(l.width, 300);
  assert.equal(l.height, 600);
  assert.equal(l.left, 0, 'fills the width');
  assert.equal(l.top, -200, 'and is centred vertically: (200 - 600) / 2');
});

test('the focus slides the photo within the frame', () => {
  const top = photoLayout(WIDE, TALL, 0, 1);
  assert.equal(top.top, 0, 'focus 0 pins the top of the photo to the top of the frame');

  const bottom = photoLayout(WIDE, TALL, 1, 1);
  assert.equal(bottom.top, -400, 'focus 1 pins its bottom to the bottom: 200 - 600');
});

/*
 * No gap while the photo is big enough to fill the frame. A focus that would
 * expose the background is clamped to the edge instead - otherwise a drag
 * could leave a strip of dead colour above a plant.
 */
test('a photo larger than its frame can never leave a gap', () => {
  for (const f of [-5, 0, 0.5, 1, 9]) {
    const l = photoLayout(WIDE, TALL, f, 1);
    assert.ok(l.top <= 0, `top ${l.top} must not gap at the top`);
    assert.ok(l.top + l.height >= WIDE.height, `bottom must not gap (focus ${f})`);
  }
});

/*
 * Zooming out past the fit is the point of the whole exercise: the picture
 * gets smaller than its frame and the WHOLE photograph becomes visible, with
 * background around it.
 */
test('zooming out past the fit shows the entire photograph', () => {
  /* A square frame, so the arithmetic lands on values the two-decimal rounding
   * can actually represent. At cover the photo is 300x600 in a 300x300 frame;
   * half of that is 150x300, which finally fits. */
  const SQUARE = { width: 300, height: 300 };
  const l = photoLayout(SQUARE, TALL, 0.5, 0.5);
  assert.equal(l.height, 300, 'the whole photo now fits the height');
  assert.equal(l.width, 150);
  assert.equal(l.top, 0);
  assert.equal(l.left, 75, 'and is centred, with bars either side');
});

test('a photo smaller than its frame is centred, whatever the focus says', () => {
  const a = photoLayout(WIDE, TALL, 0, 0.2);
  const b = photoLayout(WIDE, TALL, 1, 0.2);
  assert.deepEqual(a, b, 'there is nothing to pan when it all fits');
  assert.equal(a.top, (WIDE.height - a.height) / 2);
});

test('zooming in crops tighter', () => {
  const l = photoLayout(WIDE, TALL, 0.5, 2);
  assert.equal(l.width, 600);
  assert.equal(l.height, 1200);
  assert.equal(l.left, -150, 'overflows the width evenly');
});

test('zoom is clamped to a usable range', () => {
  assert.equal(clampZoom(0), MIN_ZOOM);
  assert.equal(clampZoom(999), MAX_ZOOM);
  assert.equal(clampZoom(1.5), 1.5);
  assert.equal(readZoom(NaN), DEFAULT_ZOOM);
  assert.equal(readZoom('2' as never), DEFAULT_ZOOM, 'a string is not a zoom');
});

test('the stored values are rounded to something a person could have meant', () => {
  assert.equal(clampFocusY(0.333333333), 0.33);
  assert.equal(clampZoom(1.23456), 1.23);
});

/* A degenerate measurement must not produce NaN geometry on screen. */
test('a zero-sized image or frame yields the frame itself, not NaN', () => {
  const l = photoLayout(WIDE, { width: 0, height: 0 }, 0.5, 1);
  assert.deepEqual(l, { width: WIDE.width, height: WIDE.height, left: 0, top: 0 });
});
