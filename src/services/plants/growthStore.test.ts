import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROWTH_KEY, GROWTH_VERSION, createGrowthStore, type StorageDeps } from './growthStore.ts';

/*
 * The journal indexes files it does not own. Every test below is about one of
 * the two ways that goes wrong: the index outliving the files (a pruned plant,
 * a deleted entry) or the files outliving the index (a corrupt blob, a write
 * that never landed). The rule the store follows throughout is that a failure
 * to write must be REPORTED, never swallowed - a photo the user thinks they
 * saved is worse than one they know they did not.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T09:00:00.000Z');

function fakeStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  let failWrites: 'throw' | 'silent' | null = null;
  let failReads = false;

  const deps: StorageDeps = {
    getItem: (k) => {
      if (failReads) throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (failWrites === 'throw') throw new Error('SQLITE_FULL: database or disk is full');
      if (failWrites === 'silent') return;
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };

  return {
    deps,
    data,
    breakWrites: (mode: 'throw' | 'silent') => {
      failWrites = mode;
    },
    breakReads: () => {
      failReads = true;
    },
  };
}

/* Ids are minted by the store, so tests that need to name an entry make them
 * predictable rather than fishing the random one back out. */
function counter(prefix = 'e') {
  let n = 0;
  return () => `${prefix}${++n}`;
}

function makeStore(seed: Record<string, string> = {}) {
  const storage = fakeStorage(seed);
  const store = createGrowthStore(storage.deps, { now: () => T0, newId: counter() });
  return { store, storage };
}

test('a fresh install has an empty journal for every plant', () => {
  const { store } = makeStore();
  assert.deepEqual(store.entriesFor('p1'), []);
  assert.deepEqual(store.allPhotoIds(), []);
});

test('add returns the entry so the caller can name its photo file', () => {
  const { store } = makeStore();
  const result = store.add('p1', { photoUri: 'file:///cache/shot.jpg', note: '  new leaf  ' });
  assert.equal(result.ok, true);
  assert.equal(result.entry?.id, 'e1');
  assert.equal(result.entry?.note, 'new leaf');
  assert.equal(result.entry?.takenAt, new Date(T0).toISOString());
});

test('entries survive the round trip through storage, newest first', () => {
  const storage = fakeStorage();
  const newId = counter();
  let clock = T0;
  const store = createGrowthStore(storage.deps, { now: () => clock, newId });

  store.add('p1', { photoUri: 'file:///a.jpg' });
  clock = T0 + 5 * DAY;
  store.add('p1', { photoUri: 'file:///b.jpg' });

  const reread = createGrowthStore(storage.deps);
  assert.deepEqual(
    reread.entriesFor('p1').map((e) => e.id),
    ['e2', 'e1']
  );
});

test('one plant’s journal does not touch another’s', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });
  store.add('p2', { photoUri: 'file:///b.jpg' });

  assert.deepEqual(store.entriesFor('p1').map((e) => e.id), ['e1']);
  assert.deepEqual(store.entriesFor('p2').map((e) => e.id), ['e2']);

  store.discardPlant('p1');
  assert.deepEqual(store.entriesFor('p1'), []);
  assert.deepEqual(store.entriesFor('p2').map((e) => e.id), ['e2']);
});

test('deleting the last photo leaves no key behind', () => {
  const { store, storage } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });
  store.remove('p1', 'e1');

  const written = JSON.parse(storage.data.get(GROWTH_KEY) as string);
  assert.deepEqual(written, { version: GROWTH_VERSION, plants: {} });
});

test('setPhotoUri repoints one entry at the copy that landed', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///cache/a.jpg' });
  const result = store.setPhotoUri('p1', 'e1', 'file:///docs/growth-photos/e1.jpg');

  assert.equal(result.ok, true);
  assert.equal(store.entriesFor('p1')[0].photoUri, 'file:///docs/growth-photos/e1.jpg');
});

test('setPhotoUri on an entry deleted mid-copy resurrects nothing', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///cache/a.jpg' });
  store.remove('p1', 'e1');
  const result = store.setPhotoUri('p1', 'e1', 'file:///docs/growth-photos/e1.jpg');

  assert.equal(result.ok, true);
  assert.deepEqual(store.entriesFor('p1'), []);
});

test('editNote writes and clears, and clearing a photoless entry removes it', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });
  store.editNote('p1', 'e1', 'first flower');
  assert.equal(store.entriesFor('p1')[0].note, 'first flower');

  store.editNote('p1', 'e1', '');
  assert.equal(store.entriesFor('p1')[0].note, undefined);
  assert.equal(store.entriesFor('p1').length, 1, 'the photograph is still the record');

  /* An entry whose photo never made the crossing is held up by its note alone,
   * and goes only when the note goes too. */
  store.editNote('p1', 'e1', 'kept by the note');
  store.setPhotoUri('p1', 'e1', '');
  assert.equal(store.entriesFor('p1').length, 1);
  store.editNote('p1', 'e1', '');
  assert.deepEqual(store.entriesFor('p1'), [], 'nothing left to draw');
});

test('allPhotoIds names every file the journal still claims', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });
  store.add('p2', { photoUri: 'file:///b.jpg' });
  store.add('p2', { photoUri: 'file:///c.jpg' });
  /* An entry with no file must not appear - the sweep would keep a name that
   * matches nothing, which is harmless, but the list is also read as "how many
   * pictures are on this phone". */
  store.setPhotoUri('p2', 'e3', '');
  store.editNote('p2', 'e3', 'no picture');

  assert.deepEqual(store.allPhotoIds().sort(), ['e1', 'e2']);
});

test('prune forgets plants the library no longer holds', () => {
  const { store } = makeStore();
  store.add('kept', { photoUri: 'file:///a.jpg' });
  store.add('gone', { photoUri: 'file:///b.jpg' });

  assert.equal(store.prune(['kept'], { libraryReadable: true }), 1);
  assert.deepEqual(store.entriesFor('gone'), []);
  assert.equal(store.entriesFor('kept').length, 1);
  assert.equal(store.prune(['kept'], { libraryReadable: true }), 0, 'nothing left to drop');
});

test('prune REFUSES to run against a library that failed to load', () => {
  const { store } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });

  /* An unreadable library reports zero plants. Pruning on that would delete
   * every journal the user owns. */
  assert.equal(store.prune([], { libraryReadable: false }), 0);
  assert.equal(store.entriesFor('p1').length, 1);
});

test('a corrupt blob reads as empty rather than throwing the screen away', () => {
  const { store } = makeStore({ [GROWTH_KEY]: '{not json' });
  assert.deepEqual(store.entriesFor('p1'), []);

  /* And the next write is accepted: the journal is an index of files, not the
   * files, so there is nothing here worth quarantining the way the library is. */
  assert.equal(store.add('p1', { photoUri: 'file:///a.jpg' }).ok, true);
  assert.equal(store.entriesFor('p1').length, 1);
});

test('a blob from a newer build is left alone, not mangled', () => {
  const future = JSON.stringify({
    version: GROWTH_VERSION + 1,
    plants: { p1: [{ id: 'x', takenAt: new Date(T0).toISOString(), photoUri: 'file:///a.jpg' }] },
  });
  const { store } = makeStore({ [GROWTH_KEY]: future });
  assert.deepEqual(store.entriesFor('p1'), [], 'a shape this build cannot read is not read');
});

test('one damaged plant list does not cost the others', () => {
  const seed = JSON.stringify({
    version: GROWTH_VERSION,
    plants: {
      broken: 'not an array',
      fine: [{ id: 'x', takenAt: new Date(T0).toISOString(), photoUri: 'file:///a.jpg' }],
    },
  });
  const { store } = makeStore({ [GROWTH_KEY]: seed });
  assert.deepEqual(store.entriesFor('broken'), []);
  assert.deepEqual(store.entriesFor('fine').map((e) => e.id), ['x']);
});

test('a write that throws is reported, not swallowed', () => {
  const { store, storage } = makeStore();
  storage.breakWrites('throw');
  assert.deepEqual(store.add('p1', { photoUri: 'file:///a.jpg' }), {
    ok: false,
    reason: 'storage_full',
  });
});

test('a write that silently no-ops is caught by the read-back', () => {
  const { store, storage } = makeStore();
  storage.breakWrites('silent');
  const result = store.add('p1', { photoUri: 'file:///a.jpg' });
  assert.equal(result.ok, false);
  assert.equal(store.entriesFor('p1').length, 0);
});

test('a storage that cannot be read at all reports empty', () => {
  const { store, storage } = makeStore();
  storage.breakReads();
  assert.deepEqual(store.entriesFor('p1'), []);
  assert.deepEqual(store.allPhotoIds(), []);
});

test('wipeAll forgets every journal on the device', () => {
  const { store, storage } = makeStore();
  store.add('p1', { photoUri: 'file:///a.jpg' });
  store.add('p2', { photoUri: 'file:///b.jpg' });

  store.wipeAll();
  assert.equal(storage.data.has(GROWTH_KEY), false, 'the key itself goes, not an empty blob');
  assert.deepEqual(store.entriesFor('p1'), []);
  assert.deepEqual(store.allPhotoIds(), []);

  /* And the store still works afterwards - deletion is not a one-way door for
   * someone who signs up again on the same phone. */
  assert.equal(store.add('p3', { photoUri: 'file:///c.jpg' }).ok, true);
});
