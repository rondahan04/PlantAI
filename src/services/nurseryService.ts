import { Nursery } from '../types';
import { apiFetch, apiHeaders, readApiError } from '../lib/api';

/*
 * Live nursery lookup (TODOS E12).
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
  availability?: { kind: 'estimate' | 'unreadable' | 'error'; confidence?: number; detail: string };
  outcome?: 'found' | 'not_sold' | 'not_found';
  shipsToHome: boolean;
}

/*
 * Named so NurseriesScreen's describeFailure can tell "took too long" apart
 * from "service did not answer" - two different sentences to the user, and only
 * one of them is worth a retry.
 */
export class NurserySearchTimeout extends Error {
  constructor() {
    super('NURSERY_SEARCH_TIMEOUT');
    this.name = 'TimeoutError';
  }
}

export class NurseryServiceError extends Error {
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

/* POST the search, get a job id back. */
async function startJob(plantName: string, lat: number, lng: number): Promise<string> {
  let res: Response;
  try {
    res = await apiFetch('/api/nurseries', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ plant: plantName, lat, lng }),
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
  const jobId = (body as any)?.jobId;
  if (typeof jobId !== 'string' || !jobId) {
    throw new NurseryServiceError('start returned no jobId');
  }
  return jobId;
}

/*
 * Poll until the job finishes. A single failed poll is survivable - the job is
 * still running on the server - so transient errors are tolerated and only a
 * run of them gives up. Losing a poll should not throw away an eight-minute
 * scrape the user already paid for.
 */
async function awaitJob(jobId: string): Promise<Nursery[]> {
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
    if (body?.state === 'done') {
      const results = body.results;
      return Array.isArray(results) ? results.map(toNursery) : [];
    }
    if (body?.state === 'error') {
      throw new NurseryServiceError(`job failed: ${body.error ?? 'unknown'}`);
    }
    /* state === 'running' → keep waiting */
  }

  throw new NurserySearchTimeout();
}

async function requestNurseries(plantName: string, lat: number, lng: number): Promise<Nursery[]> {
  return awaitJob(await startJob(plantName, lat, lng));
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
  promise: Promise<Nursery[]>;
}
const cache = new Map<string, CacheEntry>();

const cacheKey = (plant: string, lat: number, lng: number) =>
  `${plant.trim().toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;

/*
 * Evict expired entries, then the oldest, so a long session with many distinct
 * searches cannot grow the map without bound (TODOS H7). Map preserves
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
  opts: { force?: boolean } = {}
): Promise<Nursery[]> {
  const now = Date.now();
  evict(now);

  const key = cacheKey(plantName, userLat, userLng);
  const hit = cache.get(key);
  if (!opts.force && hit && now - hit.at < CACHE_TTL_MS) {
    return hit.promise;
  }

  const promise = requestNurseries(plantName, userLat, userLng);
  // Evict on failure so a later call (retry) starts fresh instead of re-throwing
  // the same rejected promise.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  cache.set(key, { at: now, promise });
  return promise;
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
