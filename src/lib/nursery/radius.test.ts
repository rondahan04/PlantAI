import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRadius,
  nextRadius,
  radiusKm,
  DEFAULT_RADIUS_M,
  WIDE_RADIUS_M,
  MAX_RADIUS_M,
} from './radius.ts';

test('clampRadius keeps a radius inside what Places will accept', () => {
  assert.equal(clampRadius(10_000), 10_000);
  assert.equal(clampRadius(999_999), MAX_RADIUS_M, 'Places errors above 50km rather than clamping');
  assert.equal(clampRadius(5), 1_000, 'a sub-kilometre radius is a mistake, not a choice');
});

/* A bad radius must not become 0: that finds nothing while still costing a
 * paid request, which is the worst of both answers. */
test('clampRadius falls back to the default rather than to zero', () => {
  for (const bad of [undefined, null, 'abc', NaN, 0, -5, '']) {
    assert.equal(clampRadius(bad), DEFAULT_RADIUS_M, String(bad));
  }
  assert.equal(clampRadius('25000'), 25_000, 'a numeric string is a radius, not a mistake');
});

/*
 * The dead end this exists to remove: an empty search offered "Search again",
 * which re-ran the identical search and could only fail identically.
 */
test('nextRadius climbs a ladder, and stops offering one at the widest', () => {
  assert.equal(nextRadius(DEFAULT_RADIUS_M), WIDE_RADIUS_M);
  assert.equal(nextRadius(5_000), WIDE_RADIUS_M);
  /*
   * The second step exists because the measurement demanded it. Nurseries
   * genuinely within the radius at Mitzpe Ramon: 10km → 3, 25km → 4, 50km → 12.
   * One step would have stopped the users with nothing nearby one short of the
   * only radius that helps them.
   */
  assert.equal(nextRadius(WIDE_RADIUS_M), MAX_RADIUS_M);
  assert.equal(
    nextRadius(MAX_RADIUS_M),
    null,
    'at the widest there is nothing further to offer, and a button that re-runs the same search is the dead end'
  );
});

/* The number on screen has to be the number we searched - the whole reason
 * this is derived instead of a hardcoded "10km" in the copy. */
test('radiusKm reports the distance actually searched', () => {
  assert.equal(radiusKm(DEFAULT_RADIUS_M), 10);
  assert.equal(radiusKm(WIDE_RADIUS_M), 25);
  assert.equal(radiusKm(MAX_RADIUS_M), 50);
  assert.equal(radiusKm(0), 10, 'an unusable radius reads as the default we will actually use');
});
