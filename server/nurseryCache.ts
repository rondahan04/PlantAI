/*
 * Durable cache for finished nursery scrapes (Supabase table
 * `public.nursery_searches`).
 *
 * WHY. `jobs.ts` already dedupes identical requests, but only for the ten
 * minutes it retains a finished job - a user who diagnoses a plant today and
 * comes back for the treatment tomorrow pays the full eight-minute scrape
 * again, for an answer we already had. This is the layer that survives that
 * gap, and a process restart with it.
 *
 * Two rules run through everything below:
 *
 *   1. The cache NEVER fails a scrape. Every network error, bad status and
 *      malformed row resolves to a miss, which costs a scrape - the failure
 *      mode of the alternative is an error screen for a user whose answer was
 *      minutes away.
 *   2. It is optional. With no service-role key configured the module is a
 *      no-op and the server behaves exactly as it did before - local dev does
 *      not need Supabase to work on the scraper.
 *
 * PostgREST is called over plain `fetch` rather than through supabase-js: two
 * requests, no client bundle, and `fetch` is trivially injectable for the
 * tests.
 */

export interface CacheHit<T> {
  results: T;
  scrapedAt: number;
}

export interface SearchParts {
  query: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/*
 * The identity of a search. Coordinates are rounded to three decimals (~100m)
 * because a finer distinction is not a different set of nearby nurseries, and
 * the term is lowercased so "Confidor" and "confidor" are one row rather than
 * two paid scrapes. This is also the dedupe key for in-flight jobs - one
 * definition, so the two layers can never disagree about what "the same
 * search" means.
 */
export function searchKey(parts: SearchParts): string {
  return [
    parts.query.trim().toLowerCase(),
    parts.lat.toFixed(3),
    parts.lng.toFixed(3),
    Math.round(parts.radiusM),
  ].join('|');
}

export interface NurseryCacheConfig {
  url?: string;
  serviceKey?: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  onError?: (detail: string) => void;
}

/*
 * What /health reports about this layer.
 *
 * `enabled` is the load-bearing field. Without a service-role key every rule
 * above still holds - the cache just answers "miss" forever - so a server that
 * lost the key looks EXACTLY like a healthy one from the outside while paying
 * for a live scrape on every single search. That failure is invisible in the
 * logs (a miss is normal) and shows up only on the provider bill, which is why
 * it needs a field of its own rather than an inference from the hit rate.
 *
 * The counters are lifetime-of-process and deliberately unlabelled by search:
 * they answer "is this layer doing anything" without retaining what anyone
 * searched for.
 */
export interface NurseryCacheStats {
  enabled: boolean;
  hits: number;
  misses: number;
  stores: number;
  errors: number;
}

export interface NurseryCache<T> {
  enabled: boolean;
  get(parts: SearchParts): Promise<CacheHit<T> | null>;
  put(parts: SearchParts, results: T): Promise<void>;
  stats(): NurseryCacheStats;
}

/* A week. Stock moves, so the client is told when the list was checked and can
 * force a re-scrape - but a result that is a few days old is the difference
 * between an instant screen and an eight-minute wait. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

export function createNurseryCache<T>(config: NurseryCacheConfig = {}): NurseryCache<T> {
  const {
    url,
    serviceKey,
    ttlMs = DEFAULT_TTL_MS,
    fetchImpl = fetch,
    now = Date.now,
    timeoutMs = 5_000,
    onError = (detail: string) => console.warn(`[nursery-cache] ${detail}`),
  } = config;

  const enabled = Boolean(url && serviceKey);
  const base = url ? `${url.replace(/\/+$/, '')}/rest/v1/nursery_searches` : '';

  /* Counted only while enabled. A disabled cache returning null on every
   * lookup is not "missing" anything - counting it as a miss would report a
   * 0% hit rate on a server that has no cache at all, which is the one reading
   * these numbers exist to distinguish. */
  const counts = { hits: 0, misses: 0, stores: 0, errors: 0 };
  const fail = (detail: string): void => {
    counts.errors += 1;
    onError(detail);
  };
  const headers = {
    apikey: serviceKey ?? '',
    Authorization: `Bearer ${serviceKey ?? ''}`,
    'Content-Type': 'application/json',
  };

  /* The cache is an optimisation, not a dependency: a slow Supabase must not
   * hold up the scrape that is about to start anyway. */
  async function call(path: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    const { headers: extra, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${base}${path}`, {
        ...rest,
        headers: { ...headers, ...extra },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled,

    stats() {
      return { enabled, ...counts };
    },

    async get(parts) {
      if (!enabled) return null;
      const key = searchKey(parts);
      try {
        const res = await call(
          `?key=eq.${encodeURIComponent(key)}&select=results,scraped_at&limit=1`,
          { method: 'GET' }
        );
        if (!res.ok) {
          fail(`lookup failed: HTTP ${res.status}`);
          counts.misses += 1;
          return null;
        }
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) {
          counts.misses += 1;
          return null;
        }

        const scrapedAt = Date.parse(row.scraped_at);
        // An unparseable stamp is a row we cannot age, and serving a result of
        // unknown age is exactly what the TTL exists to prevent.
        if (!Number.isFinite(scrapedAt) || now() - scrapedAt > ttlMs || row.results == null) {
          counts.misses += 1;
          return null;
        }

        counts.hits += 1;
        return { results: row.results as T, scrapedAt };
      } catch (err) {
        fail(`lookup threw: ${err instanceof Error ? err.message : String(err)}`);
        counts.misses += 1;
        return null;
      }
    },

    async put(parts, results) {
      if (!enabled) return;
      const key = searchKey(parts);
      const row = {
        key,
        query: parts.query.trim().toLowerCase(),
        lat: Number(parts.lat.toFixed(3)),
        lng: Number(parts.lng.toFixed(3)),
        radius_m: Math.round(parts.radiusM),
        results,
        result_count: Array.isArray(results) ? results.length : 0,
        scraped_at: new Date(now()).toISOString(),
      };
      try {
        // merge-duplicates so a re-scrape REPLACES the stale row rather than
        // conflicting with it - the newest answer is the only one worth having.
        const res = await call('?on_conflict=key', {
          method: 'POST',
          body: JSON.stringify(row),
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        });
        if (res.ok) counts.stores += 1;
        else fail(`write failed: HTTP ${res.status}`);
      } catch (err) {
        fail(`write threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
