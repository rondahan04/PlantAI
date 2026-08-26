/**
 * The schedule for repotting and feeding. Watering's own cases live in
 * watering.test.ts - what is tested here is the generalisation: that the two
 * kinds without a model-supplied interval still get a real due date, and that
 * they say so in their own words.
 *
 * Run: node --test src/lib/care.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  careState,
  intervalPlanFor,
  monthsish,
  FERTILIZE_EVERY_DAYS,
  REPOT_EVERY_DAYS,
} from './care.ts';
import { DAY_MS } from './watering.ts';
import type { CarePlan } from '../types/index.ts';

/* Only the intervals matter here; the prose fields exist to satisfy CarePlan. */
const plan = (waterEveryDays?: number): CarePlan => ({
  soil: '',
  light: '',
  water: '',
  ...(waterEveryDays === undefined ? {} : { waterEveryDays }),
});

const NOW = Date.parse('2026-08-26T09:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();

test('feeding is scheduled even though the care plan carries no interval', () => {
  const state = careState('fertilizer', plan(7), daysAgo(2), NOW);
  assert.equal(state.status, 'ok');
  assert.equal(state.intervalDays, FERTILIZE_EVERY_DAYS);
  assert.equal(state.daysUntilDue, FERTILIZE_EVERY_DAYS - 2);
  assert.match(state.label, /Next feed in 19 days/);
});

test('repotting uses the 18-month interval, not the watering one', () => {
  const state = careState('repot', plan(7), daysAgo(1), NOW);
  assert.equal(state.intervalDays, REPOT_EVERY_DAYS);
  assert.equal(state.status, 'ok');
});

test('a plant with no watering interval still gets a feed schedule', () => {
  // The whole point of the constants: an old plant whose diagnosis returned no
  // waterEveryDays is unscheduled for water and scheduled for everything else.
  const state = careState('fertilizer', undefined, daysAgo(30), NOW);
  assert.equal(state.status, 'overdue');
  assert.match(state.label, /overdue/);
});

test('never fed reads as an invitation, in weeks rather than days', () => {
  const state = careState('fertilizer', plan(7), undefined, NOW);
  assert.equal(state.status, 'never_watered');
  assert.equal(state.label, 'Every 3 weeks · tap to start');
});

test('never repotted reads in months', () => {
  const state = careState('repot', plan(7), undefined, NOW);
  assert.equal(state.label, 'Every 18 months · tap to start');
});

test('a repot that is due points at the roots, not the calendar', () => {
  const state = careState('repot', undefined, daysAgo(REPOT_EVERY_DAYS), NOW);
  assert.equal(state.status, 'due');
  assert.equal(state.label, 'Due now - check the roots');
});

test('water is passed through untouched - same interval, same words', () => {
  const range: CarePlan = { ...plan(7), waterEveryDaysMax: 10 };
  const state = careState('water', range, daysAgo(3), NOW);
  assert.equal(state.intervalDays, 7);
  assert.equal(state.intervalDaysMax, 10);
  assert.match(state.label, /Next water in 4 days/);
});

test('intervalPlanFor keeps the rest of the care plan intact', () => {
  const withProse: CarePlan = { ...plan(7), light: 'bright indirect' };
  const out = intervalPlanFor('fertilizer', withProse)!;
  assert.equal(out.light, 'bright indirect');
  assert.equal(out.waterEveryDays, FERTILIZE_EVERY_DAYS);
});

test('monthsish rounds to the unit a human would say', () => {
  assert.equal(monthsish(21), '3 weeks');
  assert.equal(monthsish(540), '18 months');
  assert.equal(monthsish(1), 'day');
  assert.equal(monthsish(null), '');
});
