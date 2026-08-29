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
  plantCarePlan,
  soilAdjustedPlan,
  FERTILIZE_EVERY_DAYS,
  REPOT_EVERY_DAYS,
} from './care.ts';
import { DAY_MS } from './watering.ts';
import { DEFAULT_SOIL_MEDIUM } from './soilMedia.ts';
import type { GenusCarePlan } from './genusCarePlan.ts';
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

/*
 * The medium a plant grows in, and the plan that follows from it.
 *
 * Everything above proves the schedule engine; everything below proves which
 * plan gets fed into it, which is where the user-visible promise lives - the
 * same plant, the same last-watered date, a different due date in LECA than in
 * moss.
 */

function genusPlan(): GenusCarePlan {
  const bySoil: Record<string, unknown> = {};
  const days: Record<string, number> = {
    potting_mix: 9,
    aroid_mix: 7,
    leca: 4,
    pon: 5,
    sphagnum: 12,
    bark: 6,
    perlite_mix: 4,
    water: 21,
  };
  for (const [id, d] of Object.entries(days)) {
    bySoil[id] = {
      water: `Water every ${d} days.`,
      waterEveryDays: d,
      waterEveryDaysMax: d + 3,
      fertilizer: 'Half-strength balanced feed.',
      fertilizeEveryDays: id === 'pon' ? 90 : 21,
      light: 'Bright indirect.',
      humidity: '60%.',
      warnings: [],
    };
  }
  return {
    genus: 'Alocasia',
    family: 'Aroids',
    fetchedAt: '2026-08-29T00:00:00.000Z',
    bySoil: bySoil as GenusCarePlan['bySoil'],
  };
}

test('the genus plan for the plant medium wins over the diagnosis care plan', () => {
  const plan = plantCarePlan(
    { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 7 },
    genusPlan(),
    'leca'
  );
  assert.equal(plan?.waterEveryDays, 4);
  assert.equal(plan?.waterEveryDaysMax, 7);
});

test('with no genus plan, the medium scales the diagnosis interval', () => {
  const plan = plantCarePlan(
    { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 10 },
    null,
    'leca'
  );
  // 10 * 0.6, rounded.
  assert.equal(plan?.waterEveryDays, 6);
});

test('with no genus plan and no medium the diagnosis plan is untouched', () => {
  const base = { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 10 };
  assert.deepEqual(plantCarePlan(base, null, undefined), base);
});

test('a manual plant with no plan at all has no schedule rather than a made-up one', () => {
  assert.equal(plantCarePlan(undefined, null, DEFAULT_SOIL_MEDIUM), undefined);
});

test('soilAdjustedPlan never produces a zero-day interval', () => {
  const plan = soilAdjustedPlan({ soil: '', light: '', water: '', waterEveryDays: 1 }, 'leca');
  /* `?? 0` rather than a non-null assertion: waterEveryDays is optional on
   * CarePlan, and a dropped interval must fail this test, not skip it. */
  assert.ok((plan!.waterEveryDays ?? 0) >= 1);
});

test('fertilizer interval comes from the genus plan when there is one', () => {
  const plan = intervalPlanFor('fertilizer', undefined, genusPlan().bySoil.pon);
  assert.equal(plan?.waterEveryDays, 90);
});

test('fertilizer falls back to the constant with no genus plan', () => {
  const plan = intervalPlanFor('fertilizer', undefined, undefined);
  assert.equal(plan?.waterEveryDays, FERTILIZE_EVERY_DAYS);
});

test('repot ignores the genus plan, which carries no repot interval', () => {
  const plan = intervalPlanFor('repot', undefined, genusPlan().bySoil.pon);
  assert.equal(plan?.waterEveryDays, REPOT_EVERY_DAYS);
});

/*
 * The whole feature in one assertion. Everything else checks a plan in
 * isolation; this checks that the plan actually reaches the schedule, because a
 * correct lookup that never changes a due date would be invisible to the user.
 */
test('the same plant watered on the same day is due on different days in different media', () => {
  const genus = genusPlan();
  const diagnosis: CarePlan = { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 7 };
  const lastAt = daysAgo(1);

  const inLeca = careState('water', plantCarePlan(diagnosis, genus, 'leca'), lastAt, NOW);
  const inMoss = careState('water', plantCarePlan(diagnosis, genus, 'sphagnum'), lastAt, NOW);

  assert.equal(inLeca.intervalDays, 4);
  assert.equal(inMoss.intervalDays, 12);
  assert.ok(inLeca.nextDueAt !== null && inMoss.nextDueAt !== null);
  assert.equal(inMoss.nextDueAt! - inLeca.nextDueAt!, 8 * DAY_MS);
});

/*
 * Defence in depth. `isGenusCarePlan` refuses a plan with a hole in it, so a
 * cached plan should never be missing a medium - but a plan reaching this
 * function by some other route must degrade to the fallback rather than throw,
 * because the alternative is a care screen that crashes over an absent key.
 */
test('a genus plan missing the plant medium falls back instead of throwing', () => {
  const holed = genusPlan();
  delete (holed.bySoil as Record<string, unknown>).leca;

  const plan = plantCarePlan(
    { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 10 },
    holed,
    'leca'
  );
  // The soil-multiplier fallback, exactly as if there were no genus plan.
  assert.equal(plan?.waterEveryDays, 6);
});
