/*
 * The third way into a shop: its sitemap.
 *
 * WHY. Ten of the sixteen nurseries we know publish a storefront JSON API, and
 * on those a search is exact, free and modelless (scraper/platformApi.ts). The
 * other six - and every new shop Places finds that turns out to be one of them -
 * ride the HTML+LLM path, which is the weakest thing this codebase does and the
 * one the offline metric cannot see (docs/RETRIEVAL.md, "Honest limits").
 *
 * When that path fails it fails in a specific way: the shop's own search is
 * broken or missing. yahalomr.co.il has no /search endpoint and 404s every
 * query; other shops hand back their front page whatever you ask. In both cases
 * we report "we could not read this shop", and in both cases the shop is
 * publishing a complete, machine-readable list of every product it sells, at a
 * URL standardised twenty years ago, for free.
 *
 * WHAT THIS IS NOT. It is not a crawler and it is not evidence of absence. A
 * slug is a shop's idea of a URL, not a product title: some are Hebrew
 * percent-encoded, some are Latin transliterations, some are numbers. A plant
 * missing from the slugs may be on the shelf under a name the URL does not
 * carry, so this module can only ever ADD a shop we could not otherwise read -
 * `catalogueRead` is never set from here.
 *
 *   sitemapProductUrls(origin)  ─▶ every product URL the shop publishes
 *           │                      (cached per host; robots.txt, then the
 *           │                       well-known locations)
 *   rankSitemapLinks(urls, plan) ─▶ the handful whose slug names the plant
 *           │
 *           ─▶ followProductPages() prices them from their own markup
 */

import { scoreCandidate, type QueryPlan } from './queryPlan.ts';

/* Same budget as core.ts RAW_HTML_TIMEOUT_MS: a plain GET against a shop. */
export const SITEMAP_TIMEOUT_MS = 8000;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/*
 * A sitemap index can point at dozens of children, and a large shop's product
 * sitemap is megabytes. Both caps exist so a rescue stays a rescue: this runs
 * inside the per-site deadline of a search a user is waiting on.
 */
export const MAX_SITEMAP_FETCHES = 4;
export const MAX_SITEMAP_BYTES = 5_000_000;
export const MAX_PRODUCT_URLS = 5000;

/* How long a shop's product list is worth remembering. A catalogue does not
 * turn over faster than this, and the same shop is asked for a different plant
 * minutes later. */
export const SITEMAP_TTL_MS = 6 * 60 * 60 * 1000;

/* Where shops put sitemaps when robots.txt does not say. WordPress core, Yoast,
 * RankMath, Shopify and the plain default, in the order they are worth trying. */
const WELL_KNOWN = [
  '/sitemap_index.xml',
  '/wp-sitemap.xml',
  '/sitemap.xml',
  '/product-sitemap.xml',
  '/sitemap_products_1.xml',
];

/*
 * A child sitemap worth opening: the ones naming products.
 *
 * Word boundaries are load-bearing here, and not for a subtle reason: the word
 * "sitemap" contains "item", so a loose alternation calls `post-sitemap.xml`
 * and `author-sitemap.xml` product sitemaps and opens every one of them.
 */
const PRODUCTISH_SITEMAP = /(?<![a-z])(products?|items?|shop|catalog|store)(?![a-z])/i;

/* A URL that is a product page rather than a post, a category or a page. The
 * shapes core.ts already recognises, plus Joomla's `-detail` suffix, which is
 * how mashtela-urbanit links every one of its products. */
const PRODUCT_URL_RE =
  /\/(?:products?|product-page|catalog\/product|shop\/p|items)\/|-detail(?:$|[/?#])/i;

/* Paths that are never a product even when they sit under a product prefix. */
const NON_PRODUCT_URL_RE = /\/(?:product-category|product-tag|collections?|blog|category|tag)\//i;

export type FetchLike = typeof fetch;

export interface SitemapResult {
  /* Every product URL the shop publishes, deduped and capped. */
  urls: string[];
  /* False when nothing could be read - no robots.txt, no well-known location,
   * or every candidate refused us. A caller must not read an empty list as a
   * catalogue it has seen. */
  read: boolean;
}

/*
 * One text fetch, with every failure flattened into an empty string.
 *
 * Same contract as core.ts's raw reader and platformApi's getJson: on every
 * path there is a slower route that still works, so a throw here would turn a
 * shop we could have read into a shop we reported as broken.
 */
async function getText(url: string, fetchImpl: FetchLike): Promise<string> {
  const once = async (target: string): Promise<{ body: string; reached: boolean }> => {
    try {
      const res = await fetchImpl(target, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/xml,text/xml,text/plain,*/*' },
        signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
      });
      if (!res.ok) return { body: '', reached: true };
      /* A shop with a 40MB sitemap is a shop this rescue should walk away from
       * rather than spend a user's search reading. */
      const size = Number(res.headers?.get?.('content-length') ?? '');
      if (Number.isFinite(size) && size > MAX_SITEMAP_BYTES) return { body: '', reached: true };
      const body = await res.text();
      return { body: body.length > MAX_SITEMAP_BYTES ? '' : body, reached: true };
    } catch {
      /* Never reached: DNS, TLS, or our own deadline. */
      return { body: '', reached: false };
    }
  };

  const first = await once(url);
  /*
   * Retry a dead https over http, on the same rule core.ts uses for a shop's
   * pages: small Israeli nurseries outlive their certificates, and a connection
   * that never happened is the only case worth asking again. An http 404 is a
   * real answer; a page that loaded is not improved by fetching it insecurely.
   *
   * It matters more here than anywhere: a shop whose certificate has expired is
   * exactly the kind whose search we could not read either, which is what made
   * this route worth having.
   */
  if (first.reached || !url.startsWith('https://')) return first.body;
  return (await once(`http://${url.slice('https://'.length)}`)).body;
}

/* Every <loc> in a sitemap or sitemap index. Generated XML, so a reader rather
 * than a parser is the right tool - and it cannot be tripped by a shop's odd
 * namespace prefix. */
export function locsIn(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1]));
  return out;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/* Is this an index pointing at other sitemaps, or a list of pages? */
function isIndex(xml: string): boolean {
  return /<sitemapindex/i.test(xml);
}

export function isProductUrl(url: string): boolean {
  if (NON_PRODUCT_URL_RE.test(url)) return false;
  return PRODUCT_URL_RE.test(url);
}

/* The sitemaps robots.txt advertises. The canonical way to find them, and the
 * only one that works on a shop using a non-standard location. */
export function sitemapsInRobots(robots: string): string[] {
  return (robots || '')
    .split('\n')
    .map((l) => /^\s*sitemap:\s*(\S+)/i.exec(l)?.[1])
    .filter((u): u is string => Boolean(u));
}

const cache = new Map<string, { result: SitemapResult; at: number }>();
const inFlight = new Map<string, Promise<SitemapResult>>();

/* Exported for the tests, and for a process that wants to forget a shop. */
export function clearSitemapCache(): void {
  cache.clear();
  inFlight.clear();
}

/*
 * Every product URL a shop publishes.
 *
 * Cached and in-flight-deduped per origin, for the same reason the Shopify
 * catalogue is: a fan-out asks one shop for one plant, and the next search asks
 * the same shop for another. Reading its product list twice in six hours is
 * work nobody needs.
 */
export async function sitemapProductUrls(
  origin: string,
  opts: { fetchImpl?: FetchLike; now?: () => number } = {}
): Promise<SitemapResult> {
  const now = opts.now ?? Date.now;
  const base = origin.replace(/\/$/, '');
  const hit = cache.get(base);
  if (hit && now() - hit.at < SITEMAP_TTL_MS) return hit.result;
  const flying = inFlight.get(base);
  if (flying) return flying;

  const job = readSitemaps(base, opts.fetchImpl ?? fetch)
    .then((result) => {
      cache.set(base, { result, at: now() });
      return result;
    })
    .finally(() => inFlight.delete(base));

  inFlight.set(base, job);
  return job;
}

async function readSitemaps(base: string, fetchImpl: FetchLike): Promise<SitemapResult> {
  let budget = MAX_SITEMAP_FETCHES;

  /* robots.txt first: it is small, it is where the answer is meant to live, and
   * it costs one request to avoid guessing four. */
  const robots = await getText(`${base}/robots.txt`, fetchImpl);
  const advertised = sitemapsInRobots(robots).filter(sameOrigin(base));
  const candidates = advertised.length ? advertised : WELL_KNOWN.map((p) => `${base}${p}`);

  const urls: string[] = [];
  const seen = new Set<string>();
  let read = false;

  /* Children discovered from an index, queued behind the roots. */
  const queue = [...candidates];
  while (queue.length && budget > 0) {
    const next = queue.shift()!;
    /* A gzipped sitemap is a file we would have to decompress ourselves; the
     * shops that publish one publish the plain form too. */
    if (/\.gz($|\?)/i.test(next)) continue;
    budget -= 1;
    const xml = await getText(next, fetchImpl);
    if (!xml) continue;
    read = true;

    if (isIndex(xml)) {
      const children = locsIn(xml)
        .filter(sameOrigin(base))
        .filter((u) => PRODUCTISH_SITEMAP.test(u));
      /* Product sitemaps only. An index also lists posts, pages, authors and
       * category archives, and opening those spends the budget on things that
       * can never be a product. */
      queue.unshift(...children);
      continue;
    }

    for (const loc of locsIn(xml)) {
      if (!sameOrigin(base)(loc) || !isProductUrl(loc)) continue;
      if (seen.has(loc)) continue;
      seen.add(loc);
      urls.push(loc);
      if (urls.length >= MAX_PRODUCT_URLS) return { urls, read: true };
    }
    /*
     * The roots are tried in order of how likely they are to be the shop's
     * real sitemap, so once one of them has yielded products there is nothing
     * to gain from opening the next.
     */
    if (urls.length > 0 && !queue.length) break;
  }

  return { urls, read };
}

function sameOrigin(base: string): (url: string) => boolean {
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return () => false;
  }
  return (url: string) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  };
}

/*
 * The product name a URL carries, as well as a URL can carry one.
 *
 * Shops write slugs three ways and all three appear in one country: Hebrew
 * percent-encoded (`/product/%D7%9E%D7%95%D7%A0%D7%A1%D7%98%D7%A8%D7%94/`), a
 * Latin transliteration (`/product/monstera-deliciosa/`), and the Hebrew with a
 * platform suffix (`/catalog/.../מונסטרה-detail`). The plan carries both Hebrew
 * and Latin tokens, so a slug in either language can be ranked - which is the
 * reason this is worth doing at all.
 */
export function slugTitle(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return '';
  }
  const last =
    path
      .split('/')
      .filter(Boolean)
      .pop() ?? '';
  let text = last;
  try {
    text = decodeURIComponent(last);
  } catch {
    /* A malformed escape is a slug we read as written rather than drop. */
  }
  return text
    .replace(/-detail$/i, '')
    .replace(/\.(?:html?|php|aspx?)$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface SitemapLink {
  name: string;
  url: string;
}

/*
 * The product URLs whose slug names the plant, best first.
 *
 * The bar is the same one `productLinks` uses on a page's anchors: any score
 * above zero means the genus is in the text, and which cultivar it actually is
 * gets settled later, on a priced row, by the adjudicator. A slug is weaker
 * evidence than an anchor's text, so this only ever decides what to OPEN.
 */
export function rankSitemapLinks(urls: string[], plan: QueryPlan, max = 5): SitemapLink[] {
  const scored = urls
    .map((url) => {
      const name = slugTitle(url);
      return { url, name, score: name ? scoreCandidate(name, plan) : 0 };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map(({ name, url }) => ({ name, url }));
}
