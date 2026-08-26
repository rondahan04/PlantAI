import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availabilityBadge, LIKELY_AT_OR_ABOVE, MAYBE_AT_OR_ABOVE } from './availability.ts';
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

test('an unreadable site NEVER gets a percentage', () => {
  // The bug in one assertion: no number may be stated about a page we could
  // not read, however confident the model sounded about the captcha.
  const b = availabilityBadge(
    base({ availability: { kind: 'unreadable', detail: 'the site blocked automated reading' } })
  );

  assert.equal(b.text, "Couldn't read this site");
  assert.doesNotMatch(b.text, /%/);
  assert.equal(b.tone, 'unknown', 'not amber - this is not a warning about the nursery');
  assert.equal(b.hasDetail, true);
});

test('a failed check is distinguished from an unreadable site', () => {
  const b = availabilityBadge(base({ availability: { kind: 'error', detail: 'Firecrawl 429' } }));
  assert.equal(b.text, "Couldn't check this site");
  assert.equal(b.detail, 'Firecrawl 429');
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
