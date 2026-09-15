/*
 * Platform-native product APIs: ask the shop's own storefront API instead of
 * reading its search page.
 *
 * WHY. The pipeline's job is "does this shop sell this plant, and for how
 * much". Today that question is answered by scraping a search page to markdown
 * and paying a model to read it back. But 10 of the 16 nurseries we know
 * publish the answer as JSON, exactly, for free:
 *
 *   WooCommerce  /wp-json/wc/store/v1/products?search=  → 8 hosts (measured)
 *   Shopify      /products.json?limit=250               → 3 hosts (measured)
 *
 * Those responses carry the name, the price the shop actually charges - the
 * SALE price, which is the one the HTML sale block makes so easy to misread -
 * the stock flag and the product URL. There is no conversion to markdown, so
 * nothing is lost, and no model is asked to re-read a number, so there is no
 * hallucination surface at all.
 *
 * WHY IT ALSO BUYS BUDGET. Firecrawl is capped at ten requests a minute
 * (core.ts DEFAULT_MAX_PER_MINUTE) and five concurrent slots, and a fan-out over
 * a dozen shops exhausts that window in seconds - which is how sites end up
 * reported as unreadable when they were merely queued. Every host served from
 * here costs zero Firecrawl requests and zero slots, leaving the whole window
 * for the shops that genuinely need a browser.
 *
 * WHAT THIS MODULE IS NOT. It does not decide WHICH products match the query -
 * that is scraper/queryPlan.ts. It fetches and maps, nothing else, and it never
 * throws: every failure degrades to an empty result carrying the HTTP status, so
 * the caller falls back to the HTML path exactly as before.
 */

import { parsePriceNumber, type StructuredProduct } from './structuredPrice.ts';

/*
 * Which JSON interface a host exposes. 'none' is a real answer and is cached
 * like one - re-probing a shop that has neither, on every search, would spend
 * the latency this module exists to save.
 */
export type ApiRoute = 'woo-store' | 'shopify-json' | 'none';

export interface ApiResult {
  products: StructuredProduct[];
  /*
   * HTTP status of the request. 0 when it never completed (DNS, TLS, timeout).
   *
   * Kept because it is the fact that self-heal needs and that fetchRawHtml
   * throws away: a 404 from a route we believed in is proof the remembered
   * platform is wrong. getzler.co.il and peer-nursery.co.il sat cached as
   * Shopify for a month, 404ing every search, precisely because nothing
   * upstream retained a status code.
   */
  status: number;
  /*
   * Did the SERVER apply the query? True for the Woo search endpoint. False for
   * the Shopify catalogue, where we downloaded everything and the filtering is
   * ours - which matters because only a server-filtered empty result is
   * evidence that a shop does not stock something.
   */
  filteredByServer: boolean;
  route: ApiRoute;
  /* Shopify only: false when paging stopped at the cap rather than at the end,
   * so the catalogue is a prefix and absence from it proves nothing. */
  complete: boolean;
}

/* Same budget as core.ts RAW_HTML_TIMEOUT_MS: this is a plain request to the
 * shop, and a nursery that cannot answer in 8s will not be rescued by 30. */
export const API_TIMEOUT_MS = 8000;

/* Some shops serve a stub or a bot wall to unknown agents. Matches core.ts. */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/*
 * Woo's own maximum, and we ask for all of it.
 *
 * The whole design sends a BROAD term and filters locally, which only works if
 * we are handed the whole shelf. al-haderech lists 64 Alocasia; at the 20 rows
 * an earlier draft requested, "Alocasia Regal Shield" was simply not in the
 * response, and the shop looked like it stocked every Alocasia except the one
 * that was asked for. A truncated shelf turns a broad query from a strength
 * into a silent miss.
 */
const WOO_DEFAULT_PER_PAGE = 100;

/* Shopify's own maximum. Fewer pages beats smaller pages. */
export const SHOPIFY_PAGE_SIZE = 250;
/*
 * How many catalogue pages to request at once after the first.
 *
 * Three, because the trade is between round trips and wasted requests: a shop
 * with 2000 products used to cost 8 serial fetches of ~250KB each, and this
 * makes it 4 waits (1, then 3, then 3, then 1). A shop whose catalogue fits in
 * one page still costs exactly one request, because page 1 is always read
 * alone - the only page we know we want before reading anything.
 */
export const SHOPIFY_PAGE_BATCH = 3;
/* 2000 products. Past this a "nursery" is a general marketplace and the
 * catalogue route is the wrong tool; the HTML search page is a better bet. */
export const SHOPIFY_MAX_PAGES = 8;

export type FetchLike = typeof fetch;

/*
 * WordPress and WooCommerce return product names with HTML entities still in
 * them - al-haderech's live API answers `מבצע אלוקסיה סביריאן טייגר ע&#8217; 9`.
 * Left undecoded, that string is what we would show the user and what we would
 * match against, so an apostrophe would silently break both.
 *
 * Deliberately small: the named set below plus numeric escapes is everything
 * WordPress emits in a product title. A full entity table would be a dependency
 * for no extra correctness.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', shy: '', laquo: '«', raquo: '»',
};

export function decodeEntities(s: string): string {
  if (!s || !s.includes('&')) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => codePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/* An out-of-range escape is malformed markup, not a character. Dropping the
 * whole title over it would be worse than leaving the escape in place. */
function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/* Whitespace normalization, so a name from JSON and a name from HTML compare
 * equal. Entities first: `&nbsp;` becomes a space that then collapses. */
export function cleanName(raw: unknown): string {
  return decodeEntities(String(raw ?? '')).replace(/\s+/g, ' ').trim();
}

/*
 * One JSON request, with every failure flattened into a status.
 *
 * The contract matches fetchRawHtml (core.ts): callers treat this as best
 * effort, because on every path there is a slower route that still works. A
 * throw here would turn a shop we could have read by HTML into a shop we
 * reported as broken.
 */
async function getJson(
  url: string,
  fetchImpl: FetchLike
): Promise<{ body: unknown; status: number }> {
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return { body: null, status: res.status };
    /*
     * A shop without the endpoint often answers 200 with its HTML 404 page
     * rather than a JSON error, so the status alone does not prove we got JSON.
     * Parsing is the real test.
     */
    const text = await res.text();
    try {
      return { body: JSON.parse(text), status: res.status };
    } catch {
      return { body: null, status: res.status };
    }
  } catch {
    return { body: null, status: 0 };
  }
}

const empty = (route: ApiRoute, status: number, filteredByServer: boolean): ApiResult => ({
  products: [],
  status,
  filteredByServer,
  route,
  complete: true,
});

// --- WooCommerce Store API ---------------------------------------------------

export function wooSearchUrl(
  origin: string,
  term: string,
  perPage = WOO_DEFAULT_PER_PAGE,
  page = 1
): string {
  const paged = page > 1 ? `&page=${page}` : '';
  return `${origin.replace(/\/$/, '')}/wp-json/wc/store/v1/products?search=${encodeURIComponent(
    term
  )}&per_page=${perPage}${paged}`;
}

/*
 * Map one Store API row.
 *
 * `prices.price` is a STRING IN MINOR UNITS - al-haderech's ₪599.90 arrives as
 * "59990" with `currency_minor_unit: 2`. Reading it as a major-unit number
 * would quote every plant at a hundred times its price, which is the kind of
 * wrong that is worse than missing, so the conversion is explicit here rather
 * than left to a shared parser.
 */
export function wooProduct(row: any, origin: string): StructuredProduct | null {
  const name = cleanName(row?.name);
  if (!name) return null;

  const prices = row?.prices ?? {};
  const minorUnit = Number(prices.currency_minor_unit);
  /*
   * A variable product has no single price, and some shops say so by setting
   * `price` to "0" and putting the real numbers in `price_range`. netaplants
   * does this for every plant it sells - each is offered in several pot sizes -
   * so reading `price` alone made a shop with a full catalogue look like a shop
   * with nothing in it: every row priced 0 and dropped by the guard below.
   *
   * The MINIMUM of the range is the right number to take. It is what the plant
   * actually costs in its cheapest form, which is the number the app already
   * shows ("from ₪42"), and it is the same choice cheapestMatch makes across
   * separate listings.
   */
  const range = prices.price_range ?? {};
  const stated = parsePriceNumber(prices.price);
  const raw = stated !== null && stated > 0 ? prices.price : (range.min_amount ?? prices.price);
  /*
   * The spec says integer minor units. A dot means the shop deviates from it,
   * and dividing such a value would be the same hundredfold error in the other
   * direction, so trust the decimal point over the declared unit.
   */
  const alreadyMajor = typeof raw === 'string' && raw.includes('.');
  const parsed = parsePriceNumber(raw);
  if (parsed === null) return null;
  const price =
    alreadyMajor || !Number.isFinite(minorUnit) || minorUnit <= 0
      ? parsed
      : parsed / 10 ** minorUnit;
  if (!(price > 0)) return null;

  return {
    name,
    price,
    currency: typeof prices.currency_code === 'string' ? prices.currency_code : 'ILS',
    /* `is_in_stock` is always present on this endpoint, so unlike the HTML
     * readers this route never has to answer 'unknown'. */
    availability: row?.is_in_stock === false ? 'out_of_stock' : 'in_stock',
    url: typeof row?.permalink === 'string' ? row.permalink : `${origin.replace(/\/$/, '')}`,
    source: 'api',
  };
}

/*
 * How many pages of a Woo shelf we will read.
 *
 * `per_page` is capped at 100 by the Store API itself, and WOO_DEFAULT_PER_PAGE
 * already asks for all of it - but a shop with more than 100 products matching
 * the genus hands back a full page and says nothing about the rest. That is the
 * truncated shelf the comment on WOO_DEFAULT_PER_PAGE warns about, arriving one
 * level up: al-haderech lists 64 Alocasia and fits, a genus like פיקוס or קקטוס
 * at a large shop does not, and the cultivar we were sent for is simply absent
 * from the response. The shop then looks like it stocks everything except the
 * plant that was asked for.
 *
 * A page is only requested when the one before it came back FULL, so a shop
 * whose shelf fits in one page - nearly all of them - still costs exactly one
 * request. Three pages is 300 products, past which the genus is not a shelf and
 * ranking has plenty to work with.
 */
export const WOO_MAX_PAGES = 3;

/*
 * Search a WooCommerce shop; the server applies the query.
 *
 * One request for the common case, and one more per full page after that. The
 * pages are read in sequence rather than together because the stopping
 * condition IS the previous page's length: firing three at once would spend two
 * requests on every shop to learn that the first page was the whole answer.
 */
export async function wooStoreSearch(
  origin: string,
  term: string,
  opts: { perPage?: number; maxPages?: number; fetchImpl?: FetchLike } = {}
): Promise<ApiResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const perPage = opts.perPage ?? WOO_DEFAULT_PER_PAGE;
  const maxPages = Math.max(1, opts.maxPages ?? WOO_MAX_PAGES);

  const products: StructuredProduct[] = [];
  let status = 0;
  let complete = false;

  for (let page = 1; page <= maxPages; page++) {
    const { body, status: s } = await getJson(
      wooSearchUrl(origin, term, perPage, page),
      fetchImpl
    );
    /*
     * Page 1 failing is a route that does not answer, which is what the caller
     * falls back on. A LATER page failing leaves a prefix we can still rank, so
     * it narrows the answer instead of erasing it - but it is not proof of
     * absence, so `complete` stays false.
     */
    if (!Array.isArray(body)) {
      if (page === 1) return empty('woo-store', s, true);
      status = status || s;
      break;
    }
    status = s;
    for (const row of body) {
      const p = wooProduct(row, origin);
      if (p) products.push(p);
    }
    /* A short page is the end of the shelf - the only signal this endpoint
     * gives, since the Store API's totals live in headers getJson discards. */
    if (body.length < perPage) {
      complete = true;
      break;
    }
  }

  return { products, status, filteredByServer: true, route: 'woo-store', complete };
}

// --- Shopify catalogue -------------------------------------------------------

export function shopifyPageUrl(origin: string, page: number, limit = SHOPIFY_PAGE_SIZE): string {
  return `${origin.replace(/\/$/, '')}/products.json?limit=${limit}&page=${page}`;
}

/*
 * Map one /products.json row.
 *
 * Unlike Woo this is a MAJOR-unit decimal string ("199.00"), and there is no
 * currency field at all - the endpoint reports the shop's own currency
 * implicitly. Every shop here is Israeli, so ILS is the honest default and is
 * recorded explicitly rather than left blank.
 */
export function shopifyProduct(row: any, origin: string): StructuredProduct | null {
  const name = cleanName(row?.title);
  if (!name) return null;

  const variants: any[] = Array.isArray(row?.variants) ? row.variants : [];
  /* Cheapest variant, to match cheapestMatch's question downstream: a plant
   * sold in three pot sizes should quote the price you can actually pay least. */
  const prices = variants
    .map((v) => parsePriceNumber(v?.price))
    .filter((n): n is number => n !== null);
  const price = prices.length ? Math.min(...prices) : null;
  if (price === null) return null;

  const handle = typeof row?.handle === 'string' ? row.handle : '';
  return {
    name,
    price,
    currency: 'ILS',
    /* `available` is per variant; the product is buyable if any variant is. */
    availability: variants.some((v) => v?.available) ? 'in_stock' : 'out_of_stock',
    url: handle ? `${origin.replace(/\/$/, '')}/products/${handle}` : origin,
    source: 'api',
  };
}

/*
 * The whole Shopify catalogue, paged.
 *
 * Shopify's HTML search is not usable for this: on the themes these nurseries
 * run, /search?q= returns the same page whatever you ask it (measured: identical
 * byte counts and currency-token counts across completely different queries),
 * and /search/suggest.json answers 417 "Unsupported buyer locale". The catalogue
 * is the only endpoint that tells the truth, so we take all of it and filter
 * locally.
 *
 * `complete` is the honest half of that trade: a catalogue cut off at the page
 * cap is a prefix, and a plant's absence from a prefix means nothing.
 */
export async function shopifyCatalogue(
  origin: string,
  opts: { maxPages?: number; limit?: number; batch?: number; fetchImpl?: FetchLike } = {}
): Promise<ApiResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? SHOPIFY_PAGE_SIZE;
  const maxPages = opts.maxPages ?? SHOPIFY_MAX_PAGES;
  const batch = Math.max(1, opts.batch ?? SHOPIFY_PAGE_BATCH);

  const products: StructuredProduct[] = [];
  let status = 0;
  let complete = false;

  /*
   * Page 1 alone first, then the rest in concurrent batches.
   *
   * The stopping condition is a short page, so pages cannot all be fired at
   * once without spending eight requests on a shop whose catalogue fits in one.
   * But the shops that DO need eight were paying eight serial round trips of a
   * quarter-megabyte each, on a cache that a Render cold start empties - which
   * is latency on the user's search, not on a warm-up. Page 1 decides whether
   * there is more at all; after that, three at a time turns 8 round trips into
   * 3 without ever requesting a page we did not already have reason to want.
   */
  pages: for (let first = 1; first <= maxPages; first += first === 1 ? 1 : batch) {
    const size = first === 1 ? 1 : Math.min(batch, maxPages - first + 1);
    const numbers = Array.from({ length: size }, (_, i) => first + i);
    const responses = await Promise.all(
      numbers.map((page) => getJson(shopifyPageUrl(origin, page, limit), fetchImpl))
    );

    /*
     * Consumed IN ORDER, whatever order they settled in. A gap in the middle of
     * a catalogue is not a catalogue: taking page 5 after page 4 failed would
     * report a prefix as if it were contiguous, and `complete` would then be a
     * claim about a set we never held.
     */
    for (let i = 0; i < responses.length; i++) {
      const { body, status: s } = responses[i];
      const rows = (body as any)?.products;
      if (!Array.isArray(rows)) {
        // Page 1 failing means no catalogue at all. A later page failing leaves
        // us with a prefix, which is usable but not proof of absence.
        if (numbers[i] === 1) return empty('shopify-json', s, false);
        status = status || s;
        break pages;
      }
      status = s;
      for (const row of rows) {
        const p = shopifyProduct(row, origin);
        if (p) products.push(p);
      }
      /* A short page is the end of the catalogue - the only signal this endpoint
       * gives, since it carries no total count. */
      if (rows.length < limit) {
        complete = true;
        break pages;
      }
    }
  }

  return { products, status, filteredByServer: false, route: 'shopify-json', complete };
}

// --- Route probe -------------------------------------------------------------

/*
 * Name a host's JSON route with two cheap requests, fired together.
 *
 * Measured live: both answer in under 3s, and a 200 here is stronger evidence
 * than anything in known-hosts.json - a Store API that returns products IS a
 * WooCommerce shop, whatever we previously wrote down. That is the mechanism
 * that corrects a mis-remembered platform on first contact rather than never.
 */
export async function probeApiRoute(
  origin: string,
  opts: { fetchImpl?: FetchLike } = {}
): Promise<ApiRoute> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const [woo, shopify] = await Promise.all([
    getJson(wooSearchUrl(origin, '', 1), fetchImpl),
    getJson(shopifyPageUrl(origin, 1, 1), fetchImpl),
  ]);

  /* An array - even an empty one - is the Store API answering. A WordPress site
   * without WooCommerce returns a `rest_no_route` object instead. */
  if (woo.status === 200 && Array.isArray(woo.body)) return 'woo-store';
  if (shopify.status === 200 && Array.isArray((shopify.body as any)?.products)) {
    return 'shopify-json';
  }
  return 'none';
}

/* The route a known platform implies, so a host we already identified does not
 * pay for a probe. `unknown` has to be probed; everything else is a guess we
 * would only have to verify anyway. */
export function routeForPlatform(platform: string): ApiRoute | null {
  if (platform === 'woo' || platform === 'woocommerce') return 'woo-store';
  if (platform === 'shopify') return 'shopify-json';
  return null;
}
