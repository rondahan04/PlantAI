import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAvatarCache,
  parseAvatar,
  AVATAR_CACHE_KEY,
  type AvatarCacheDeps,
} from './avatarCache.ts';
import { DEFAULT_FOCUS_Y, DEFAULT_ZOOM } from '../../lib/media/photoFocus.ts';

/*
 * The snapshot exists so the first frame has a face on it. So the failures that
 * matter are the ones that would put the WRONG face there, or none - a path
 * that is not a path, a framing that crops to an edge, a blob that throws on
 * the way in.
 */

function fakeStorage(seed: string | null = null) {
  let value = seed;
  let writes = 0;
  let reads = 0;
  let mode: 'ok' | 'throw' = 'ok';

  const deps: AvatarCacheDeps = {
    getItem: () => {
      reads++;
      if (mode === 'throw') throw new Error('EIO');
      return value;
    },
    setItem: (_key, next) => {
      writes++;
      if (mode === 'throw') throw new Error('disk full');
      value = next;
    },
    removeItem: () => {
      writes++;
      if (mode === 'throw') throw new Error('disk full');
      value = null;
    },
  };

  return {
    deps,
    read: () => value,
    writes: () => writes,
    reads: () => reads,
    setMode: (m: typeof mode) => {
      mode = m;
    },
  };
}

const SNAP = { path: 'u1/abc123.jpg', focusY: 0.3, zoom: 1.5 };

// --- parsing --------------------------------------------------------------

test('a snapshot round-trips', () => {
  assert.deepEqual(parseAvatar(JSON.stringify(SNAP)), SNAP);
});

test('no path means no snapshot - a picture with no identity is not one', () => {
  assert.equal(parseAvatar(JSON.stringify({ focusY: 0.3, zoom: 1 })), null);
  assert.equal(parseAvatar(JSON.stringify({ path: '', focusY: 0.3 })), null);
  assert.equal(parseAvatar(JSON.stringify({ path: '   ' })), null);
  assert.equal(parseAvatar(JSON.stringify({ path: 42 })), null);
});

test('a corrupt or wrongly-shaped blob is forgotten, not thrown', () => {
  assert.equal(parseAvatar('not json'), null);
  assert.equal(parseAvatar('[1,2,3]'), null);
  assert.equal(parseAvatar('null'), null);
  assert.equal(parseAvatar('"a string"'), null);
  assert.equal(parseAvatar(null), null);
});

test('a missing framing falls back to what cover already did', () => {
  const parsed = parseAvatar(JSON.stringify({ path: 'u1/a.jpg' }));
  assert.deepEqual(parsed, { path: 'u1/a.jpg', focusY: DEFAULT_FOCUS_Y, zoom: DEFAULT_ZOOM });
});

test('a framing out of range is clamped, not rejected - the picture survives', () => {
  const parsed = parseAvatar(JSON.stringify({ path: 'u1/a.jpg', focusY: 9, zoom: 99 }));
  assert.equal(parsed?.path, 'u1/a.jpg');
  assert.ok(parsed!.focusY >= 0 && parsed!.focusY <= 1);
  assert.ok(parsed!.zoom >= 0.25 && parsed!.zoom <= 4);
});

// --- the cache ------------------------------------------------------------

test('a stored picture survives a relaunch', () => {
  const storage = fakeStorage();
  createAvatarCache(storage.deps).put(SNAP);

  assert.deepEqual(createAvatarCache(storage.deps).get(), SNAP);
});

test('storage is read once, not once per avatar drawn', () => {
  const storage = fakeStorage(JSON.stringify(SNAP));
  const cache = createAvatarCache(storage.deps);

  // Three avatars on screen, each re-rendering.
  for (let i = 0; i < 30; i++) cache.get();
  assert.equal(storage.reads(), 1);
});

test('put reports whether anything actually changed', () => {
  const storage = fakeStorage();
  const cache = createAvatarCache(storage.deps);

  assert.equal(cache.put(SNAP), true, 'first write is a change');
  assert.equal(cache.put({ ...SNAP }), false, 'an identical refresh is not');
  assert.equal(cache.put({ ...SNAP, focusY: 0.9 }), true, 'a reframing is');
  assert.equal(cache.put(null), true, 'a removal is');
  assert.equal(cache.put(null), false, 'removing nothing is not');
});

test('a no-op refresh does not write to storage', () => {
  const storage = fakeStorage();
  const cache = createAvatarCache(storage.deps);
  cache.put(SNAP);
  const after = storage.writes();

  for (let i = 0; i < 10; i++) cache.put({ ...SNAP });
  assert.equal(storage.writes(), after);
});

test('the framing is clamped on the way in as well as out', () => {
  const storage = fakeStorage();
  const cache = createAvatarCache(storage.deps);
  cache.put({ path: 'u1/a.jpg', focusY: -3, zoom: 0 });

  const held = cache.get();
  assert.ok(held!.focusY >= 0 && held!.focusY <= 1);
  assert.ok(held!.zoom >= 0.25);
});

test('clear leaves nothing behind for the next account on a shared device', () => {
  const storage = fakeStorage();
  const cache = createAvatarCache(storage.deps);
  cache.put(SNAP);

  cache.clear();
  assert.equal(cache.get(), null);
  assert.equal(storage.read(), null);
});

// --- storage that misbehaves ---------------------------------------------

test('an unreadable store degrades to having no picture', () => {
  const storage = fakeStorage(JSON.stringify(SNAP));
  storage.setMode('throw');
  assert.equal(createAvatarCache(storage.deps).get(), null);
});

test('a write that throws does not escape, and the session keeps the picture', () => {
  const storage = fakeStorage();
  const cache = createAvatarCache(storage.deps);
  storage.setMode('throw');

  assert.doesNotThrow(() => cache.put(SNAP));
  assert.deepEqual(cache.get(), SNAP);
});

test('the storage key is versioned so a future shape cannot be misread', () => {
  assert.match(AVATAR_CACHE_KEY, /\.v\d+$/);
});
