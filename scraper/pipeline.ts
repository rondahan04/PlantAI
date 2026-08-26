/*
 * Nursery search orchestration, extracted from dashboard/server.ts so the API
 * server and the dashboard share one implementation. Dependency-injected for
 * hermetic unit tests: real network functions are the defaults wired in by
 * callers (see server/index.ts).
 */
import { hostOf, looksUnreadable, type PipelineResult } from './core.ts';
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
  plantPrice: string; // '₪XX' or '-'
  hasPlant: boolean; // a real in-stock product was scraped
  inStockKnown: boolean; // we have an exact listing (vs an LLM estimate)
  /*
   * DEPRECATED for display, still populated. A pre-formatted
   * "~50% · <long LLM sentence>" that overflowed its pill in the app. Kept
   * because `jobs.ts` retains results across a restart, so a job started by the
   * previous build still has to render in a client that already updated.
   * New code reads `availability`.
   */
  availabilityNote?: string;
  /*
   * The same information, structured, so the client decides presentation and
   * can put the long reasoning behind a tap instead of clipping it mid-word.
   * Optional for the same rolling-deploy reason as `availabilityNote`.
   */
  availability?: Availability;
  shipsToHome: boolean; // national fallback (Deliver tab) vs local (Pick Up tab)
}

export interface Availability {
  /*
   * `estimate`   - we read the site and the model judged a likelihood.
   * `unreadable` - the site was a bot wall or returned nothing. NOT a
   *                likelihood: there is no number to honestly report.
   * `error`      - the scrape itself failed.
   */
  kind: 'estimate' | 'unreadable' | 'error';
  confidence?: number; // `estimate` only
  detail: string; // full reasoning / error text, shown on demand
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
  readFallbackUrls: () => string[]; // nurseries-fallback.txt
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
    plantPrice: '-',
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
      /* unreachable → handled as unreadable below */
    }

    /*
     * A bot wall is not a shop we read and judged - it is a shop we never saw.
     * Asking the model to estimate from a captcha page produced exactly one
     * observed result: "~50% · the site text is only a security-verification
     * page", a made-up number in the same pill as a real one. Bail before the
     * call; it is both the honest answer and one fewer LLM request.
     */
    if (looksUnreadable(homeMd)) {
      return { ...base, ...unreadable('the site blocked automated reading') };
    }

    const est = await deps.infer(homeMd, input.plantName, host);
    // The regex missed it but the model saw it - reclassify rather than trust.
    if (est.confidence === 0 || looksUnreadable(est.reasoning)) {
      return { ...base, ...unreadable(est.reasoning || 'no readable site content') };
    }

    return {
      ...base,
      availabilityNote: `~${est.confidence}% · ${est.reasoning}`,
      availability: { kind: 'estimate', confidence: est.confidence, detail: est.reasoning },
    };
  } catch (err: any) {
    return {
      ...base,
      availabilityNote: `unavailable (${err.message})`,
      availability: { kind: 'error', detail: err.message },
    };
  }
}

/* Both fields together, so the legacy string and the structured value can never
 * disagree about the same nursery. */
function unreadable(detail: string): Pick<NurseryResult, 'availabilityNote' | 'availability'> {
  return { availabilityNote: `unavailable (${detail})`, availability: { kind: 'unreadable', detail } };
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
