/*
 * The nursery search cache, as POLICY - what counts as the same search, how
 * long an answer is worth serving, and which entry is dropped when the shelf
 * is full. No native imports and no network, so `node --test` exercises the
 * whole thing with a fake clock and a fake store; services/nurseryService.ts
 * binds it to expo-sqlite, exactly as lib/care/genusCarePlan.ts is bound by
 * services/plants/genusCarePlans.ts.
 *
 * WHY THIS EXISTS AT ALL. The service already had a Map of in-flight promises,
 * which dedupes concurrent callers and survives roughly as long as the user
 * keeps the app open. It does not survive a relaunch, so the second search for
 * a plant the next morning paid the full wait again - even though the server
 * had the answer, and even though the phone had rendered it the night before.
 * This is the layer that makes the second search instant, and the tenth one
 * offline.
 */

/* The KV surface this needs, and nothing more - the same three synchronous
 * methods lib/care/genusCarePlan.ts asks for, so one adapter serves both. */
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/*
 * Bump the version segment to retire every stored entry at once. Worth doing
 * whenever the shape below changes: a stale row parsed under new rules is a
 * bug that only shows up on upgraded installs, which is the hardest place to
 * see it.
 */
export const CACHE_KEY_PREFIX = 'plantai.nurserysearch.v2.';
const INDEX_KEY = `${CACHE_KEY_PREFIX}index`;

/*
 * A day. Deliberately shorter than the server's week: this copy cannot be
 * invalidated by anyone but the phone holding it, so it should lag the durable
 * cache rather than outlive it. Long enough that "I looked this up yesterday"
 * opens instantly, short enough that a price is never presented as today's
 * when it is a week old - and the screen shows `scrapedAt` regardless, so the
 * user is never guessing which it is.
 */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/* Twenty searches is far more than a session uses, and each is a few KB of
 * JSON. The cap is here to stop a pathological run of distinct searches from
 * growing the store forever, not to ration anything. */
export const DEFAULT_MAX_ENTRIES = 20;

/*
 * The stored record. `scrapedAt` is the server's stamp - when the stock was
 * actually checked - and `at` is when THIS phone stored it. They are different
 * numbers and both matter: the TTL is measured on `at`, while `scrapedAt` is
 * what the screen shows the user, and a result served from the server's own
 * week-old row must not appear to have been checked the moment it arrived.
 */
export interface CachedSearch<T> {
  at: number;
  scrapedAt: number | null;
  results: T;
}

/*
 * The identity of a search. The radius is part of it, and leaving it out is
 * not a missed optimisation but a wrong answer: "search wider" asks a
 * different question, and would otherwise be handed the 10km result it was
 * trying to escape. Coordinates are fixed to three decimals - about 110m - so
 * standing still with a drifting GPS fix is one search rather than five.
 *
 * This must agree with the server's own searchKey and with the in-flight map
 * in the service. It is exported, and used by both, so they cannot drift.
 */
export function searchCacheKey(
  plant: string,
  lat: number,
  lng: number,
  radiusM: number
): string {
  return `${plant.trim().toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}|${Math.round(radiusM)}`;
}

const storageKey = (key: string) => `${CACHE_KEY_PREFIX}${key}`;

export interface SearchCacheDeps {
  storage: CacheStorage;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

/*
 * An index of stored keys, kept beside the entries.
 *
 * A KV store has no way to list what it holds, so without this there is no
 * way to evict anything and the store grows until the OS reclaims it. It is
 * read and rewritten on every write, which is cheap at twenty entries and is
 * the reason the cap is small.
 *
 * Deliberately tolerant: a corrupt index costs the cache, never the caller. It
 * is treated as empty, which orphans whatever it used to name - and an orphan
 * is a few KB that is never read again, not a wrong answer.
 */
function readIndex(storage: CacheStorage): string[] {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: CacheStorage, keys: string[]): void {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(keys));
  } catch {
    /* A failed index write leaves the entry readable and merely un-evictable.
     * Losing the cache over it would be the worse trade. */
  }
}

export function createSearchCache<T>(deps: SearchCacheDeps) {
  const {
    storage,
    now = Date.now,
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
  } = deps;

  function drop(key: string, index: string[]): string[] {
    try {
      storage.removeItem(storageKey(key));
    } catch {
      /* Nothing to do - the entry stays and expires again on the next read. */
    }
    return index.filter((k) => k !== key);
  }

  return {
    /*
     * A hit, or null. Expiry is enforced HERE rather than at write time: a
     * phone that is offline for a week should find its entries gone the moment
     * it asks, without needing to have been running to prune them.
     *
     * Every failure path returns null, which the caller already handles - it
     * is exactly what a cold cache looks like, and a scrape is the correct
     * response to both.
     */
    read(key: string): CachedSearch<T> | null {
      let raw: string | null;
      try {
        raw = storage.getItem(storageKey(key));
      } catch {
        return null;
      }
      if (!raw) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        drop(key, readIndex(storage));
        return null;
      }

      if (typeof parsed !== 'object' || parsed === null) return null;
      const entry = parsed as Partial<CachedSearch<T>>;
      if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
      if (entry.results === undefined) return null;

      /* A stamp from the future is a clock that moved backwards - a timezone
       * change, a manual set. Treated as a miss rather than as an entry that
       * will not expire for a year. */
      const age = now() - entry.at;
      if (age < 0 || age >= ttlMs) {
        writeIndex(storage, drop(key, readIndex(storage)));
        return null;
      }

      return {
        at: entry.at,
        scrapedAt: typeof entry.scrapedAt === 'number' ? entry.scrapedAt : null,
        results: entry.results as T,
      };
    },

    /*
     * Store a finished search, then bring the shelf back under its cap.
     *
     * The key is moved to the END of the index on every write, so the index is
     * in least-recently-written order and the oldest is simply the first. A
     * write that throws - a full disk - is swallowed: the caller has the
     * results in hand and the search succeeded, so failing it over a cache
     * miss on some future launch would be absurd.
     */
    write(key: string, results: T, scrapedAt: number | null): void {
      const entry: CachedSearch<T> = { at: now(), scrapedAt, results };
      try {
        storage.setItem(storageKey(key), JSON.stringify(entry));
      } catch {
        return;
      }

      let index = readIndex(storage).filter((k) => k !== key);
      index.push(key);
      while (index.length > maxEntries) {
        const oldest = index[0];
        if (oldest === undefined) break;
        index = drop(oldest, index);
      }
      writeIndex(storage, index);
    },

    /* Forget one search. The "Refresh" affordance on the results screen is a
     * user saying this answer is stale, and leaving the row behind would hand
     * them the same list from the next cold start. */
    invalidate(key: string): void {
      writeIndex(storage, drop(key, readIndex(storage)));
    },

    /* Every stored search, dropped. For sign-out: the searches someone ran are
     * theirs, and should not greet the next account on the same handset. */
    clear(): void {
      const index = readIndex(storage);
      for (const key of index) drop(key, index);
      try {
        storage.removeItem(INDEX_KEY);
      } catch {
        /* Same trade as above - an orphaned index is harmless. */
      }
    },
  };
}
