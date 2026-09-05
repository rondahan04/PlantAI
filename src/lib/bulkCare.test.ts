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

test('waterTargets: marks what is due today and what is late, nothing else', () => {
  const a = plant('a');
  const b = plant('b');
  const c = plant('c');
  const { targets, dueCount, firstWaterCount } = waterTargets([
    due(a, 'water', -3), // overdue
    due(b, 'water', 0), // due today
    due(c, 'water', 2), // merely approaching
  ]);
  assert.deepEqual(targets.map((p) => p.id), ['a', 'b']);
  assert.equal(dueCount, 2);
  assert.equal(firstWaterCount, 0);
});

test('waterTargets: never marks a plant that is not due for WATER', () => {
  // The gap that matters: recording water a plant never got resets its clock
  // and writes a false entry into the history the user reads later.
  const a = plant('a');
  const { targets } = waterTargets([due(a, 'fertilizer', -5), due(a, 'repot', -30)]);
  assert.deepEqual(targets, []);
});

test('waterTargets: a plant due for several kinds is marked once, not once per kind', () => {
  const a = plant('a');
  const { targets } = waterTargets([due(a, 'water', -1), due(a, 'fertilizer', -1), due(a, 'water', -1)]);
  assert.deepEqual(targets.map((p) => p.id), ['a']);
});

test('waterTargets: nothing due means the button has nothing to do', () => {
  assert.deepEqual(waterTargets([]).targets, []);
  assert.deepEqual(waterTargets([due(plant('a'), 'water', 4)]).targets, []);
});

/*
 * First watering. A plant with a schedule but no logged watering has no due
 * date, so it can never appear in `due` - which meant "water all" silently
 * skipped every plant the user had just added to their library.
 */
test('waterTargets: waters a plant that has never been watered', () => {
  const fresh = plant('fresh');
  const { targets, dueCount, firstWaterCount } = waterTargets([], [fresh]);
  assert.deepEqual(targets.map((p) => p.id), ['fresh']);
  assert.equal(dueCount, 0);
  assert.equal(firstWaterCount, 1);
});

test('waterTargets: counts the two reasons separately so the dialog can name them', () => {
  const late = plant('late');
  const fresh = plant('fresh');
  const { targets, dueCount, firstWaterCount } = waterTargets([due(late, 'water', -2)], [fresh]);
  assert.deepEqual(targets.map((p) => p.id), ['late', 'fresh']);
  assert.equal(dueCount, 1);
  assert.equal(firstWaterCount, 1);
  // They must sum to the batch, or the confirmation misreports what it is about to do.
  assert.equal(dueCount + firstWaterCount, targets.length);
});

test('waterTargets: a plant in both groups is counted once, as due', () => {
  // Cannot happen today - a never-watered plant has no due date - but the
  // order makes that an assumption rather than something load-bearing.
  const a = plant('a');
  const { targets, dueCount, firstWaterCount } = waterTargets([due(a, 'water', -1)], [a]);
  assert.deepEqual(targets.map((p) => p.id), ['a']);
  assert.equal(dueCount, 1);
  assert.equal(firstWaterCount, 0);
});

test('waterTargets: a plant approaching its due date is still not first-watered by accident', () => {
  // The overwatering guard must survive the new group: "not due yet" and
  // "never watered" are different states and only the second one qualifies.
  const soon = plant('soon');
  const { targets } = waterTargets([due(soon, 'water', 3)], []);
  assert.deepEqual(targets, []);
});

test('waterTargets: omitting the second argument behaves exactly as before', () => {
  const a = plant('a');
  assert.deepEqual(waterTargets([due(a, 'water', -1)]).targets.map((p) => p.id), ['a']);
});
