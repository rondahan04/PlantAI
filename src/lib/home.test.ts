import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './watering.ts';
import { greetingFor, needsCareCount, pickHeroPhoto, stripFaces, taskGroups, taskSubtitle } from './home.ts';
import type { DueItem } from './portfolio.ts';
import type { CareKind, StoredPlant } from '../services/plantStore.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

function plant(id: string, nickname: string, savedDaysAgo = 1, photo = true): StoredPlant {
  return {
    id,
    savedAt: new Date(NOW - savedDaysAgo * DAY_MS).toISOString(),
    photoUri: photo ? `file://${id}.jpg` : '',
    addedVia: 'manual',
    nickname,
  };
}

function due(p: StoredPlant, kind: CareKind, daysUntilDue: number): DueItem {
  return { plant: p, kind, daysUntilDue, label: `${kind} ${daysUntilDue}` };
}

test('greeting follows the clock, and the evening bucket runs to midnight', () => {
  assert.equal(greetingFor(0), 'evening');
  assert.equal(greetingFor(6), 'morning');
  assert.equal(greetingFor(11), 'morning');
  assert.equal(greetingFor(12), 'afternoon');
  assert.equal(greetingFor(17), 'afternoon');
  assert.equal(greetingFor(18), 'evening');
  assert.equal(greetingFor(23), 'evening');
});

test('tasks group by care kind, soonest group first', () => {
  const fern = plant('a', 'Fern');
  const monstera = plant('b', 'Monstera');
  const groups = taskGroups([
    due(fern, 'water', 0),
    due(monstera, 'fertilizer', 3),
    due(monstera, 'water', 2),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'water');
  assert.equal(groups[0].daysUntilDue, 0);
  assert.deepEqual(groups[0].plants.map((p) => p.id), ['a', 'b']);
  assert.equal(groups[1].kind, 'fertilizer');
});

test('a group takes the date of its most urgent member, whatever order it arrived in', () => {
  const a = plant('a', 'Aloe');
  const b = plant('b', 'Basil');
  const groups = taskGroups([due(a, 'water', 4), due(b, 'water', -2)]);
  assert.equal(groups[0].daysUntilDue, -2);
});

test('only two task cards ever come back', () => {
  const p = plant('a', 'Aloe');
  const groups = taskGroups([due(p, 'water', 0), due(p, 'fertilizer', 1), due(p, 'repot', 2)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.kind), ['water', 'fertilizer']);
});

test('the subtitle names one plant and counts the rest', () => {
  const others = (n: number) => `+ ${n} others`;
  const one = taskGroups([due(plant('a', 'Fern'), 'water', 0)])[0];
  assert.equal(taskSubtitle(one, others), 'Fern');

  const three = taskGroups([
    due(plant('a', 'Fern'), 'water', 0),
    due(plant('b', 'Monstera'), 'water', 0),
    due(plant('c', 'Pothos'), 'water', 0),
  ])[0];
  assert.equal(taskSubtitle(three, others), 'Fern + 2 others');
});

test('needs-care counts plants, not tasks, and ignores what is merely upcoming', () => {
  const a = plant('a', 'Aloe');
  const b = plant('b', 'Basil');
  const c = plant('c', 'Cactus');
  const count = needsCareCount([
    due(a, 'water', -3),
    due(a, 'fertilizer', 0), // same plant, still one plant behind on care
    due(b, 'water', 0),
    due(c, 'water', 5), // Friday's job is not today's problem
  ]);
  assert.equal(count, 2);
});

test('the strip shows three photographed plants, newest first, and counts the rest', () => {
  const plants = [
    plant('a', 'Aloe', 10),
    plant('b', 'Basil', 1),
    plant('c', 'Cactus', 5),
    plant('d', 'Dracaena', 2),
  ];
  const { shown, overflow } = stripFaces(plants);
  assert.deepEqual(shown.map((p) => p.id), ['b', 'd', 'c']);
  assert.equal(overflow, 1);
});

test('a plant with no photo is skipped on the strip but still counted', () => {
  const plants = [plant('a', 'Aloe', 1, false), plant('b', 'Basil', 2)];
  const { shown, overflow } = stripFaces(plants);
  assert.deepEqual(shown.map((p) => p.id), ['b']);
  assert.equal(overflow, 0);
});

// --- pickHeroPhoto: the hero card's face, re-rolled each visit -------------

test('pickHeroPhoto: no photographed plant means no photo, not a placeholder', () => {
  assert.equal(pickHeroPhoto([], 0.5), undefined);
  assert.equal(pickHeroPhoto([plant('a', 'A', 1, false)], 0.5), undefined);
});

test('pickHeroPhoto: the roll selects across the whole library, not just the newest', () => {
  const plants = [plant('a', 'A'), plant('b', 'B'), plant('c', 'C'), plant('d', 'D')];
  assert.equal(pickHeroPhoto(plants, 0), 'file://a.jpg');
  assert.equal(pickHeroPhoto(plants, 0.5), 'file://c.jpg');
  // A roll of exactly 1 must not index past the end.
  assert.equal(pickHeroPhoto(plants, 1), 'file://d.jpg');
});

test('pickHeroPhoto: never repeats the previous photo when another one exists', () => {
  const plants = [plant('a', 'A'), plant('b', 'B'), plant('c', 'C')];
  for (const roll of [0, 0.2, 0.5, 0.75, 0.99, 1]) {
    assert.notEqual(pickHeroPhoto(plants, roll, 'file://b.jpg'), 'file://b.jpg', `roll ${roll}`);
  }
});

test('pickHeroPhoto: a single photographed plant still shows, even as a repeat', () => {
  // The alternative is a card that empties itself on the second visit.
  const only = [plant('a', 'A'), plant('b', 'B', 1, false)];
  assert.equal(pickHeroPhoto(only, 0.4, 'file://a.jpg'), 'file://a.jpg');
});

test('pickHeroPhoto: plants with no picture are never chosen', () => {
  const mixed = [plant('a', 'A', 1, false), plant('b', 'B'), plant('c', 'C', 1, false)];
  for (const roll of [0, 0.33, 0.66, 1]) {
    assert.equal(pickHeroPhoto(mixed, roll), 'file://b.jpg');
  }
});
