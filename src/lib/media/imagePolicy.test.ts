import test from 'node:test';
import assert from 'node:assert/strict';
import { resizePlan, MAX_EDGE_PX } from './imagePolicy.ts';

test('a camera capture is left alone', () => {
  // Already compressed at quality 0.7 and under the cap - the common path,
  // and it must not pay for a re-encode it does not need.
  assert.equal(resizePlan(1200, 1600), null);
  assert.equal(resizePlan(MAX_EDGE_PX, 1200), null, 'exactly at the cap is fine');
});

test('the full-resolution gallery pick that broke production is shrunk', () => {
  // 12MP landscape, the shape that exceeded the 12MB body cap.
  const plan = resizePlan(4032, 3024);
  assert.ok(plan);
  assert.equal(plan.width, MAX_EDGE_PX);
  assert.equal(plan.height, null, 'height null so the aspect ratio is kept');
});

test('a PORTRAIT photo is capped on its long edge, not its width', () => {
  // The bug this test exists for: the manipulator takes a target WIDTH, so
  // capping width at 1600 would leave a 3024x4032 photo at 1600x2133 - still
  // over the cap on the edge that actually matters. Most plant photos are
  // portrait, so getting this backwards would miss the common case.
  const plan = resizePlan(3024, 4032);
  assert.ok(plan);
  assert.equal(plan.width, 1200);
  // 1200 wide at 3:4 is 1600 tall - the long edge lands exactly on the cap.
  assert.equal(Math.round(plan.width * (4032 / 3024)), MAX_EDGE_PX);
});

test('a small photo is never upscaled', () => {
  // Upscaling would make the file bigger, look no better, and turn the one
  // cheap case into an expensive one.
  assert.equal(resizePlan(400, 300), null);
  assert.equal(resizePlan(80, 80), null);
});

test('unknown dimensions mean do nothing rather than guess', () => {
  // A picker that did not report a size. Resizing on a guess risks mangling
  // the photo, and the upload-size guard still catches anything too large.
  assert.equal(resizePlan(0, 0), null);
  assert.equal(resizePlan(NaN, 1000), null);
  assert.equal(resizePlan(-100, 200), null);
  assert.equal(resizePlan(1000, Infinity), null);
});

test('a square photo caps at the edge', () => {
  const plan = resizePlan(3000, 3000);
  assert.ok(plan);
  assert.equal(plan.width, MAX_EDGE_PX);
});

test('an extreme panorama still comes down to the cap', () => {
  const plan = resizePlan(8000, 1000);
  assert.ok(plan);
  assert.equal(plan.width, MAX_EDGE_PX);
  // The short edge collapses to 200 - fine, the long edge is the constraint.
  assert.equal(Math.round(1000 * (MAX_EDGE_PX / 8000)), 200);
});

test('the resulting long edge never exceeds the cap, for any input', () => {
  // The invariant, stated once: whatever comes in, what comes out fits.
  for (const [w, h] of [[4032, 3024], [3024, 4032], [5000, 5000], [1601, 900], [900, 1601]]) {
    const plan = resizePlan(w, h);
    if (!plan) {
      assert.ok(Math.max(w, h) <= MAX_EDGE_PX, `${w}x${h} was skipped but is over the cap`);
      continue;
    }
    const outHeight = Math.round(plan.width * (h / w));
    assert.ok(
      Math.max(plan.width, outHeight) <= MAX_EDGE_PX + 1,
      `${w}x${h} -> ${plan.width}x${outHeight} still exceeds ${MAX_EDGE_PX}`
    );
  }
});
