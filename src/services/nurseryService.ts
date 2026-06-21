import { Nursery } from '../types';

/*
 * Live nursery lookup. Calls the backend nursery API (which holds the
 * Firecrawl/OpenAI/Places keys server-side) and maps its NurseryResult[] into
 * the app's Nursery shape. The base URL is build-time-inlined from
 * EXPO_PUBLIC_API_BASE_URL; falls back to localhost for the iOS simulator.
 *
 * The scrape takes ~30-60s, so callers must show a loading state and handle the
 * 90s client timeout / network errors.
 */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const TIMEOUT_MS = 90000;

/* Shape returned by GET /api/nurseries (see scraper/pipeline.ts NurseryResult). */
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
  shipsToHome: boolean;
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

/* The actual network call. */
async function requestNurseries(
  plantName: string,
  userLat: number,
  userLng: number
): Promise<Nursery[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `${API_BASE}/api/nurseries?plant=${encodeURIComponent(plantName)}` +
      `&lat=${userLat}&lng=${userLng}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Nursery API ${res.status}. ${body.slice(0, 120)}`);
    }
    const data = (await res.json()) as NurseryResultJSON[];
    return Array.isArray(data) ? data.map(toNursery) : [];
  } finally {
    clearTimeout(timer);
  }
}

/*
 * In-flight/result cache so the scrape can be PREFETCHED while the user is still
 * on the diagnosis screen. By the time they open the nurseries screen the same
 * promise is already in flight (or resolved), so the visible loading time is
 * minimal. Keyed by plant + rounded coordinates; entries expire after TTL.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  at: number;
  promise: Promise<Nursery[]>;
}
const cache = new Map<string, CacheEntry>();

const cacheKey = (plant: string, lat: number, lng: number) =>
  `${plant.trim().toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;

/*
 * Discover + scrape nurseries near a point for a given plant. Returns a cached
 * in-flight/resolved promise when one exists (set `force` to bypass it, e.g. on
 * a user-triggered retry).
 * @throws Error on network failure, non-2xx, or 90s timeout.
 */
export function fetchNearbyNurseries(
  plantName: string,
  userLat: number,
  userLng: number,
  opts: { force?: boolean } = {}
): Promise<Nursery[]> {
  const key = cacheKey(plantName, userLat, userLng);
  const hit = cache.get(key);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.promise;
  }
  const promise = requestNurseries(plantName, userLat, userLng);
  // Evict on failure so a later call (retry) starts fresh instead of re-throwing
  // the same rejected promise.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/*
 * Fire-and-forget warm-up: start the scrape early (e.g. on the diagnosis screen)
 * so the result is ready when the user opens the nurseries screen. Errors are
 * swallowed here — fetchNearbyNurseries surfaces them when the screen awaits.
 */
export function prefetchNearbyNurseries(
  plantName: string,
  userLat: number,
  userLng: number
): void {
  fetchNearbyNurseries(plantName, userLat, userLng).catch(() => {});
}
