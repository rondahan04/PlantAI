import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIUM_IDS } from './soilMedia.ts';
import {
  CACHE_KEY_PREFIX,
  cacheKeyFor,
  createGenusCarePlanCache,
  isGenusCarePlan,
  parseGenusCarePlan,
  type GenusCarePlan,
} from './genusCarePlan.ts';

function soilPlan(days: number) {
  return {
    water: 'Water when the top third dries out.',
    waterEveryDays: days,
    waterEveryDaysMax: days + 3,
    fertilizer: 'Balanced feed at half strength.',
    fertilizeEveryDays: 21,
    light: 'Bright indirect.',
    humidity: '60% and up.',
    warnings: [],
  };
}

function fullPlan(genus = 'Alocasia'): GenusCarePlan {
  const bySoil: Record<string, unknown> = {};
  SOIL_MEDIUM_IDS.forEach((id, i) => (bySoil[id] = soilPlan(5 + i)));
  return {
    genus,
    family: 'Aroids',
    fetchedAt: '2026-08-29T00:00:00.000Z',
    bySoil: bySoil as GenusCarePlan['bySoil'],
  };
}

test('a plan covering every medium is valid', () => {
  assert.equal(isGenusCarePlan(fullPlan()), true);
});

test('a plan missing one medium is rejected', () => {
  const plan = fullPlan();
  delete (plan.bySoil as Record<string, unknown>).pon;
  assert.equal(isGenusCarePlan(plan), false);
});

test('a soil plan without a numeric interval is rejected', () => {
  const plan = fullPlan();
  (plan.bySoil.leca as Record<string, unknown>).waterEveryDays = 'about a week';
  assert.equal(isGenusCarePlan(plan), false);
});

test('parseGenusCarePlan stamps genus, family and fetchedAt from the request', () => {
  const raw = { bySoil: fullPlan().bySoil };
  const parsed = parseGenusCarePlan(raw, {
    genus: 'Monstera',
    family: 'Aroids',
    now: () => Date.parse('2026-08-29T10:00:00.000Z'),
  });
  assert.equal(parsed.genus, 'Monstera');
  assert.equal(parsed.family, 'Aroids');
  assert.equal(parsed.fetchedAt, '2026-08-29T10:00:00.000Z');
});

test('parseGenusCarePlan throws on a partial response rather than caching it', () => {
  assert.throws(
    () => parseGenusCarePlan({ bySoil: { leca: soilPlan(5) } }, { genus: 'Alocasia', family: 'Aroids' }),
    /care plan/i
  );
});

test('cacheKeyFor is case-insensitive on the genus', () => {
  assert.equal(cacheKeyFor('Alocasia', 'en'), cacheKeyFor('alocasia', 'en'));
  assert.ok(cacheKeyFor('Alocasia', 'en').startsWith(CACHE_KEY_PREFIX));
});

test('a cached genus costs no fetch, even for a different species in it', async () => {
  const store = new Map<string, string>();
  let calls = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async (genus, family) => {
      calls++;
      return { bySoil: fullPlan(genus).bySoil };
    },
    now: () => 0,
  });

  const first = await cache.get('Alocasia', 'Aroids', 'en');
  const second = await cache.get('Alocasia', 'Aroids', 'en');

  assert.equal(calls, 1);
  assert.equal(first?.genus, 'Alocasia');
  assert.equal(second?.genus, 'Alocasia');
});

test('a failed fetch returns null and caches nothing, so a retry can succeed', async () => {
  const store = new Map<string, string>();
  let calls = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async (genus) => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return { bySoil: fullPlan(genus).bySoil };
    },
    now: () => 0,
  });

  assert.equal(await cache.get('Hoya', 'Hoyas', 'en'), null);
  assert.equal(store.size, 0);
  assert.notEqual(await cache.get('Hoya', 'Hoyas', 'en'), null);
  assert.equal(calls, 2);
});

test('peek reads the cache synchronously and never fetches', () => {
  const store = new Map<string, string>();
  store.set(cacheKeyFor('Alocasia', 'en'), JSON.stringify(fullPlan()));
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async () => {
      throw new Error('peek must not fetch');
    },
    now: () => 0,
  });

  assert.equal(cache.peek('Alocasia', 'en')?.genus, 'Alocasia');
  assert.equal(cache.peek('Ficus', 'en'), null);
});

test('a corrupt cache entry is dropped rather than crashing the screen', () => {
  const store = new Map<string, string>([[cacheKeyFor('Alocasia', 'en'), '{not json']]);
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async () => ({ bySoil: fullPlan().bySoil }),
    now: () => 0,
  });

  assert.equal(cache.peek('Alocasia', 'en'), null);
  assert.equal(store.has(cacheKeyFor('Alocasia', 'en')), false);
});

/*
 * The forward-compatibility case, and the reason validation is all or nothing.
 *
 * An older build knew seven media and cached a plan covering exactly those. On
 * this build that entry is not "mostly right", it is a plan with a permanent
 * hole in it: the medium added since would render with no advice forever,
 * because a cache hit is exactly the thing that stops the refetch that would
 * repair it. So the stale entry has to read as a MISS and be replaced, not
 * merged - which is `isGenusCarePlan` refusing it and `peek` deleting it.
 */
test('a plan from an older app version, missing a medium added since, is refetched', async () => {
  const stale = fullPlan();
  const newestMedium = SOIL_MEDIUM_IDS[SOIL_MEDIUM_IDS.length - 1];
  delete (stale.bySoil as Record<string, unknown>)[newestMedium];

  const store = new Map<string, string>([[cacheKeyFor('Alocasia', 'en'), JSON.stringify(stale)]]);
  let calls = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async (genus) => {
      calls++;
      return { bySoil: fullPlan(genus).bySoil };
    },
    now: () => 0,
  });

  /* The hole is a miss, and the unusable entry is gone rather than left to be
   * re-read on the next launch. */
  assert.equal(cache.peek('Alocasia', 'en'), null);
  assert.equal(store.has(cacheKeyFor('Alocasia', 'en')), false);

  const fetched = await cache.get('Alocasia', 'Aroids', 'en');
  assert.equal(calls, 1);
  assert.ok(fetched);
  assert.equal(Object.keys(fetched.bySoil).length, SOIL_MEDIUM_IDS.length);
  /* And the replacement is now what a hit returns, so the refetch happens once
   * rather than on every render. */
  assert.equal(cache.peek('Alocasia', 'en')?.genus, 'Alocasia');
});

/*
 * A full disk must cost the user a later refetch, never the plan they are
 * looking at. The write is best effort precisely because the plan is already
 * in hand by the time it is attempted - throwing here, or returning null,
 * would turn a storage problem into a blank care screen in the one session
 * where the network call actually succeeded.
 */
test('a setItem that throws still returns the freshly fetched plan', async () => {
  let writes = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: () => null,
      setItem: () => {
        writes++;
        throw new Error('storage full');
      },
      removeItem: () => {},
    },
    fetchPlan: async (genus) => ({ bySoil: fullPlan(genus).bySoil }),
    now: () => 0,
  });

  const plan = await cache.get('Alocasia', 'Aroids', 'en');
  assert.equal(plan?.genus, 'Alocasia');
  assert.equal(writes, 1);
});

/*
 * Language in the cache key. Without it a user who switches to Hebrew reads
 * their own cached English plans forever, and the first Hebrew fetch
 * overwrites the English entry for every genus they own - so switching back
 * does not restore them either.
 */

test('two languages cannot share a cache entry', () => {
  assert.notEqual(cacheKeyFor('Monstera', 'en'), cacheKeyFor('Monstera', 'he'));
});

test('the key is still case and whitespace insensitive within a language', () => {
  assert.equal(cacheKeyFor('  Monstera ', 'he'), cacheKeyFor('monstera', 'he'));
});

test('the prefix bumped, so plans cached before languages existed are not served', () => {
  // A v1 entry holds English prose under a key a Hebrew reader would now hit.
  assert.match(cacheKeyFor('Monstera', 'en'), /v2/);
});
