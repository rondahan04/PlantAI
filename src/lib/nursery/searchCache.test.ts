import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchCache,
  searchCacheKey,
  CACHE_KEY_PREFIX,
  DEFAULT_TTL_MS,
} from './searchCache.ts';
import type { CacheStorage } from './searchCache.ts';

/* A KV store that behaves like the device's, plus the two failure modes worth
 * testing: a throwing write (full disk) and a corrupt value. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  let failWrites = false;
  return {
    store: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (failWrites) throw new Error('disk full');
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
    } satisfies CacheStorage,
    map,
    failWrites: (on: boolean) => {
      failWrites = on;
    },
  };
}

const KEY = searchCacheKey('Monstera deliciosa', 32.0853, 34.7818, 10_000);

test('the key ignores case and whitespace but never the radius', () => {
  assert.equal(searchCacheKey('  Monstera Deliciosa ', 32.0853, 34.7818, 10_000), KEY);
  assert.notEqual(
    searchCacheKey('Monstera deliciosa', 32.0853, 34.7818, 25_000),
    KEY,
    'searching wider is a different question and must not hit the narrow result'
  );
});

/* ~110m of GPS drift while standing still should be one search, not two. */
test('the key rounds coordinates to three decimals', () => {
  assert.equal(searchCacheKey('monstera', 32.08531, 34.78179, 10_000), searchCacheKey('monstera', 32.08534, 34.78182, 10_000));
});

test('a written search reads back with both stamps intact', () => {
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store, now: () => 1_000 });

  cache.write(KEY, ['al-haderech'], 500);
  const hit = cache.read(KEY);

  assert.deepEqual(hit?.results, ['al-haderech']);
  assert.equal(hit?.at, 1_000, 'when this phone stored it');
  assert.equal(hit?.scrapedAt, 500, 'when the stock was actually checked - a different number');
});

test('a miss is null rather than a throw', () => {
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store });
  assert.equal(cache.read('never-searched'), null);
});

test('an entry past the TTL is a miss, and is dropped on the way out', () => {
  let clock = 1_000;
  const { store, map } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store, now: () => clock });

  cache.write(KEY, ['shop'], null);
  clock += DEFAULT_TTL_MS - 1;
  assert.ok(cache.read(KEY), 'still inside the day');

  clock += 2;
  assert.equal(cache.read(KEY), null, 'past the day');
  assert.equal(map.get(`${CACHE_KEY_PREFIX}${KEY}`), undefined, 'and not left on disk');
});

/* A clock that moved backwards - a timezone change, a manual set - must not
 * produce an entry that will not expire for a year. */
test('an entry stamped in the future is treated as a miss', () => {
  let clock = 10_000;
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store, now: () => clock });

  cache.write(KEY, ['shop'], null);
  clock = 5_000;
  assert.equal(cache.read(KEY), null);
});

test('corrupt JSON reads as a miss instead of throwing', () => {
  const { store } = fakeStorage({ [`${CACHE_KEY_PREFIX}${KEY}`]: '{not json' });
  const cache = createSearchCache<string[]>({ storage: store });
  assert.equal(cache.read(KEY), null);
});

test('an entry missing its stamp reads as a miss', () => {
  const { store } = fakeStorage({
    [`${CACHE_KEY_PREFIX}${KEY}`]: JSON.stringify({ results: ['shop'] }),
  });
  const cache = createSearchCache<string[]>({ storage: store });
  assert.equal(cache.read(KEY), null);
});

test('the oldest entry is evicted once the cap is reached', () => {
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store, maxEntries: 2 });

  cache.write('a', ['1'], null);
  cache.write('b', ['2'], null);
  cache.write('c', ['3'], null);

  assert.equal(cache.read('a'), null, 'oldest written is the one that goes');
  assert.ok(cache.read('b'));
  assert.ok(cache.read('c'));
});

/* Re-writing a key must renew its place in the queue, or a search the user
 * keeps repeating would be evicted while one they ran once survives. */
test('re-writing a key moves it to the back of the eviction queue', () => {
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store, maxEntries: 2 });

  cache.write('a', ['1'], null);
  cache.write('b', ['2'], null);
  cache.write('a', ['1 again'], null);
  cache.write('c', ['3'], null);

  assert.equal(cache.read('b'), null, 'b is now the least recently written');
  assert.deepEqual(cache.read('a')?.results, ['1 again']);
  assert.ok(cache.read('c'));
});

test('invalidate forgets one search and leaves the rest', () => {
  const { store } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store });

  cache.write('a', ['1'], null);
  cache.write('b', ['2'], null);
  cache.invalidate('a');

  assert.equal(cache.read('a'), null);
  assert.ok(cache.read('b'));
});

test('clear forgets every search', () => {
  const { store, map } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store });

  cache.write('a', ['1'], null);
  cache.write('b', ['2'], null);
  cache.clear();

  assert.equal(cache.read('a'), null);
  assert.equal(cache.read('b'), null);
  assert.equal(map.size, 0, 'the index goes too');
});

/* The search succeeded and the caller is holding the results. A full disk is
 * a reason to lose the cache, never a reason to fail the search. */
test('a storage failure during write is swallowed', () => {
  const { store, failWrites } = fakeStorage();
  const cache = createSearchCache<string[]>({ storage: store });

  failWrites(true);
  assert.doesNotThrow(() => cache.write(KEY, ['shop'], null));
  failWrites(false);
  assert.equal(cache.read(KEY), null, 'nothing was stored, so the next search scrapes');
});
