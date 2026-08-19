import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS, intervalLabel, needsWater, wateringState } from './watering.ts';
import type { CarePlan } from '../types/index.ts';

/*
 * The schedule is the one part of the care plan the app makes a claim about
 * rather than quoting. "3 days overdue" is the app's own sentence, and a wrong
 * one tells the user their plant is fine on the day it dries out — so the
 * boundaries below (the hour it becomes due, the hour it becomes late) are
 * pinned rather than left to whatever the arithmetic happens to do.
 */

const NOW = Date.parse('2026-08-18T12:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

const range: CarePlan = {
  soil: 'Well-draining aroid mix',
  light: 'Bright indirect',
  water: 'Every 7-10 days, when the top 2cm is dry',
  waterEveryDays: 7,
  waterEveryDaysMax: 10,
};

const single: CarePlan = { ...range, waterEveryDays: 14, waterEveryDaysMax: undefined };
const proseOnly: CarePlan = { soil: 'Loam', light: 'Bright', water: 'When dry' };

test('no interval means no schedule — the prose still stands on its own', () => {
  const s = wateringState(proseOnly, ago(30), NOW);
  assert.equal(s.status, 'unscheduled');
  assert.equal(s.nextDueAt, null);
  assert.equal(s.label, '', 'nothing to say beats inventing a date');
  assert.equal(needsWater(s), false);
});

test('a missing care plan is unscheduled, not a crash', () => {
  assert.equal(wateringState(undefined, ago(3), NOW).status, 'unscheduled');
});

test('a scheduled plant with no watering logged waits for the user to start it', () => {
  const s = wateringState(range, undefined, NOW);
  assert.equal(s.status, 'never_watered');
  assert.equal(s.nextDueAt, null);
  assert.match(s.label, /Every 7-10 days/);
  // Not a problem to flag on Home: the user simply has not started the schedule.
  assert.equal(needsWater(s), false);
});

test('an unreadable stored date is treated as none, never as NaN days overdue', () => {
  const s = wateringState(range, 'last tuesday', NOW);
  assert.equal(s.status, 'never_watered');
  assert.equal(s.daysUntilDue, null);
});

test('watered today counts down to the near end of the range', () => {
  const s = wateringState(range, ago(0), NOW);
  assert.equal(s.status, 'ok');
  assert.equal(s.daysUntilDue, 7);
  assert.equal(s.nextDueAt, NOW + 7 * DAY_MS);
  assert.equal(s.label, 'Next water in 7 days');
});

test('part of a day still to wait reads as a day to wait', () => {
  // Due in 20 hours: "today" would send the user to a pot that is not dry yet.
  const s = wateringState(range, new Date(NOW - 7 * DAY_MS + 20 * 3_600_000).toISOString(), NOW);
  assert.equal(s.status, 'ok');
  assert.equal(s.daysUntilDue, 1);
  assert.equal(s.label, 'Next water tomorrow');
});

test('the window opens at the near end of the range', () => {
  const s = wateringState(range, ago(7), NOW);
  assert.equal(s.status, 'due');
  assert.equal(s.daysUntilDue, 0);
  assert.equal(s.label, 'Due now — check the soil');
  assert.equal(needsWater(s), true);
});

test('the whole range is due, not late — 10 days is still inside "every 7-10"', () => {
  for (const d of [7, 8, 9, 10]) {
    assert.equal(wateringState(range, ago(d), NOW).status, 'due', `${d} days`);
  }
});

test('past the far end of the range it is overdue, counted from the due date', () => {
  const s = wateringState(range, ago(12), NOW);
  assert.equal(s.status, 'overdue');
  assert.equal(s.label, '5 days overdue', 'late against day 7, not against day 10');
  assert.equal(needsWater(s), true);
});

test('a single figure gets one day of grace before it reads as late', () => {
  // Otherwise a schedule flips from on-time to late within the same day.
  assert.equal(wateringState(single, ago(14), NOW).status, 'due');
  assert.equal(wateringState(single, ago(14.5), NOW).status, 'due');
  assert.equal(wateringState(single, ago(15.1), NOW).status, 'overdue');
});

test('overdue is never reported as "0 days overdue"', () => {
  const s = wateringState(single, ago(15.01), NOW);
  assert.equal(s.status, 'overdue');
  assert.equal(s.label, '1 day overdue', 'singular, and never zero');
});

test('a one-day interval is phrased as a day, not as "every 1 days"', () => {
  assert.equal(intervalLabel({ ...single, waterEveryDays: 1 }), 'Every day');
});

test('a maximum that is not above the minimum is not shown as a range', () => {
  // The server drops these, but a plant saved from an older build may hold one.
  assert.equal(intervalLabel({ ...range, waterEveryDaysMax: 7 }), 'Every 7 days');
  assert.equal(intervalLabel({ ...range, waterEveryDaysMax: 3 }), 'Every 7 days');
  // Scheduled off 7 with a single figure's grace day, not off the bogus 3.
  assert.equal(wateringState({ ...range, waterEveryDaysMax: 3 }, ago(7.5), NOW).status, 'due');
  assert.equal(wateringState({ ...range, waterEveryDaysMax: 3 }, ago(9), NOW).status, 'overdue');
});

test('the interval label is empty when there is no interval', () => {
  assert.equal(intervalLabel(proseOnly), '');
  assert.equal(intervalLabel(undefined), '');
});

test('watering resets the countdown', () => {
  const late = wateringState(range, ago(20), NOW);
  assert.equal(late.status, 'overdue');

  const fresh = wateringState(range, new Date(NOW).toISOString(), NOW);
  assert.equal(fresh.status, 'ok');
  assert.equal(fresh.daysUntilDue, 7);
});
