import test from 'node:test';
import assert from 'node:assert/strict';
import { samePlantCard, sameSlots } from './plantCardEquality.ts';
import type { StoredPlant } from '../services/plantStore.ts';
import type { CareSlot } from './portfolio.ts';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function plant(over: Partial<StoredPlant> = {}): StoredPlant {
  return {
    id: 'p1',
    savedAt: new Date(NOW).toISOString(),
    photoUri: 'file:///photos/p1.jpg',
    addedVia: 'scan',
    diagnosis: {
      plantName: 'Monstera',
      scientificName: 'Monstera deliciosa',
      condition: 'healthy',
      conditionLabel: 'Healthy',
      issues: [],
      treatments: [],
      canBeSaved: true,
      confidence: 90,
      description: '',
    },
    ...over,
  } as StoredPlant;
}

const slot = (over: Partial<CareSlot> = {}): CareSlot => ({
  kind: 'water',
  status: 'due',
  daysUntilDue: 0,
  label: 'Water today',
  ...over,
});

/*
 * The optimisation only exists because storage reads go through JSON.parse,
 * so every plant object is a new reference even when unchanged.
 */
test('an identical plant that is a different object still counts as unchanged', () => {
  // This is the whole point. If this fails, memo does nothing at all.
  assert.equal(samePlantCard({ plant: plant() }, { plant: plant() }), true);
});

test('callback identity is ignored - the list makes new closures every render', () => {
  const a = { plant: plant(), onEdit: () => {} };
  const b = { plant: plant(), onEdit: () => {} };
  assert.equal(samePlantCard(a, b), true);
});

test('but gaining or losing onEdit redraws - it swaps the chevron for a pencil', () => {
  assert.equal(samePlantCard({ plant: plant() }, { plant: plant(), onEdit: () => {} }), false);
  assert.equal(samePlantCard({ plant: plant(), onEdit: () => {} }, { plant: plant() }), false);
});

/* --- the stale-card failures this must never allow --------------------- */

test('a renamed plant redraws', () => {
  // Nickname beats species beats the model's guess, and the card prints it.
  assert.equal(
    samePlantCard({ plant: plant() }, { plant: plant({ nickname: 'Big Fella' }) }),
    false
  );
});

test('a re-photographed plant redraws', () => {
  assert.equal(
    samePlantCard({ plant: plant() }, { plant: plant({ photoUri: 'file:///photos/new.jpg' }) }),
    false
  );
});

test('a plant whose condition changed redraws', () => {
  // The dot and its label are the most consequential thing on the row: a card
  // still reading "Healthy" for a plant just diagnosed critical is the worst
  // outcome this comparator can produce.
  const sick = plant();
  sick.diagnosis = { ...sick.diagnosis!, condition: 'critical', conditionLabel: 'Critical' };
  assert.equal(samePlantCard({ plant: plant() }, { plant: sick }), false);
});

test('a hand-added plant and a scanned one are never confused', () => {
  assert.equal(
    samePlantCard({ plant: plant() }, { plant: plant({ addedVia: 'manual' }) }),
    false
  );
});

test('a different plant entirely redraws', () => {
  assert.equal(samePlantCard({ plant: plant() }, { plant: plant({ id: 'p2' }) }), false);
});

/* --- schedule slots ---------------------------------------------------- */

test('a watered plant redraws - its slot label and countdown change', () => {
  const before = [slot({ label: 'Water today', daysUntilDue: 0, status: 'due' })];
  const after = [slot({ label: 'Water in 7 days', daysUntilDue: 7, status: 'ok' })];
  assert.equal(samePlantCard({ plant: plant(), slots: before }, { plant: plant(), slots: after }), false);
});

test('equal slots in new arrays count as unchanged', () => {
  // plantSchedule rebuilds these every render, so structural comparison is
  // the only thing that can ever be true here.
  assert.equal(sameSlots([slot()], [slot()]), true);
  assert.equal(
    samePlantCard({ plant: plant(), slots: [slot()] }, { plant: plant(), slots: [slot()] }),
    true
  );
});

test('a plant that gained a schedule redraws', () => {
  assert.equal(samePlantCard({ plant: plant() }, { plant: plant(), slots: [slot()] }), false);
});

test('missing slots and an empty array are the same thing', () => {
  // The parent used to pass `?? []`, minting a fresh array per render; a card
  // with no schedule must not look changed because of it.
  assert.equal(samePlantCard({ plant: plant(), slots: [] }, { plant: plant() }), true);
});

test('slot order matters - the row draws them in order', () => {
  const a = [slot({ kind: 'water' }), slot({ kind: 'fertilizer' })];
  const b = [slot({ kind: 'fertilizer' }), slot({ kind: 'water' })];
  assert.equal(sameSlots(a, b), false);
});
