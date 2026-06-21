/*
 * Nursery search orchestration, extracted from dashboard/server.ts so the API
 * server and the dashboard share one implementation. Dependency-injected for
 * hermetic unit tests: real network functions are the defaults wired in by
 * callers (see server/index.ts).
 */
import { type PipelineResult } from './core.ts';
import { type DiscoveredNursery } from './places.ts';

export interface NurseryResult {
  id: string;
  name: string;
  website: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number; // Infinity when coordinates are unknown (fallback list)
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  image?: string;
  plantPrice: string; // '₪XX' or '—'
  hasPlant: boolean; // a real in-stock product was scraped
  inStockKnown: boolean; // we have an exact listing (vs an LLM estimate)
  availabilityNote?: string; // estimate text when inStockKnown is false
  shipsToHome: boolean; // national fallback (Deliver tab) vs local (Pick Up tab)
}

export interface SearchInput {
  plantName: string;
  lat: number;
  lng: number;
  radiusM?: number;
}

export interface PipelineDeps {
  discover: (lat: number, lng: number, radiusM: number) => Promise<DiscoveredNursery[]>;
  search: (
    website: string,
    query: string,
    host: string
  ) => Promise<{ md: string; platform: string; picked: string | null }>;
  extract: (opts: { markdown: string; query: string; site: string }) => Promise<PipelineResult>;
  scrapeHome: (origin: string) => Promise<string>;
  infer: (
    homeMd: string,
    query: string,
    site: string
  ) => Promise<{ confidence: number; reasoning: string }>;
  resolvePhoto: (photoName: string) => Promise<string | undefined>;
  readFallbackUrls: () => string[]; // nurseries_scraping_testing
  nationalUrls: string[]; // ship-to-home shippers
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

/* Scrape one nursery for the plant and fold the scraper output into the
 * identity we already have from Places (or the fallback list). */
async function scrapeOne(
  n: DiscoveredNursery,
  input: SearchInput,
  deps: PipelineDeps,
  shipsToHome: boolean
): Promise<NurseryResult> {
  const host = hostOf(n.website);
  const base: NurseryResult = {
    id: host,
    name: n.name || host,
    website: n.website,
    address: n.address,
    lat: n.lat,
    lng: n.lng,
    distanceKm: n.lat && n.lng ? haversineKm(input.lat, input.lng, n.lat, n.lng) : Infinity,
    rating: n.rating,
    reviewCount: n.reviewCount,
    hours: n.hours,
    phone: n.phone,
    image: n.photoName ? await deps.resolvePhoto(n.photoName) : undefined,
    plantPrice: '—',
    hasPlant: false,
    inStockKnown: false,
    shipsToHome,
  };

  try {
    const { md } = await deps.search(n.website, input.plantName, host);
    const { plants } = await deps.extract({ markdown: md, query: input.plantName, site: host });
    if (plants.length > 0) {
      const best = plants[0];
      return {
        ...base,
        plantPrice: best.price,
        hasPlant: best.availability !== 'out_of_stock',
        inStockKnown: true,
      };
    }
    // 0 structured items → estimate from the homepage.
    let homeMd = '';
    try {
      homeMd = await deps.scrapeHome(new URL(n.website).origin);
    } catch {
      /* unreachable → infer('') yields 0% */
    }
    const est = await deps.infer(homeMd, input.plantName, host);
    return { ...base, availabilityNote: `~${est.confidence}% · ${est.reasoning}` };
  } catch (err: any) {
    return { ...base, availabilityNote: `unavailable (${err.message})` };
  }
}

export async function runNurserySearch(
  input: SearchInput,
  deps: PipelineDeps
): Promise<NurseryResult[]> {
  const radiusM = input.radiusM ?? 10000;

  // 1. Discover local nurseries (Places). Empty → fallback URL list.
  let discovered = await deps.discover(input.lat, input.lng, radiusM);
  if (discovered.length === 0) {
    discovered = deps.readFallbackUrls().map((url) => ({
      name: hostOf(url),
      website: url,
      lat: 0,
      lng: 0,
      address: '',
    }));
  }

  // 2. Scrape each (local = pickup).
  const local = await Promise.all(discovered.map((n) => scrapeOne(n, input, deps, false)));

  // 3. National ship-to-home fallback when no local nursery has a real product.
  let national: NurseryResult[] = [];
  const localHosts = new Set(discovered.map((n) => hostOf(n.website)));
  if (!local.some((n) => n.hasPlant)) {
    const natUrls = deps.nationalUrls.filter((u) => !localHosts.has(hostOf(u)));
    national = await Promise.all(
      natUrls.map((url) =>
        scrapeOne(
          { name: hostOf(url), website: url, lat: 0, lng: 0, address: '' },
          input,
          deps,
          true
        )
      )
    );
  }

  // 4. Dedup by id, sort: in-stock first, then by distance.
  const seen = new Set<string>();
  return [...local, ...national]
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => {
      if (a.hasPlant !== b.hasPlant) return a.hasPlant ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });
}
