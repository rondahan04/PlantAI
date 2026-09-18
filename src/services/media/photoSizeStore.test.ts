import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPhotoSizeStore,
  parseSizes,
  isUsableSize,
  PHOTO_SIZES_KEY,
  MAX_REMEMBERED,
  type SizeStorageDeps,
} from './photoSizeStore.ts';

/*
 * This store exists to get the FIRST frame right, so the failure that matters
 * is not losing a size - that just restores the old one-frame snap - but
 * returning a WRONG one, which pins a wrong crop in place permanently. Hence
 * the weight on what is refused.
 */

function fakeStorage(seed: string | null = null) {
  let value = seed;
  let writeMode: 'ok' | 'throw' = 'ok';
  let reads = 0;
  let writes = 0;

  const deps: SizeStorageDeps = {
    getItem: () => {
      reads++;
      return value;
    },
    setItem: (_key, next) => {
      writes++;
      if (writeMode === 'throw') throw new Error('disk full');
      value = next;
    },
  };

  return {
    deps,
    read: () => value,
    reads: () => reads,
    writes: () => writes,
    setWrite: (mode: typeof writeMode) => {
      writeMode = mode;
    },
  };
}

// --- what counts as a measurement -----------------------------------------

test('a size is only usable if both numbers are positive and finite', () => {
  assert.equal(isUsableSize({ width: 1600, height: 1200 }), true);
  assert.equal(isUsableSize({ width: 0, height: 1200 }), false);
  assert.equal(isUsableSize({ width: -4, height: 3 }), false);
  assert.equal(isUsableSize({ width: NaN, height: 3 }), false);
  assert.equal(isUsableSize({ width: '1600', height: 1200 }), false);
  assert.equal(isUsableSize(null), false);
  assert.equal(isUsableSize(undefined), false);
});

test('a failed measurement is refused rather than stored', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  sizes.remember('a', { width: 0, height: 0 });
  sizes.remember('b', { width: NaN, height: 10 });
  assert.equal(sizes.get('a'), undefined);
  assert.equal(sizes.get('b'), undefined);
  assert.equal(storage.writes(), 0);
});

test('an empty key is refused - it would collide with every other empty one', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  sizes.remember('', { width: 10, height: 10 });
  assert.equal(sizes.get(''), undefined);
});

// --- reading back ---------------------------------------------------------

test('a size survives a relaunch, which is the whole point', () => {
  const storage = fakeStorage();
  createPhotoSizeStore(storage.deps).remember('plants/u1/p1.jpg', { width: 1600, height: 1200 });

  const next = createPhotoSizeStore(storage.deps);
  assert.deepEqual(next.get('plants/u1/p1.jpg'), { width: 1600, height: 1200 });
});

test('storage is read once, not once per photo drawn', () => {
  const storage = fakeStorage(JSON.stringify({ a: { width: 4, height: 3 } }));
  const sizes = createPhotoSizeStore(storage.deps);

  // `get` runs during render, once per photo, on a scrolling list.
  for (let i = 0; i < 50; i++) sizes.get('a');
  assert.equal(storage.reads(), 1);
});

// --- corruption -----------------------------------------------------------

test('a corrupt blob is a forgotten optimisation, never a throw', () => {
  assert.equal(parseSizes('not json').size, 0);
  assert.equal(parseSizes('[1,2,3]').size, 0);
  assert.equal(parseSizes('null').size, 0);
  assert.equal(parseSizes(null).size, 0);
});

test('one damaged entry does not take the good ones with it', () => {
  const parsed = parseSizes(
    JSON.stringify({ good: { width: 4, height: 3 }, bad: { width: 0, height: 3 }, junk: 7 })
  );
  assert.deepEqual([...parsed.keys()], ['good']);
});

test('a read that throws degrades to knowing nothing', () => {
  const sizes = createPhotoSizeStore({
    getItem: () => {
      throw new Error('EIO');
    },
    setItem: () => {},
  });
  assert.equal(sizes.get('a'), undefined);
});

test('a write that throws does not escape into the onLoad that called it', () => {
  const storage = fakeStorage();
  storage.setWrite('throw');
  const sizes = createPhotoSizeStore(storage.deps);

  assert.doesNotThrow(() => sizes.remember('a', { width: 4, height: 3 }));
  // Still usable this session; it is only the next launch that forgets.
  assert.deepEqual(sizes.get('a'), { width: 4, height: 3 });
});

// --- write pressure -------------------------------------------------------

test('re-learning the same size writes nothing', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  sizes.remember('a', { width: 4, height: 3 });
  assert.equal(storage.writes(), 1);

  // onLoad fires again every time a list recycles the row under a thumb.
  for (let i = 0; i < 20; i++) sizes.remember('a', { width: 4, height: 3 });
  assert.equal(storage.writes(), 1);
});

test('a changed size overwrites - a replaced photo is a different picture', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  sizes.remember('a', { width: 4, height: 3 });
  sizes.remember('a', { width: 3, height: 4 });
  assert.deepEqual(sizes.get('a'), { width: 3, height: 4 });
  assert.equal(storage.writes(), 2);
});

// --- pruning --------------------------------------------------------------

test('the blob is capped, oldest-learnt first', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  for (let i = 0; i < MAX_REMEMBERED + 10; i++) {
    sizes.remember(`k${i}`, { width: 4, height: 3 });
  }
  assert.equal(sizes.size(), MAX_REMEMBERED);
  assert.equal(sizes.get('k0'), undefined, 'the oldest went');
  assert.deepEqual(sizes.get(`k${MAX_REMEMBERED + 9}`), { width: 4, height: 3 });
});

test('re-learning moves a photo to the young end of the cap', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);

  sizes.remember('keeper', { width: 4, height: 3 });
  for (let i = 0; i < MAX_REMEMBERED - 1; i++) sizes.remember(`k${i}`, { width: 4, height: 3 });
  // A new measurement for the oldest entry, which must not then be the first
  // one evicted by the next arrival.
  sizes.remember('keeper', { width: 8, height: 3 });
  sizes.remember('newcomer', { width: 4, height: 3 });

  assert.deepEqual(sizes.get('keeper'), { width: 8, height: 3 });
  assert.equal(sizes.get('k0'), undefined);
});

// --- sign-out -------------------------------------------------------------

test('clear empties the store and the blob behind it', () => {
  const storage = fakeStorage();
  const sizes = createPhotoSizeStore(storage.deps);
  sizes.remember('plants/u1/p1.jpg', { width: 4, height: 3 });

  sizes.clear();
  assert.equal(sizes.get('plants/u1/p1.jpg'), undefined);
  assert.equal(storage.read(), '{}');
});

test('the storage key is versioned, so a future shape cannot be misread', () => {
  assert.match(PHOTO_SIZES_KEY, /\.v\d+$/);
});
