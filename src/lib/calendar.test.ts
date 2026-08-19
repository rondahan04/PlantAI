import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, dayKeySet, monthView, shiftMonth } from './calendar.ts';

/*
 * The calendar's only job is putting a dot on the right square, so these tests
 * are about the two ways that goes wrong: month arithmetic at the edges
 * (rollover, leap years, a month that starts on a Sunday) and the local-vs-UTC
 * day boundary that would shift every dot by one for users east of Greenwich.
 */

test('a month grid is padded to whole weeks', () => {
  const v = monthView(2026, 7); // August 2026
  assert.ok(v.weeks.every((w) => w.length === 7), 'every row is a full week');
  const days = v.weeks.flat().filter((c) => c.day !== null);
  assert.equal(days.length, 31);
  assert.equal(days[0].day, 1);
  assert.equal(days[30].day, 31);
});

test('leading padding matches the weekday the month starts on', () => {
  // 1 August 2026 is a Saturday: six blank squares before it.
  const v = monthView(2026, 7);
  const lead = v.weeks[0].findIndex((c) => c.day === 1);
  assert.equal(lead, 6);
});

test('a month starting on Sunday has no leading blanks', () => {
  // 1 February 2026 is a Sunday.
  const v = monthView(2026, 1);
  assert.equal(v.weeks[0][0].day, 1, 'the 1st sits in the first square');
});

test('rows follow the month rather than being padded to a fixed six', () => {
  // A 28-day February starting on a Sunday is exactly four weeks.
  assert.equal(monthView(2026, 1).weeks.length, 4);
});

test('leap years are counted by the platform, not by us', () => {
  assert.equal(monthView(2028, 1).weeks.flat().filter((c) => c.day).length, 29);
  assert.equal(monthView(2026, 1).weeks.flat().filter((c) => c.day).length, 28);
});

test('an out-of-range month rolls the year over', () => {
  const dec = monthView(2026, 11);
  const jan = shiftMonth(dec, 1);
  assert.equal(jan.year, 2027);
  assert.equal(jan.month, 0);

  const back = shiftMonth(jan, -1);
  assert.equal(back.year, 2026);
  assert.equal(back.month, 11);
});

test('stepping a year forward and back returns to the same month', () => {
  let v = monthView(2026, 7);
  for (let i = 0; i < 12; i++) v = shiftMonth(v, 1);
  assert.equal(v.year, 2027);
  assert.equal(v.month, 7);
  for (let i = 0; i < 12; i++) v = shiftMonth(v, -1);
  assert.equal(v.year, 2026);
  assert.equal(v.month, 7);
});

test('a day key is the LOCAL day, not the UTC one', () => {
  /*
   * This is the bug the module exists to prevent. Watering a plant just after
   * midnight local time is still the previous day in UTC anywhere east of
   * Greenwich, so a key taken off the ISO string would mark the wrong square.
   */
  const justAfterMidnight = new Date(2026, 7, 19, 0, 30);
  assert.equal(dayKey(justAfterMidnight), '2026-08-19');

  const lateEvening = new Date(2026, 7, 19, 23, 45);
  assert.equal(dayKey(lateEvening), '2026-08-19', 'both ends of the day agree');
});

test('a day key pads month and day', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('an unreadable timestamp yields no key rather than "NaN-NaN-NaN"', () => {
  assert.equal(dayKey('not a date'), '');
  const set = dayKeySet(['not a date', new Date(2026, 7, 19, 9).toISOString()]);
  assert.equal(set.size, 1);
  assert.ok(set.has('2026-08-19'));
});

test('two waterings on the same day collapse to one marked square', () => {
  const set = dayKeySet([
    new Date(2026, 7, 19, 8).toISOString(),
    new Date(2026, 7, 19, 20).toISOString(),
  ]);
  assert.deepEqual([...set], ['2026-08-19']);
});

test('the grid dates round-trip through dayKey', () => {
  // What the screen actually does: build the grid, key each cell, look it up.
  const watered = dayKeySet([new Date(2026, 7, 19, 14).toISOString()]);
  const cells = monthView(2026, 7).weeks.flat().filter((c) => c.date);
  const hits = cells.filter((c) => watered.has(dayKey(c.date!)));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].day, 19);
});
