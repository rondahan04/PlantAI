import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_KEY,
  QUARANTINE_KEY,
  LIBRARY_VERSION,
  createPlantStore,
  type StorageDeps,
} from './plantStore.ts';
import type { PlantDiagnosis } from '../types/index.ts';

/*
 * The store is the retention spine: everything a user comes back for lives
 * behind it. These tests are mostly about the two ways it can lose a library —
 * a write that silently doesn't land, and a blob that won't parse — because
 * both fail invisibly in production and both look like "you have no plants".
 */

const diagnosis: PlantDiagnosis = {
  plantName: 'Mini monstera',
  scientificName: 'Rhaphidophora tetrasperma Hook.f.',
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: ['Brown leaf margins'],
  treatments: [{ title: 'Water', description: 'When dry.', urgent: false }],
  canBeSaved: true,
  confidence: 44,
  description: 'Some scorch.',
};

/* In-memory storage with hooks for the failures a real device produces. */
function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  let failWrites: 'throw' | 'silent' | null = null;

  const deps: StorageDeps = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      // A device out of space throws on some platforms and quietly drops the
      // write on others. Both must be caught, so both are modelled.
      if (failWrites === 'throw') throw new Error('SQLITE_FULL: database or disk is full');
      if (failWrites === 'silent') return;
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };

  return {
    deps,
    data,
    breakWrites: (mode: 'throw' | 'silent') => (failWrites = mode),
    fixWrites: () => (failWrites = null),
  };
}

/* Deterministic clock and ids — assertions on saved order need both fixed. */
function fixedOpts(startMs = 1_700_000_000_000) {
  let tick = 0;
  let seq = 0;
  return {
    now: () => startMs + tick++ * 1000,
    newId: () => `plant-${++seq}`,
  };
}

// ─── Round trip ───────────────────────────────────────────────────────────────

test('a saved plant survives a reload', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());

  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  assert.equal(saved.ok, true);

  // A second store over the same storage is what a relaunch actually is.
  const reloaded = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.plants.length, 1);
  assert.equal(reloaded.plants[0].diagnosis.scientificName, 'Rhaphidophora tetrasperma Hook.f.');
  assert.equal(reloaded.plants[0].photoUri, 'file:///a.jpg');
});

test('an empty store loads as an empty library, not an error', () => {
  const r = createPlantStore(fakeStorage().deps, fixedOpts()).load();
  assert.equal(r.ok, true);
  assert.deepEqual(r.plants, []);
});

test('newest plant comes first — a just-saved plant is what the user looks for', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  store.save({ photoUri: 'a', diagnosis });
  store.save({ photoUri: 'b', diagnosis });
  const r = store.load();
  assert.equal(r.ok, true);
  assert.deepEqual(r.plants.map((p) => p.photoUri), ['b', 'a']);
});

test('the persisted blob is versioned from the first write', () => {
  // Item 6's migrate() chain has nothing to hang off if v1 is unlabelled.
  const s = fakeStorage();
  createPlantStore(s.deps, fixedOpts()).save({ photoUri: 'a', diagnosis });
  assert.equal(JSON.parse(s.data.get(LIBRARY_KEY)!).version, LIBRARY_VERSION);
});

test('50 plants all survive — the library is not silently capped', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  for (let i = 0; i < 50; i++) store.save({ photoUri: `p${i}`, diagnosis });
  const r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 50);
});

test('remove deletes only the named plant', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const a = store.save({ photoUri: 'a', diagnosis });
  store.save({ photoUri: 'b', diagnosis });
  assert.equal(a.ok, true);

  const after = store.remove(a.ok ? a.plant.id : '');
  assert.equal(after.ok, true);
  const r = store.load();
  assert.equal(r.ok, true);
  assert.deepEqual(r.plants.map((p) => p.photoUri), ['b']);
});

test('removing an unknown id is a no-op, not a failure', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  store.save({ photoUri: 'a', diagnosis });
  assert.equal(store.remove('nope').ok, true);
  const r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 1);
});

// ─── Failure: the write that doesn't land ─────────────────────────────────────

test('a write that throws is reported, never silently swallowed', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  s.breakWrites('throw');

  const r = store.save({ photoUri: 'a', diagnosis });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'storage_full');
});

test('a write that silently does nothing is caught by reading it back', () => {
  // This is the failure the read-back exists for: no throw, no error, and the
  // plant is simply gone after relaunch. Trusting setItem is how a user loses
  // a library without ever seeing a message.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  s.breakWrites('silent');

  const r = store.save({ photoUri: 'a', diagnosis });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'storage_full');
});

test('a failed save leaves the existing library untouched', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  store.save({ photoUri: 'good', diagnosis });

  s.breakWrites('throw');
  assert.equal(store.save({ photoUri: 'lost', diagnosis }).ok, false);

  s.fixWrites();
  const r = store.load();
  assert.equal(r.ok, true);
  assert.deepEqual(r.plants.map((p) => p.photoUri), ['good']);
});

test('a retry after the disk frees up succeeds', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  s.breakWrites('throw');
  assert.equal(store.save({ photoUri: 'a', diagnosis }).ok, false);

  s.fixWrites();
  assert.equal(store.save({ photoUri: 'a', diagnosis }).ok, true);
  const r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 1);
});

// ─── Failure: the blob that won't parse ───────────────────────────────────────

test('truncated JSON reports corruption instead of an empty library', () => {
  // "You have no plants" is indistinguishable from a deletion the user did not
  // perform. The distinction has to reach the UI.
  const s = fakeStorage({ [LIBRARY_KEY]: '{"version":1,"plants":[{"id":"x"' });
  const r = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'corrupt');
});

test('corrupt data is quarantined, never destroyed', () => {
  const raw = '{"version":1,"plants":[{"id":"x"';
  const s = fakeStorage({ [LIBRARY_KEY]: raw });
  createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(s.data.get(QUARANTINE_KEY), raw, 'the bytes must still exist somewhere');
});

test('valid JSON of the wrong shape counts as corrupt', () => {
  const s = fakeStorage({ [LIBRARY_KEY]: '{"version":1,"plants":"not an array"}' });
  const r = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'corrupt');
});

test('individually broken plants are dropped, the rest of the library survives', () => {
  // Losing one unreadable entry beats declaring the whole library corrupt.
  const good = {
    id: 'p1',
    savedAt: '2026-01-01T00:00:00.000Z',
    photoUri: 'a',
    diagnosis,
  };
  const s = fakeStorage({
    [LIBRARY_KEY]: JSON.stringify({ version: 1, plants: [good, { id: 'broken' }, null] }),
  });
  const r = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 1);
  assert.equal(r.plants[0].id, 'p1');
});

test('the first quarantine is preserved when corruption happens twice', () => {
  // The earliest corrupt blob is the one closest to the user's real data;
  // overwriting it with later garbage destroys the better recovery candidate.
  const s = fakeStorage({ [LIBRARY_KEY]: 'first-corruption' });
  createPlantStore(s.deps, fixedOpts()).load();
  s.data.set(LIBRARY_KEY, 'second-corruption');
  createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(s.data.get(QUARANTINE_KEY), 'first-corruption');
});

test('saving still works after a corrupt library was quarantined', () => {
  // One bad blob must not lock the user out of their library forever.
  const s = fakeStorage({ [LIBRARY_KEY]: 'garbage' });
  const store = createPlantStore(s.deps, fixedOpts());
  assert.equal(store.load().ok, false);

  assert.equal(store.save({ photoUri: 'fresh', diagnosis }).ok, true);
  const r = store.load();
  assert.equal(r.ok, true);
  assert.deepEqual(r.plants.map((p) => p.photoUri), ['fresh']);
});

// ─── Failure: a blob from a future version ────────────────────────────────────

test('a library written by a NEWER app version is quarantined, not mangled', () => {
  // Downgrade path: parsing a v99 blob as v1 would drop fields the newer app
  // wrote and then persist the loss on the next save.
  const s = fakeStorage({
    [LIBRARY_KEY]: JSON.stringify({ version: LIBRARY_VERSION + 98, plants: [] }),
  });
  const r = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'future_version');
  assert.ok(s.data.get(QUARANTINE_KEY), 'the future blob must be preserved');
});

// ─── The D8 requirement ───────────────────────────────────────────────────────

test('load is synchronous — the adaptive Home reads it before first paint', () => {
  // D8 (adaptive Home) shows marketing content on first run and the library
  // afterwards. If the read were async, a returning user would see a frame of
  // marketing copy before their plants appeared.
  const s = fakeStorage();
  createPlantStore(s.deps, fixedOpts()).save({ photoUri: 'a', diagnosis });

  const result = createPlantStore(s.deps, fixedOpts()).load();
  assert.notEqual(
    typeof (result as unknown as Promise<unknown>).then,
    'function',
    'load() must not return a Promise'
  );
  assert.equal(result.ok, true);
});
