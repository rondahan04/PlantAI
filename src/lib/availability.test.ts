import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityBadge,
  isWorthShowing,
  LIKELY_AT_OR_ABOVE,
  MAYBE_AT_OR_ABOVE,
} from './availability.ts';
import type { Nursery } from '../types/index.ts';

/*
 * These exist because a nursery row once read:
 *   "~50% · The site text is only a security-verification page, so there is
 *    no explicit evidence about Monstera or plant ca…"
 * clipped mid-word inside a small pill. Two failures in one line: unreadable,
 * and a percentage invented for a site that was never actually read.
 */

const base = (over: Partial<Nursery> = {}): Nursery => ({
  id: 'x.co.il',
  name: 'Test Nursery',
  website: 'https://x.co.il',
  address: '',
  distance: '',
  distanceKm: 3,
  hasPlant: false,
  inStockKnown: false,
  plantPrice: '-',
  shipsToHome: false,
  latitude: 32,
  longitude: 34,
  ...over,
});

test('an exact listing outranks every estimate', () => {
  const b = availabilityBadge(base({ inStockKnown: true, hasPlant: true }));
  assert.equal(b.text, 'In stock now · local pickup');
  assert.equal(b.tone, 'good');
  assert.equal(b.hasDetail, false);

  const ships = availabilityBadge(base({ inStockKnown: true, shipsToHome: true }));
  assert.match(ships.text, /ships to home/);
});

test('estimate bands change at their boundaries and nowhere else', () => {
  const at = (confidence: number) =>
    availabilityBadge(base({ availability: { kind: 'estimate', confidence, detail: 'why' } })).text;

  assert.match(at(LIKELY_AT_OR_ABOVE), /^Likely has it/);
  assert.match(at(LIKELY_AT_OR_ABOVE - 1), /^Might have it/);
  assert.match(at(MAYBE_AT_OR_ABOVE), /^Might have it/);
  assert.match(at(MAYBE_AT_OR_ABOVE - 1), /^Probably not/);
  assert.equal(at(72), 'Likely has it · 72%');
});

test('an estimate keeps its reasoning behind the tap, not in the line', () => {
  const long =
    'The nursery lists herbs, perennials and Mediterranean shrubs, so it plausibly carries sage.';
  const b = availabilityBadge(base({ availability: { kind: 'estimate', confidence: 60, detail: long } }));

  assert.equal(b.text, 'Might have it · 60%');
  assert.ok(b.text.length < 30, 'the visible line stays short enough for one row');
  assert.equal(b.detail, long);
  assert.equal(b.hasDetail, true);
});

test('a shop we could not read says we did not find the product', () => {
  /*
   * Two rules in one line. No percentage - we never read the shop, so any
   * number would describe a captcha page rather than the plant. And no talk of
   * scrapes or blocking: our plumbing is not the user's problem, and all they
   * need to know is that we have nothing to show for this nursery.
   */
  const b = availabilityBadge(
    base({
      outcome: 'not_found',
      availability: { kind: 'unreadable', detail: 'the site blocked automated reading' },
    })
  );

  assert.equal(b.text, "Didn't find the product");
  assert.doesNotMatch(b.text, /%/);
  assert.doesNotMatch(b.text, /scrape|block|fail|error/i, 'no plumbing language');
  assert.equal(b.tone, 'unknown', 'not amber - this is not a warning about the nursery');
  assert.equal(b.detail, 'the site blocked automated reading', 'the reason stays behind the tap');
});

test('a legacy unreadable/error payload speaks the same words', () => {
  // A job that outlived a deploy must not show the user a second vocabulary.
  for (const kind of ['unreadable', 'error'] as const) {
    const b = availabilityBadge(base({ availability: { kind, detail: 'Firecrawl 429' } }));
    assert.equal(b.text, "Didn't find the product", kind);
  }
});

test('a shop that was read and does not stock the plant is not shown at all', () => {
  assert.equal(isWorthShowing(base({ outcome: 'not_sold' })), false);
  assert.equal(isWorthShowing(base({ outcome: 'found' })), true);
  assert.equal(isWorthShowing(base({ outcome: 'not_found' })), true);
  assert.equal(isWorthShowing(base()), true, 'an older payload with no outcome still shows');
});


test('a legacy note from an older server still renders', () => {
  /*
   * jobs.ts retains results across a restart, so a job started before this
   * change lands still has to display in an updated client.
   */
  const b = availabilityBadge(base({ availabilityNote: '~50% · some old sentence' }));
  assert.equal(b.text, 'Availability unknown');
  assert.equal(b.detail, '~50% · some old sentence');
  assert.equal(b.hasDetail, true);
});

test('nothing at all falls back to the original copy', () => {
  const b = availabilityBadge(base());
  assert.equal(b.text, 'Availability unknown - call to confirm');
  assert.equal(b.hasDetail, false);
});
