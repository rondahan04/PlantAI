import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './care/watering.ts';
import {
  gardenState,
  greetingFor,
  needsCareCount,
  pickHeroPhoto,
  stripFaces,
  taskGroups,
  taskSubtitle,
} from './home.ts';
import type { DueItem } from './portfolio.ts';
import type { CareKind, StoredPlant } from '../services/plants/plantStore.ts';

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

// --- gardenState: unreadable outranks empty --------------------------------
//
// Home's three reassuring lines - "Start your garden with one photo.", "No
// plants yet.", "Nothing due this week. Your plants are set." - are only true
// if the library actually LOADED. plantStore returns `plants: []` on every
// failure path, so a corrupt blob and a genuinely new user are byte-identical
// at the `.plants` level and only `ok` tells them apart.
//
// PortfolioScreen already refuses to conflate them: "A damaged library must
// never be reported as an empty one - 'you have no plants' is
// indistinguishable from a deletion the user never performed." Home is the
// FIRST screen and said it three times over.

test('a damaged library is unreadable, never empty', () => {
  assert.deepEqual(gardenState({ ok: false, reason: 'corrupt', plants: [] }), {
    kind: 'unreadable',
    reason: 'corrupt',
  });
});

test('a future-version library is unreadable too, and keeps its own reason', () => {
  /* The two need different copy: one is damaged, the other is intact data this
   * build is too old to read, and telling a user their data is corrupt when the
   * fix is "update the app" is its own wrong answer. */
  assert.deepEqual(gardenState({ ok: false, reason: 'future_version', plants: [] }), {
    kind: 'unreadable',
    reason: 'future_version',
  });
});

test('unreadable wins even when some plants survived', () => {
  /* LoadResult carries plants on the failure branch too. Today every failure
   * path returns [], but the type permits a partial read, and a partial library
   * must not be presented as the whole garden. */
  assert.deepEqual(
    gardenState({ ok: false, reason: 'corrupt', plants: [plant('a', 'Fern')] }),
    { kind: 'unreadable', reason: 'corrupt' }
  );
});

test('a genuinely new user is empty, not unreadable', () => {
  assert.deepEqual(gardenState({ ok: true, plants: [] }), { kind: 'empty' });
});

test('a library that loaded with plants is ready', () => {
  assert.deepEqual(gardenState({ ok: true, plants: [plant('a', 'Fern')] }), { kind: 'ready' });
});

// --- stripFaces: a broken photo is as absent as a missing one --------------

test('a plant whose photo failed to load is skipped like one with no photo', () => {
  /*
   * stripFaces already refuses to draw a plant with no photoUri, and says why:
   * "the strip is meant to be recognisable at 40pt, and a row of grey boxes is
   * not." A broken or expired URL is truthy, so it walked straight past that
   * guard and produced the grey box the guard exists to prevent. Signed URLs
   * carry a TTL, so this is the expiry case, not a hypothetical.
   */
  const a = plant('a', 'Fern', 1);
  const b = plant('b', 'Ivy', 2);
  const c = plant('c', 'Palm', 3);
  const d = plant('d', 'Oak', 4);
  const { shown } = stripFaces([a, b, c, d], 3, new Set([b.photoUri]));
  assert.deepEqual(shown.map((p) => p.id), ['a', 'c', 'd']);
});

test('the overflow count still describes the whole library, not the drawable part', () => {
  /* The "+n" is about how many plants the user has, not how many rendered. A
   * failed photo must not quietly shrink the number the strip reports. */
  const plants = [1, 2, 3, 4, 5].map((n) => plant(String(n), `P${n}`, n));
  const { overflow } = stripFaces(plants, 3, new Set([plants[1].photoUri]));
  assert.equal(overflow, 2);
});

test('with no failures the strip behaves exactly as before', () => {
  const plants = [1, 2, 3, 4].map((n) => plant(String(n), `P${n}`, n));
  assert.deepEqual(stripFaces(plants, 3).shown.map((p) => p.id), ['1', '2', '3']);
  assert.deepEqual(stripFaces(plants, 3, new Set()).shown.map((p) => p.id), ['1', '2', '3']);
});
