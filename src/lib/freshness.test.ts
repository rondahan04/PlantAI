import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockAgeLabel } from './freshness.ts';

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('a result with no stamp says nothing rather than guessing', () => {
  assert.equal(stockAgeLabel(null, NOW), null);
  assert.equal(stockAgeLabel(Number.NaN, NOW), null);
});

test('a scrape that just finished reads as now', () => {
  assert.equal(stockAgeLabel(NOW - 30_000, NOW), 'Stock checked just now');
});

test('clock skew never produces a future check', () => {
  assert.equal(stockAgeLabel(NOW + 5 * MIN, NOW), 'Stock checked just now');
});

test('minutes, then hours, then days', () => {
  assert.equal(stockAgeLabel(NOW - 20 * MIN, NOW), 'Stock checked 20 min ago');
  assert.equal(stockAgeLabel(NOW - HOUR, NOW), 'Stock checked 1 hour ago');
  assert.equal(stockAgeLabel(NOW - 5 * HOUR, NOW), 'Stock checked 5 hours ago');
  assert.equal(stockAgeLabel(NOW - DAY, NOW), 'Stock checked yesterday');
  assert.equal(stockAgeLabel(NOW - 6 * DAY, NOW), 'Stock checked 6 days ago');
});

test('age rounds down, so freshness is never overstated', () => {
  // 47 hours is "yesterday", not "2 days ago" - understating age would be the
  // dangerous direction, but so would rounding 23h up to a day.
  assert.equal(stockAgeLabel(NOW - 47 * HOUR, NOW), 'Stock checked yesterday');
  assert.equal(stockAgeLabel(NOW - 23 * HOUR, NOW), 'Stock checked 23 hours ago');
});
