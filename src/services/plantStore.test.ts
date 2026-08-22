import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_KEY,
  QUARANTINE_KEY,
  LIBRARY_VERSION,
  createPlantStore,
  runMigrations,
  wateringHistory,
  MAX_WATERING_LOG,
  type StorageDeps,
} from './plantStore.ts';
import type { PlantDiagnosis } from '../types/index.ts';

/*
 * The store is the retention spine: everything a user comes back for lives
 * behind it. These tests are mostly about the two ways it can lose a library -
 * a write that silently doesn't land, and a blob that won't parse - because
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

/* Deterministic clock and ids - assertions on saved order need both fixed. */
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

test('newest plant comes first - a just-saved plant is what the user looks for', () => {
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

test('50 plants all survive - the library is not silently capped', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  for (let i = 0; i < 50; i++) store.save({ photoUri: `p${i}`, diagnosis });
  const r = store.load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 50);
});

test('a force-quit mid-write loses only the in-flight save, not the ones before it', () => {
  // Item 11 (E10): the write that was interrupted is reported as failed by the
  // read-back, but that must not touch the bytes already on disk from the
  // saves that came before it.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  for (let i = 0; i < 25; i++) store.save({ photoUri: `p${i}`, diagnosis });

  s.breakWrites('throw'); // simulates the process dying mid setItem
  const interrupted = store.save({ photoUri: 'p25-interrupted', diagnosis });
  assert.equal(interrupted.ok, false);

  s.fixWrites();
  const afterRelaunch = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(afterRelaunch.ok, true);
  assert.equal(afterRelaunch.plants.length, 25, 'the 25 confirmed saves survive the crash');
  assert.ok(!afterRelaunch.plants.some((p) => p.photoUri === 'p25-interrupted'));
});

test('saving resumes normally after a force-quit, reaching the full count', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  for (let i = 0; i < 25; i++) store.save({ photoUri: `p${i}`, diagnosis });

  s.breakWrites('throw');
  store.save({ photoUri: 'lost-to-crash', diagnosis });
  s.fixWrites();

  const resumed = createPlantStore(s.deps, fixedOpts());
  for (let i = 25; i < 50; i++) resumed.save({ photoUri: `p${i}`, diagnosis });

  const r = resumed.load();
  assert.equal(r.ok, true);
  assert.equal(r.plants.length, 50, 'all 50 intended saves are readable after resuming');
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

test('replace() overwrites the whole library and persists it', () => {
  const { deps, data } = fakeStorage();
  const store = createPlantStore(deps, fixedOpts());

  const first = store.save({ photoUri: 'a.jpg', diagnosis }).ok
    ? store.load().plants
    : [];
  assert.equal(first.length, 1);

  const incoming = [
    { id: 'cloud-1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'b.jpg', diagnosis },
    { id: 'cloud-2', savedAt: '2026-08-02T00:00:00.000Z', photoUri: 'c.jpg', diagnosis },
  ];
  const result = store.replace(incoming);
  assert.equal(result, true);

  const reloaded = store.load();
  assert.equal(reloaded.ok, true);
  assert.deepEqual(reloaded.plants.map((p) => p.id), ['cloud-1', 'cloud-2']);
  assert.ok(data.get(LIBRARY_KEY)?.includes('cloud-1'));
});

test('replace() returns false and does not persist when the write does not land', () => {
  const { deps, breakWrites } = fakeStorage();
  const store = createPlantStore(deps, fixedOpts());
  breakWrites('throw');

  const result = store.replace([{ id: 'x', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'a.jpg', diagnosis }]);
  assert.equal(result, false);
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

test('truncated JSON is distinguishable from a real empty library', () => {
  // Item 11 (E10): "you have no plants" and "your library broke" must not
  // collapse into the same shape, or the UI cannot tell a new user from a
  // corrupted one.
  const truncated = createPlantStore(
    fakeStorage({ [LIBRARY_KEY]: '{"version":1,"plants":[{"id":"x"' }).deps,
    fixedOpts()
  ).load();
  const empty = createPlantStore(fakeStorage().deps, fixedOpts()).load();

  assert.equal(truncated.ok, false);
  assert.equal(truncated.ok === false && truncated.reason, 'corrupt');
  assert.equal(empty.ok, true);
  assert.notEqual(truncated.ok, empty.ok, 'the two cases must be told apart');
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

test('load is synchronous - the adaptive Home reads it before first paint', () => {
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

// ─── Migration chain (item 6) ─────────────────────────────────────────────────

/*
 * There are no real migrations yet - v1 is current. A no-op chain cannot be
 * proven to work by running it, so these inject fake steps and assert on the
 * mechanism. The point is that when v2 arrives the runner is already trusted.
 */

test('a library already at the current version is returned untouched', () => {
  const lib = { version: 3, plants: [] };
  assert.equal(runMigrations(lib, {}, 3), lib);
});

test('a single step upgrades one version', () => {
  const steps = { 1: (l: any) => ({ ...l, plants: [...l.plants, 'added-by-v2'] }) };
  const out = runMigrations({ version: 1, plants: [] }, steps, 2);
  assert.equal(out.version, 2);
  assert.deepEqual(out.plants, ['added-by-v2']);
});

test('steps chain v1 → v2 → v3 in order, not skipping the middle', () => {
  const seen: number[] = [];
  const steps = {
    1: (l: any) => (seen.push(1), l),
    2: (l: any) => (seen.push(2), l),
  };
  const out = runMigrations({ version: 1, plants: [] }, steps, 3);
  assert.deepEqual(seen, [1, 2], 'every intermediate step must run');
  assert.equal(out.version, 3);
});

test('a blob with no version is treated as v1 - it predates versioning', () => {
  const steps = { 1: (l: any) => ({ ...l, migrated: true }) };
  const out = runMigrations({ plants: [] } as any, steps, 2);
  assert.equal((out as any).migrated, true);
});

test('a missing step for a version in the chain is a hard error, not a silent skip', () => {
  // Silently jumping the gap would hand later code a shape no migration ever
  // produced, which is worse than refusing to load.
  assert.throws(() => runMigrations({ version: 1, plants: [] }, {}, 3), /no migration/i);
});

test('load() runs the chain and PERSISTS the result', () => {
  // Without the write-back, every launch re-migrates: slow, and it hides a
  // broken step behind a result that looks right in memory.
  const s = fakeStorage({
    [LIBRARY_KEY]: JSON.stringify({ version: 1, plants: [] }),
  });
  const store = createPlantStore(s.deps, {
    ...fixedOpts(),
    migrations: { 1: (l: any) => ({ ...l, plants: [] }) },
    targetVersion: 2,
  });

  assert.equal(store.load().ok, true);
  assert.equal(JSON.parse(s.data.get(LIBRARY_KEY)!).version, 2, 'migrated blob must be written back');
});

test('a throwing migration quarantines rather than leaving half-migrated data', () => {
  const s = fakeStorage({ [LIBRARY_KEY]: JSON.stringify({ version: 1, plants: [] }) });
  const store = createPlantStore(s.deps, {
    ...fixedOpts(),
    migrations: { 1: () => { throw new Error('bad step'); } },
    targetVersion: 2,
  });

  const r = store.load();
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'corrupt');
  assert.ok(s.data.get(QUARANTINE_KEY), 'the pre-migration bytes must be preserved');
});

// ─── Watering schedule ───────────────────────────────────────────────────────
//
// `markWatered` is the only write a user makes to a plant after saving it, and
// it is the anchor the whole reminder hangs off. A watering that does not land
// means the app keeps telling someone their plant is overdue after they watered
// it - so it goes through the same confirmed persist as everything else here.

test('logging a watering persists and survives a relaunch', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  assert.equal(saved.ok, true);
  const id = saved.ok && saved.plant.id;

  const watered = store.markWatered(id as string, Date.parse('2026-08-18T09:00:00.000Z'));
  assert.equal(watered.ok, true);
  assert.equal(watered.ok && watered.plant.lastWateredAt, '2026-08-18T09:00:00.000Z');

  const reloaded = createPlantStore(s.deps, fixedOpts()).load();
  assert.equal(reloaded.plants[0].lastWateredAt, '2026-08-18T09:00:00.000Z');
});

test('a fresh plant has no watering date - the app must not invent one', () => {
  // Defaulting to savedAt would claim the user watered the plant the day they
  // photographed it, and the entire schedule would rest on that invention.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  assert.equal(saved.ok && 'lastWateredAt' in saved.plant, false);
});

test('watering again moves the date forward', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.markWatered(id as string, Date.parse('2026-08-01T09:00:00.000Z'));
  store.markWatered(id as string, Date.parse('2026-08-18T09:00:00.000Z'));
  assert.equal(store.load().plants[0].lastWateredAt, '2026-08-18T09:00:00.000Z');
});

test('watering clears the reminder it replaces', () => {
  // The stored handle points at a notification scheduled for a due date this
  // watering just moved. Keeping it fires a reminder for a watered plant.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.update(id as string, { reminderId: 'notif-1' });
  assert.equal(store.load().plants[0].reminderId, 'notif-1');

  store.markWatered(id as string);
  assert.equal('reminderId' in store.load().plants[0], false);
});

test('an explicit undefined clears a field rather than being ignored', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.update(id as string, { reminderId: 'notif-1' });
  store.update(id as string, { reminderId: undefined });
  assert.equal('reminderId' in store.load().plants[0], false, 'a dangling handle is worse than none');
});

test('update repoints a photo at its persisted copy', () => {
  // Item 9: the plant is saved synchronously with the camera's cache URI, then
  // repointed once the copy into the document directory lands.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///cache/temp.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.update(id as string, { photoUri: 'file:///doc/plant-photos/p.jpg' });

  assert.equal(store.load().plants[0].photoUri, 'file:///doc/plant-photos/p.jpg');
});

test('update never clears the photo, even when handed an explicit undefined', () => {
  // Unlike the optional fields, photoUri is required: writing undefined over it
  // produces a record that fails validation and disappears on the next load.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.update(id as string, { photoUri: undefined });

  const plants = store.load().plants;
  assert.equal(plants.length, 1, 'the plant survived');
  assert.equal(plants[0].photoUri, 'file:///a.jpg');
});

test('updating one plant leaves the others untouched', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const second = store.save({ photoUri: 'file:///b.jpg', diagnosis });
  const id = second.ok && (second.plant.id as string);

  store.markWatered(id as string, Date.parse('2026-08-18T09:00:00.000Z'));

  const plants = store.load().plants;
  assert.equal(plants.length, 2);
  assert.equal(plants.filter((p) => p.lastWateredAt).length, 1);
});

test('watering a plant that is no longer saved reports it, rather than resurrecting it', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const r = store.markWatered('plant-does-not-exist');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'not_found');
  assert.equal(store.load().plants.length, 0);
});

test('a watering that cannot be written is reported, never silently lost', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  s.breakWrites('silent');
  const r = store.markWatered(id as string);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'storage_full');
  assert.equal('lastWateredAt' in store.load().plants[0], false, 'nothing landed, nothing claimed');
});

test('a plant saved before watering existed still loads', () => {
  // Every library written before this field is exactly this shape.
  const s = fakeStorage({
    [LIBRARY_KEY]: JSON.stringify({
      version: LIBRARY_VERSION,
      plants: [{ id: 'old-1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'file:///a.jpg', diagnosis }],
    }),
  });
  const store = createPlantStore(s.deps, fixedOpts());
  const loaded = store.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.plants.length, 1);
  assert.equal(loaded.plants[0].lastWateredAt, undefined);

  // ...and can start a schedule from today without a migration.
  assert.equal(store.markWatered('old-1').ok, true);
});

// ─── Watering history ────────────────────────────────────────────────────────
//
// The log is what the calendar draws. It is append-only from the app's side, so
// the failure that matters is a lost or duplicated entry - both show up as a
// calendar that quietly disagrees with what the user remembers doing.

test('every watering is appended, newest first', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.markWatered(id as string, Date.parse('2026-08-01T09:00:00.000Z'));
  store.markWatered(id as string, Date.parse('2026-08-09T09:00:00.000Z'));
  store.markWatered(id as string, Date.parse('2026-08-18T09:00:00.000Z'));

  const log = store.load().plants[0].wateringLog;
  assert.deepEqual(log, [
    '2026-08-18T09:00:00.000Z',
    '2026-08-09T09:00:00.000Z',
    '2026-08-01T09:00:00.000Z',
  ]);
});

test('two waterings on the same day count once', () => {
  // The calendar draws one square either way, so a duplicate is invisible
  // there and surfaces only as a wrong total - the quietest kind of wrong.
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  store.markWatered(id as string, Date.parse('2026-08-18T08:00:00.000Z'));
  store.markWatered(id as string, Date.parse('2026-08-18T20:00:00.000Z'));

  const plant = store.load().plants[0];
  assert.equal(plant.wateringLog?.length, 1, 'one entry for the day');
  assert.equal(plant.lastWateredAt, '2026-08-18T20:00:00.000Z', 'the later time wins');
});

test('the log is bounded so the library blob cannot grow without limit', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);

  const start = Date.parse('2020-01-01T09:00:00.000Z');
  for (let i = 0; i < MAX_WATERING_LOG + 25; i++) {
    store.markWatered(id as string, start + i * 86_400_000);
  }

  const log = store.load().plants[0].wateringLog!;
  assert.equal(log.length, MAX_WATERING_LOG);
  assert.equal(log[0], new Date(start + (MAX_WATERING_LOG + 24) * 86_400_000).toISOString(),
    'the newest entry is kept, the oldest is dropped');
});

test('history folds in a plant watered before the log existed', () => {
  // Otherwise these plants open an empty calendar, which reads as data loss.
  const legacy = {
    id: 'old-1',
    savedAt: '2026-08-01T00:00:00.000Z',
    photoUri: 'file:///a.jpg',
    diagnosis,
    lastWateredAt: '2026-08-10T09:00:00.000Z',
  };
  assert.deepEqual(wateringHistory(legacy), ['2026-08-10T09:00:00.000Z']);
});

test('history is empty for a plant that was never watered', () => {
  assert.deepEqual(
    wateringHistory({ id: 'x', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'f', diagnosis }),
    []
  );
});

test('history drops unreadable entries rather than passing NaN to the calendar', () => {
  const plant = {
    id: 'x',
    savedAt: '2026-08-01T00:00:00.000Z',
    photoUri: 'f',
    diagnosis,
    wateringLog: ['2026-08-10T09:00:00.000Z', 'last tuesday', ''],
    lastWateredAt: '2026-08-10T09:00:00.000Z',
  };
  assert.deepEqual(wateringHistory(plant), ['2026-08-10T09:00:00.000Z'], 'deduped and cleaned');
});

test('history is sorted newest first even if the stored log is not', () => {
  const plant = {
    id: 'x',
    savedAt: '2026-08-01T00:00:00.000Z',
    photoUri: 'f',
    diagnosis,
    wateringLog: ['2026-08-01T09:00:00.000Z', '2026-08-18T09:00:00.000Z', '2026-08-09T09:00:00.000Z'],
  };
  assert.deepEqual(wateringHistory(plant), [
    '2026-08-18T09:00:00.000Z',
    '2026-08-09T09:00:00.000Z',
    '2026-08-01T09:00:00.000Z',
  ]);
});

test('a watering that fails to persist leaves the log untouched', () => {
  const s = fakeStorage();
  const store = createPlantStore(s.deps, fixedOpts());
  const saved = store.save({ photoUri: 'file:///a.jpg', diagnosis });
  const id = saved.ok && (saved.plant.id as string);
  store.markWatered(id as string, Date.parse('2026-08-01T09:00:00.000Z'));

  s.breakWrites('silent');
  assert.equal(store.markWatered(id as string, Date.parse('2026-08-09T09:00:00.000Z')).ok, false);

  s.fixWrites();
  assert.deepEqual(store.load().plants[0].wateringLog, ['2026-08-01T09:00:00.000Z']);
});
