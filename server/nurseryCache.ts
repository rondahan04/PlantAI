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

export interface NurseryCache<T> {
  enabled: boolean;
  get(parts: SearchParts): Promise<CacheHit<T> | null>;
  put(parts: SearchParts, results: T): Promise<void>;
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

    async get(parts) {
      if (!enabled) return null;
      const key = searchKey(parts);
      try {
        const res = await call(
          `?key=eq.${encodeURIComponent(key)}&select=results,scraped_at&limit=1`,
          { method: 'GET' }
        );
        if (!res.ok) {
          onError(`lookup failed: HTTP ${res.status}`);
          return null;
        }
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row) return null;

        const scrapedAt = Date.parse(row.scraped_at);
        // An unparseable stamp is a row we cannot age, and serving a result of
        // unknown age is exactly what the TTL exists to prevent.
        if (!Number.isFinite(scrapedAt)) return null;
        if (now() - scrapedAt > ttlMs) return null;
        if (row.results == null) return null;

        return { results: row.results as T, scrapedAt };
      } catch (err) {
        onError(`lookup threw: ${err instanceof Error ? err.message : String(err)}`);
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
        if (!res.ok) onError(`write failed: HTTP ${res.status}`);
      } catch (err) {
        onError(`write threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
