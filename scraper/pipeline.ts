/*
 * Nursery search orchestration, extracted from dashboard/server.ts so the API
 * server and the dashboard share one implementation. Dependency-injected for
 * hermetic unit tests: real network functions are the defaults wired in by
 * callers (see server/index.ts).
 */
import { hostOf, type PipelineResult, type Plant } from './core.ts';
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
  /* See NurseryOutcome. Drives what the client shows and what it hides. */
  outcome?: NurseryOutcome;
  /*
   * The specific product page behind `plantPrice`. The Order button used to
   * open the nursery's homepage, which for a shop stocking 28 Alocasias left
   * the user to find the plant all over again. Absent when the listing carried
   * no link - the homepage is still the fallback.
   */
  productUrl?: string;
  /* Which listing `plantPrice` belongs to. A search for "alocasia" can match
   * two dozen cultivars at wildly different prices; naming the one we priced
   * is the difference between a quote and a number. */
  productName?: string;
  /* How many listings matched, so the client can say "from ₪39 · 28 matches". */
  matchCount?: number;
  /*
   * A final LLM pass judged this price not to belong to this product (a phone
   * number, a shipping threshold, a decimal slip). The client hides the number
   * rather than showing one it does not trust - a wrong price is worse than no
   * price. `priceNote` carries the reason for the log and the detail tap.
   */
  priceSuspect?: boolean;
  priceNote?: string;
  shipsToHome: boolean; // national fallback (Deliver tab) vs local (Pick Up tab)
}

/*
 * What actually happened at this nursery. Three outcomes, because the user only
 * cares about two of them:
 *
 *   found     - a real listing with a price. Show it.
 *   not_sold  - we READ their catalogue and this plant is not in it. Hidden by
 *               the client: a shop that demonstrably does not stock the plant is
 *               not a result, it is noise.
 *   not_found - we could not read the shop (blocked, unreachable, no catalogue).
 *               Shown, but phrased as "didn't find the product" rather than as a
 *               scrape failure - our plumbing is not the user's problem, and
 *               they may still want to ring the place.
 */
export type NurseryOutcome = 'found' | 'not_sold' | 'not_found';

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
  /*
   * No longer used by runNurserySearch: neither surviving outcome shows a
   * likelihood, so the homepage fetch and the estimate behind it were pure cost.
   * Left optional because dashboard/server.ts still wires them for its own
   * exploratory flow.
   */
  scrapeHome?: (origin: string) => Promise<string>;
  infer?: (
    homeMd: string,
    query: string,
    site: string
  ) => Promise<{ confidence: number; reasoning: string }>;
  resolvePhoto: (photoName: string) => Promise<string | undefined>;
  /* Plant name -> the term to type into a nursery's own search box. Israeli
   * sites index in Hebrew. Called once per search, not once per site. */
  translate?: (plantName: string) => Promise<string>;
  /* Final sanity pass over the quoted prices, once for the whole search so the
   * model can compare nurseries against each other. See sanityCheckPrices. */
  checkPrices?: (
    query: string,
    candidates: { site: string; name: string; price: string }[]
  ) => Promise<{ plausible: boolean; reason: string }[]>;
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


/*
 * ILS out of a scraped price string. Handles "₪1,499.90", "1499.90 ש\"ח" and
 * bare numbers; returns Infinity for anything unparseable so it sorts last
 * rather than winning by accident.
 */
export function parsePrice(price: string): number {
  const digits = (price || '').replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/*
 * Which of a shop's matching listings to quote.
 *
 * Was `plants[0]` - whatever the page happened to list first. Searching
 * al-haderech for "alocasia" returned 28 cultivars from ₪39 to ₪1,499.90 and
 * quoted ₪999.90 purely because that row came first, which reads as a broken
 * scrape even though every number was correct.
 *
 * Cheapest in stock, because the question this screen answers is "where should
 * I buy this and for how much". Out-of-stock rows are considered only if there
 * is nothing else, so a shop with one sold-out listing still reports honestly.
 */
export function cheapestMatch(plants: Plant[]): Plant {
  const byPrice = (a: Plant, b: Plant) => parsePrice(a.price) - parsePrice(b.price);
  const inStock = plants.filter((p) => p.availability !== 'out_of_stock');
  return [...(inStock.length ? inStock : plants)].sort(byPrice)[0];
}

/* Scrape one nursery for the plant and fold the scraper output into the
 * identity we already have from Places (or the fallback list). */
async function scrapeOne(
  n: DiscoveredNursery,
  input: SearchInput,
  deps: PipelineDeps,
  shipsToHome: boolean,
  /* What to type into the shop's search box - Hebrew for Israeli sites. The
   * user's original wording stays in `input.plantName` for the extractor, which
   * matches either language. */
  searchTerm: string = input.plantName
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
    const { md } = await deps.search(n.website, searchTerm, host);
    const { plants, funnel } = await deps.extract({ markdown: md, query: input.plantName, site: host });
    if (plants.length > 0) {
      const best = cheapestMatch(plants);
      return {
        ...base,
        plantPrice: best.price,
        hasPlant: best.availability !== 'out_of_stock',
        inStockKnown: true,
        outcome: 'found',
        productUrl: best.url,
        productName: best.name,
        matchCount: plants.length,
      };
    }
    /*
     * Nothing matched. The funnel already knows WHY, and the distinction is the
     * whole point: `no_match` means we read a real catalogue and this plant was
     * not in it, which is a shop the user does not want to see. Anything else
     * means we never got a readable catalogue, so absence proves nothing and the
     * row stays - phrased as not finding the product, not as our scrape failing.
     *
     * Note what is NOT here any more: the homepage scrape and the LLM likelihood
     * that used to follow. Neither outcome displays a percentage now, so the
     * estimate had no consumer - and it cost a full page fetch plus a model call
     * for every nursery that did not match, which is most of them.
     */
    const readCatalogue = funnel?.stage === 'no_match' || funnel?.stage === 'rejected';
    return {
      ...base,
      outcome: readCatalogue ? 'not_sold' : 'not_found',
      availability: {
        kind: readCatalogue ? 'estimate' : 'unreadable',
        detail: readCatalogue
          ? 'The shop was searched and this plant was not listed.'
          : 'We could not read this shop, so we do not know what it stocks.',
      },
    };
  } catch (err: any) {
    // A thrown scrape is the same story to the user as an unreadable one: we
    // did not manage to look, so we cannot say the plant is absent.
    return {
      ...base,
      outcome: 'not_found',
      availabilityNote: `unavailable (${err.message})`,
      availability: { kind: 'error', detail: err.message },
    };
  }
}

export async function runNurserySearch(
  input: SearchInput,
  deps: PipelineDeps
): Promise<NurseryResult[]> {
  const radiusM = input.radiusM ?? 10000;

  /*
   * 0. Translate ONCE, before any site is touched. Israeli nurseries index
   * their catalogues in Hebrew, so "alocasia regal shield" matches nothing on
   * their search pages - the shop may well stock the plant, the string just
   * never appears. Per-search rather than per-site: the answer is identical for
   * every nursery in the fan-out.
   */
  const searchTerm = deps.translate ? await deps.translate(input.plantName) : input.plantName;

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

  /*
   * 2. Local nurseries and the ship-to-home shippers, scraped TOGETHER.
   *
   * The shippers used to run only as a fallback, when nothing local had the
   * plant - which meant the Deliver tab was empty in exactly the case a user
   * opens it: they found a local listing but would rather have it delivered.
   * They are the only nurseries that actually ship, so they belong in every
   * search, not just the failing ones.
   */
  const localHosts = new Set(discovered.map((n) => hostOf(n.website)));
  const natUrls = deps.nationalUrls.filter((u) => !localHosts.has(hostOf(u)));

  const [local, national] = await Promise.all([
    Promise.all(discovered.map((n) => scrapeOne(n, input, deps, false, searchTerm))),
    Promise.all(
      natUrls.map((url) =>
        scrapeOne(
          { name: hostOf(url), website: url, lat: 0, lng: 0, address: '' },
          input,
          deps,
          true,
          searchTerm
        )
      )
    ),
  ]);

  // 4. Dedup by id, sort: in-stock first, then by distance.
  const seen = new Set<string>();
  const rows = [...local, ...national]
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => {
      if (a.hasPlant !== b.hasPlant) return a.hasPlant ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });

  /*
   * 5. One last look at the prices, across every nursery at once.
   *
   * The extractor and the auditor both verify a price against the page it came
   * from, and both can be right while the number is still wrong for the product
   * - pages also carry phone numbers, free-shipping thresholds and cart totals.
   * Comparing the shops against each other is what catches that, so this runs
   * once over the whole result set rather than per site.
   */
  return await verifyPrices(rows, input.plantName, deps);
}

async function verifyPrices(
  rows: NurseryResult[],
  plantName: string,
  deps: PipelineDeps
): Promise<NurseryResult[]> {
  if (!deps.checkPrices) return rows;

  // Only rows that actually quote a price have anything to check.
  const priced = rows
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.inStockKnown && n.plantPrice && n.plantPrice !== '-');
  if (priced.length === 0) return rows;

  const verdicts = await deps.checkPrices(
    plantName,
    priced.map(({ n }) => ({ site: n.id, name: n.productName ?? n.name, price: n.plantPrice }))
  );

  const out = [...rows];
  priced.forEach(({ i }, k) => {
    const v = verdicts[k];
    if (!v || v.plausible) return;
    /*
     * Drop the number, keep the row. The shop does stock the plant - we simply
     * do not trust the figure we read, and showing a price we would be
     * embarrassed by is worse than sending the user to the product page to look.
     */
    out[i] = { ...out[i], plantPrice: '-', priceSuspect: true, priceNote: v.reason };
  });
  return out;
}
