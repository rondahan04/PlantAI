import { Nursery, NurseryOffer } from '../types';
import { apiFetch, apiHeaders, readApiError } from '../lib/api';
import { hasInlineResults } from '../lib/nursery/jobResponse';
import { clampRadius, DEFAULT_RADIUS_M } from '../lib/nursery/radius';
import { createSearchCache, searchCacheKey } from '../lib/nursery/searchCache';
import Storage from 'expo-sqlite/kv-store';

/*
 * Live nursery lookup.
 *
 * WHY THIS IS A JOB AND NOT A REQUEST. The scrape was measured at 480,187 ms
 * end-to-end - eight minutes - against the 90,000 ms abort this file used to
 * set. The client gave up at 90s and showed a failure screen; the scrape then
 * finished five and a half minutes later into nothing, having spent real money.
 * No host timeout setting fixes that, and an eight-minute open socket dies the
 * moment the user backgrounds the app.
 *
 * So the server starts a job and answers immediately with an id, and this file
 * polls until it is done. The work now runs to completion regardless of how
 * long it takes.
 *
 * The exported signatures are deliberately unchanged: NurseriesScreen and
 * DiagnosisScreen call the same two functions they always did.
 */

/* How long we are willing to wait before telling the user it did not come back.
 * Matches the server's job retention - waiting past that would poll a job that
 * has already been swept. */
const MAX_WAIT_MS = 10 * 60_000;
const START_TIMEOUT_MS = 15_000;
const POLL_TIMEOUT_MS = 10_000;

/* Poll fast at first (a cached/deduped job can answer immediately), then back
 * off - an eight-minute scrape does not need 160 round trips. */
const POLL_MIN_MS = 1_500;
const POLL_MAX_MS = 5_000;

/* Shape returned by the job's `results` (see scraper/pipeline.ts NurseryResult). */
interface NurseryResultJSON {
  id: string;
  name: string;
  website: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  image?: string;
  plantPrice: string;
  hasPlant: boolean;
  inStockKnown: boolean;
  availabilityNote?: string;
  availability?: {
    kind: 'estimate' | 'unreadable' | 'error' | 'stock_unknown' | 'no_catalogue' | 'no_website';
    confidence?: number;
    detail: string;
  };
  outcome?: 'found' | 'not_sold' | 'not_found';
  productUrl?: string;
  productName?: string;
  matchCount?: number;
  offers?: unknown;
  priceSuspect?: boolean;
  priceNote?: string;
  shipsToHome: boolean;
}

/*
 * Named so NurseriesScreen's describeFailure can tell "took too long" apart
 * from "service did not answer" - two different sentences to the user, and only
 * one of them is worth a retry.
 */
class NurserySearchTimeout extends Error {
  constructor() {
    super('NURSERY_SEARCH_TIMEOUT');
    this.name = 'TimeoutError';
  }
}

class NurseryServiceError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super('NURSERY_SERVICE_ERROR');
    this.name = 'NurseryServiceError';
    this.detail = detail;
    console.warn(`[nurseries] ${detail}`);
  }
}

function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
}

/*
 * The listings a shop matched, kept only where each row is whole. A result
 * cached by an older server has none, and a row missing its name or price is
 * a row we cannot show - neither is worth failing the card over.
 */
function toOffers(raw: unknown): NurseryOffer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const offers = raw
    .filter((o: any) => o && typeof o.name === 'string' && typeof o.price === 'string' && o.name && o.price)
    .map((o: any) => ({
      name: o.name as string,
      price: o.price as string,
      ...(typeof o.url === 'string' && /^https?:\/\//i.test(o.url) ? { url: o.url as string } : {}),
      inStock: o.inStock !== false,
    }));
  return offers.length ? offers : undefined;
}

function toNursery(r: NurseryResultJSON): Nursery {
  return {
    id: r.id,
    name: r.name,
    website: r.website,
    address: r.address,
    distance: formatDistance(r.distanceKm),
    distanceKm: r.distanceKm,
    hasPlant: r.hasPlant,
    inStockKnown: r.inStockKnown,
    plantPrice: r.plantPrice,
    availabilityNote: r.availabilityNote,
    availability: r.availability,
    outcome: r.outcome,
    productUrl: r.productUrl,
    productName: r.productName,
    matchCount: r.matchCount,
    offers: toOffers(r.offers),
    priceSuspect: r.priceSuspect,
    priceNote: r.priceNote,
    shipsToHome: r.shipsToHome,
    rating: r.rating,
    reviewCount: r.reviewCount,
    hours: r.hours,
    phone: r.phone,
    image: r.image,
    latitude: r.lat,
    longitude: r.lng,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/*
 * A finished search, with the moment its stock was actually checked.
 *
 * The stamp is not decoration: since the server now serves results scraped up
 * to a week ago, a screen that showed prices with no age would be presenting
 * old stock as live. `scrapedAt` is null only for a result from a server too
 * old to send one.
 */
export interface NurserySearch {
  nurseries: Nursery[];
  scrapedAt: number | null;
}

function toSearch(body: any): NurserySearch {
  const results = body?.results;
  const scrapedAt = Number(body?.scrapedAt);
  return {
    nurseries: Array.isArray(results) ? results.map(toNursery) : [],
    scrapedAt: Number.isFinite(scrapedAt) ? scrapedAt : null,
  };
}

/*
 * POST the search. Two possible answers now: a job id for a scrape that has
 * just started, or - when the server still holds a fresh result for this exact
 * search - the finished results right there in the response. The second case is
 * the whole point of the durable cache and is what makes a treatment looked up
 * the next day open instantly.
 */
async function startJob(
  plantName: string,
  lat: number,
  lng: number,
  force: boolean,
  radiusM: number
): Promise<{ jobId: string } | { search: NurserySearch }> {
  let res: Response;
  try {
    res = await apiFetch('/api/nurseries', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ plant: plantName, lat, lng, force, radius: radiusM }),
      timeoutMs: START_TIMEOUT_MS,
    });
  } catch (err: unknown) {
    throw new NurseryServiceError(`start failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const { error } = await readApiError(res);
    throw new NurseryServiceError(`start rejected: ${res.status} ${error}`);
  }

  const body = await res.json().catch(() => null);
  /*
   * The results array has to be THERE, not merely promised by `state: 'done'`.
   * The server dedupes an identical finished search onto its existing job and
   * answers `{ jobId, state: 'done' }` - done, with the results still on the
   * job. Reading that as inline results is what rendered "No nurseries found
   * nearby" over a search that had just found 23. See hasInlineResults.
   */
  if (hasInlineResults(body)) return { search: toSearch(body) };

  const jobId = (body as any)?.jobId;
  if (typeof jobId !== 'string' || !jobId) {
    /* A `done` with neither results nor a job to collect them from is the one
     * answer we must not turn into an empty list: we would be telling the user
     * their area has no nurseries on the strength of a malformed response. */
    if ((body as any)?.state === 'done') {
      throw new NurseryServiceError('server reported the search finished but sent no results');
    }
    throw new NurseryServiceError('start returned no jobId');
  }
  return { jobId };
}

/*
 * Poll until the job finishes. A single failed poll is survivable - the job is
 * still running on the server - so transient errors are tolerated and only a
 * run of them gives up. Losing a poll should not throw away an eight-minute
 * scrape the user already paid for.
 */
async function awaitJob(jobId: string): Promise<NurserySearch> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let interval = POLL_MIN_MS;
  let consecutiveFailures = 0;

  while (Date.now() < deadline) {
    await sleep(interval);
    interval = Math.min(POLL_MAX_MS, Math.round(interval * 1.4));

    let res: Response;
    try {
      res = await apiFetch(`/api/nurseries/job/${encodeURIComponent(jobId)}`, {
        headers: apiHeaders(),
        timeoutMs: POLL_TIMEOUT_MS,
      });
    } catch (err: unknown) {
      if (++consecutiveFailures >= 5) {
        throw new NurseryServiceError(
          `lost the job after 5 failed polls: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      continue;
    }

    if (res.status === 404) throw new NurseryServiceError('job expired before we collected it');
    if (!res.ok) {
      const { error } = await readApiError(res);
      if (++consecutiveFailures >= 5) {
        throw new NurseryServiceError(`poll rejected 5x: ${res.status} ${error}`);
      }
      continue;
    }

    consecutiveFailures = 0;
    const body = (await res.json().catch(() => null)) as any;
    if (body?.state === 'done') return toSearch(body);
    if (body?.state === 'error') {
      throw new NurseryServiceError(`job failed: ${body.error ?? 'unknown'}`);
    }
    /* state === 'running' → keep waiting */
  }

  throw new NurserySearchTimeout();
}

async function requestNurseries(
  plantName: string,
  lat: number,
  lng: number,
  force: boolean,
  radiusM: number
): Promise<NurserySearch> {
  const started = await startJob(plantName, lat, lng, force, radiusM);
  return 'search' in started ? started.search : awaitJob(started.jobId);
}

/*
 * In-flight/result cache so the scrape can be PREFETCHED while the user is
 * still on the diagnosis screen. By the time they open the nurseries screen the
 * same promise is already in flight (or resolved). The server dedupes by the
 * same key too, so even a cache miss here does not buy a second scrape.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 20;

interface CacheEntry {
  at: number;
  promise: Promise<NurserySearch>;
}
const cache = new Map<string, CacheEntry>();

/*
 * One definition of "the same search", shared with the durable cache below so
 * the two layers can never disagree - see lib/nursery/searchCache.ts for why
 * the radius and the coordinate rounding are part of it.
 */
const cacheKey = searchCacheKey;

/*
 * The durable half. The Map above dedupes what is in flight RIGHT NOW and dies
 * with the process; this survives a relaunch, so the search a user ran
 * yesterday paints immediately this morning instead of buying the scrape
 * again. Both are consulted, in that order: an in-flight promise is a better
 * answer than a stored one, because it is about to be newer.
 */
const disk = createSearchCache<Nursery[]>({
  storage: {
    getItem: (key) => Storage.getItemSync(key),
    setItem: (key, value) => Storage.setItemSync(key, value),
    removeItem: (key) => Storage.removeItemSync(key),
  },
});

/*
 * Evict expired entries, then the oldest, so a long session with many distinct
 * searches cannot grow the map without bound. Map preserves
 * insertion order, so the first key is the oldest.
 */
function evict(now: number) {
  for (const [k, v] of cache) {
    if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/*
 * Discover + scrape nurseries near a point for a given plant. Returns a cached
 * in-flight/resolved promise when one exists (set `force` to bypass it, e.g. on
 * a user-triggered retry).
 * @throws NurserySearchTimeout past MAX_WAIT_MS, NurseryServiceError otherwise.
 */
export function fetchNearbyNurseries(
  plantName: string,
  userLat: number,
  userLng: number,
  opts: { force?: boolean; radiusM?: number } = {}
): Promise<NurserySearch> {
  const now = Date.now();
  evict(now);

  const radiusM = clampRadius(opts.radiusM ?? DEFAULT_RADIUS_M);
  const key = cacheKey(plantName, userLat, userLng, radiusM);
  const hit = cache.get(key);
  if (!opts.force && hit && now - hit.at < CACHE_TTL_MS) {
    return hit.promise;
  }

  /*
   * The stored answer, returned without touching the network - this is what
   * makes the second search instant and the offline one possible at all. It is
   * checked AFTER the in-flight map because a promise already running is about
   * to be fresher than anything on disk, and BEFORE the request because the
   * whole point is not to make one.
   *
   * `scrapedAt` is carried through rather than restamped: the screen shows the
   * user when the stock was checked, and a week-old result must not claim to
   * have been checked when this phone happened to store it.
   */
  if (!opts.force) {
    const stored = disk.read(key);
    if (stored) {
      const search: NurserySearch = { nurseries: stored.results, scrapedAt: stored.scrapedAt };
      const resolved = Promise.resolve(search);
      cache.set(key, { at: now, promise: resolved });
      return resolved;
    }
  }

  // `force` reaches the server too, not just this in-memory map: a retry that
  // skipped the local cache only to be handed the same week-old row from the
  // durable one is not the refresh the user asked for. It drops the stored
  // copy for the same reason - a refresh that leaves yesterday's list on disk
  // would serve it again on the next cold start.
  if (opts.force) disk.invalidate(key);

  const promise = requestNurseries(plantName, userLat, userLng, opts.force === true, radiusM);
  // Evict on failure so a later call (retry) starts fresh instead of re-throwing
  // the same rejected promise.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  /*
   * Store on success only, and never an empty list. "No nursery near you has
   * this plant" is the one answer most worth retrying - stock arrives - and
   * caching it for a day would hide the shop that got it in tomorrow.
   */
  promise
    .then((search) => {
      if (search.nurseries.length > 0) disk.write(key, search.nurseries, search.scrapedAt);
    })
    .catch(() => {});
  cache.set(key, { at: now, promise });
  return promise;
}

/* Every stored search, dropped. Called on sign-out: what someone looked for is
 * theirs, and should not greet the next account on the same handset. */
export function clearNurserySearchCache(): void {
  cache.clear();
  disk.clear();
}

/*
 * Fire-and-forget warm-up: start the scrape early (e.g. on the diagnosis
 * screen) so the result is ready when the user opens the nurseries screen.
 * Errors are swallowed here - fetchNearbyNurseries surfaces them when the
 * screen awaits. This matters far more now than it did: the job keeps running
 * whether or not anyone is watching, so a prefetch started on the diagnosis
 * screen is genuinely minutes of head start rather than a doomed 90s race.
 */
export function prefetchNearbyNurseries(plantName: string, userLat: number, userLng: number): void {
  fetchNearbyNurseries(plantName, userLat, userLng).catch(() => {});
}
