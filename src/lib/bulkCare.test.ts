import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseTargets, waterTargets } from './bulkCare.ts';
import type { DueItem } from './portfolio.ts';
import type { CareKind, StoredPlant } from '../services/plantStore.ts';
import type { PlantDiagnosis } from '../types/index.ts';

const diagnosis = {
  plantName: 'Monstera',
  scientificName: 'Monstera deliciosa',
  condition: 'healthy',
  confidence: 90,
  issues: [],
  careAdvice: [],
} as unknown as PlantDiagnosis;

function plant(id: string, opts: { photo?: boolean; diagnosed?: boolean } = {}): StoredPlant {
  const { photo = true, diagnosed = false } = opts;
  return {
    id,
    savedAt: '2026-09-01T00:00:00.000Z',
    photoUri: photo ? `file://${id}.jpg` : '',
    addedVia: 'manual',
    ...(diagnosed ? { diagnosis } : {}),
  } as StoredPlant;
}

function due(p: StoredPlant, kind: CareKind, daysUntilDue: number): DueItem {
  return { plant: p, kind, daysUntilDue, label: `${kind} ${daysUntilDue}` };
}

// --- diagnoseTargets -------------------------------------------------------

test('diagnoseTargets: only undiagnosed plants that have a photo to send', () => {
  const a = plant('a');
  const b = plant('b', { diagnosed: true });
  const c = plant('c', { photo: false });
  const { targets, skippedNoPhoto } = diagnoseTargets([a, b, c]);
  assert.deepEqual(targets.map((p) => p.id), ['a']);
  assert.equal(skippedNoPhoto, 1); // c: undiagnosed but nothing to send
});

test('diagnoseTargets: an already-diagnosed plant is not counted as skipped', () => {
  // Skipping it is not a shortfall the user needs told about - there is
  // nothing to learn from re-reading the same photograph.
  const { targets, skippedNoPhoto } = diagnoseTargets([
    plant('a', { diagnosed: true }),
    plant('b', { diagnosed: true }),
  ]);
  assert.deepEqual(targets, []);
  assert.equal(skippedNoPhoto, 0);
});

test('diagnoseTargets: a missing photoUri counts as no photo, same as an empty one', () => {
  const noField = { id: 'x', savedAt: '2026-09-01T00:00:00.000Z', addedVia: 'manual' } as StoredPlant;
  const { targets, skippedNoPhoto } = diagnoseTargets([noField]);
  assert.deepEqual(targets, []);
  assert.equal(skippedNoPhoto, 1);
});

test('diagnoseTargets: preserves list order so progress counts up the visible list', () => {
  const { targets } = diagnoseTargets([plant('c'), plant('a'), plant('b')]);
  assert.deepEqual(targets.map((p) => p.id), ['c', 'a', 'b']);
});

test('diagnoseTargets: an empty library asks for nothing', () => {
  assert.deepEqual(diagnoseTargets([]), { targets: [], skippedNoPhoto: 0 });
});

// --- waterTargets ----------------------------------------------------------

/*
 * "Water all" waters ALL of them, by explicit product decision (2026-09-05).
 * It used to be limited to due, overdue and never-watered plants, on the
 * reasoning that an early mark records water a plant never got and pushes its
 * next reminder a full interval late. That protection is gone on purpose - the
 * label promises all, and the confirmation now states the consequence instead.
 */
test('waterTargets: every plant in the library, due or not', () => {
  const a = plant('a');
  const b = plant('b');
  const c = plant('c');
  assert.deepEqual(waterTargets([a, b, c]).map((p) => p.id), ['a', 'b', 'c']);
});

test('waterTargets: a plant watered five minutes ago is included too', () => {
  // The case the old rule existed to prevent, now allowed deliberately: the
  // user says they watered everything, so everything gets the stamp.
  const fresh = plant('fresh');
  assert.deepEqual(waterTargets([fresh]).map((p) => p.id), ['fresh']);
});

test('waterTargets: a plant with no schedule is included - the stamp is a log', () => {
  const unscheduled = plant('unscheduled');
  assert.deepEqual(waterTargets([unscheduled]).map((p) => p.id), ['unscheduled']);
});

test('waterTargets: library order is preserved so the count matches the screen', () => {
  assert.deepEqual(
    waterTargets([plant('c'), plant('a'), plant('b')]).map((p) => p.id),
    ['c', 'a', 'b']
  );
});

test('waterTargets: one plant is never watered twice in a single batch', () => {
  // Defensive: two entries for one plant would write two rows into the
  // watering history for a single errand.
  const a = plant('a');
  assert.deepEqual(waterTargets([a, a, plant('b')]).map((p) => p.id), ['a', 'b']);
});

test('waterTargets: an empty portfolio has nothing to water', () => {
  assert.deepEqual(waterTargets([]), []);
});
