/**
 * Shared nursery-scraping core. Single source of truth for the Firecrawl +
 * OpenAI pipeline and the platform-aware product search. Consumed by:
 *   - dashboard/server.ts        (interactive query dashboard)
 *   - scripts/scrape-nurseries.ts (offline nurseries.json builder)
 *
 * Node-only (uses fs + global fetch). Not bundled into the RN app — see the
 * tsconfig `exclude` list. Pure functions (detectPlatform / searchUrlsFor /
 * scoreMarkdown / priceFocusedExcerpt) are unit-tested in core.test.ts.
 *
 *   detectPlatform(md) ─▶ 'shopify'|'woo'|'wix'|'unknown'
 *           │
 *   searchUrlsFor(origin,q,p) ─▶ ['…'] known | ['…','…','…'] probe
 *           │                                      │
 *   createSearcher(key).fetchSearchMarkdown ◀──────┘ (scrape + score + cache)
 *           │
 *   priceFocusedExcerpt → callOpenAIJson → {name, price}
 */

import * as fs from 'fs';

export type Platform = 'shopify' | 'woo' | 'wix' | 'unknown';

// --- env -------------------------------------------------------------------

/* Load a .env file into process.env (no dotenv dependency). */
export function loadEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
    }
  }
}

// --- Firecrawl -------------------------------------------------------------

/*
 * Scrape a URL to markdown via Firecrawl. Retries transient failures
 * (408/429/5xx + network blips) up to 3x. Pass waitFor 0 for static-HTML
 * reads (platform detection); the default lets JS search grids render.
 */
export async function scrapeUrl(
  url: string,
  firecrawlKey: string,
  opts: { waitFor?: number; attempt?: number } = {}
): Promise<string> {
  const { waitFor = 3500, attempt = 1 } = opts;
  let res: Response;
  try {
    res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firecrawlKey}` },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor }),
    });
  } catch (err) {
    if (attempt < 3) return scrapeUrl(url, firecrawlKey, { waitFor, attempt: attempt + 1 });
    throw err;
  }
  if ((res.status === 408 || res.status === 429 || res.status >= 500) && attempt < 3) {
    return scrapeUrl(url, firecrawlKey, { waitFor, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const data = await res.json();
  return data.data?.markdown ?? '';
}

// --- platform detection (pure) ---------------------------------------------

/*
 * Detect the store platform from page content (markdown or raw HTML).
 * Order matters — check Shopify before Woo. Shopify uses /products/ (plural)
 * and /collections/; Woo uses /product/ (singular) and /product-category/,
 * so the Woo `/product/` test never matches a Shopify /products/ link.
 *
 * Markers are deliberately broad (theme JS globals, CDN hosts, REST roots,
 * cart endpoints) so a single homepage read identifies most stores.
 */
export function detectPlatform(content: string | null): Platform {
  const s = content || '';
  if (
    /\/cdn\/shop\/|cdn\.shopify\.com|myshopify\.com|Shopify\.theme|window\.Shopify|shopify-section|\/collections\/|\/products\//.test(
      s
    )
  )
    return 'shopify';
  if (
    /wp-content|wp-json|woocommerce|wc-block|add-to-cart=|\/product-category\/|\/product\//.test(s)
  )
    return 'woo';
  if (/wixstatic\.com|static\.wixstatic|_wix|wixsite|X-Wix|Pepyaka/.test(s)) return 'wix';
  return 'unknown';
}

/* Signature of the scrape function identifyPlatform depends on. Injectable so
 * the cascade can be unit-tested without hitting the network. */
export type ScrapeFn = (
  url: string,
  key: string,
  opts?: { waitFor?: number; attempt?: number }
) => Promise<string>;

/*
 * Identify a site's platform with layered fallbacks so a cold first run lands
 * on a real platform with high probability instead of bailing to 'unknown':
 *
 *   Layer 1  fast static homepage (waitFor 0) ─ markers ─▶ done (common case)
 *   Layer 2  rendered homepage (waitFor)       ─ markers ─▶ catches JS/SPA sites
 *   Layer 3  well-known endpoints              ─▶ Shopify /products.json,
 *                                                 WordPress/Woo /wp-json/
 *   else     'unknown' → caller probes search URLs (still self-corrects)
 *
 * Never throws; each layer is best-effort.
 */
export async function identifyPlatform(
  origin: string,
  firecrawlKey: string,
  scrape: ScrapeFn = scrapeUrl
): Promise<Platform> {
  // Layer 1 — fast static homepage.
  let p = detectPlatform(await safeScrape(scrape, origin, firecrawlKey, 0));
  if (p !== 'unknown') return p;

  // Layer 2 — rendered homepage (client-rendered storefronts).
  p = detectPlatform(await safeScrape(scrape, origin, firecrawlKey, 4000));
  if (p !== 'unknown') return p;

  // Layer 3 — platform-specific endpoints (content-independent tells).
  const shopify = await safeScrape(scrape, `${origin}/products.json`, firecrawlKey, 0);
  if (/"handle"\s*:|"variants"\s*:|"product_type"\s*:/.test(shopify)) return 'shopify';

  const wp = await safeScrape(scrape, `${origin}/wp-json/`, firecrawlKey, 0);
  if (/wp\/v2|"namespace"|"routes"/.test(wp)) return 'woo';

  return 'unknown';
}

async function safeScrape(
  scrape: ScrapeFn,
  url: string,
  key: string,
  waitFor: number
): Promise<string> {
  try {
    return await scrape(url, key, { waitFor });
  } catch {
    return '';
  }
}

/*
 * Build product-search URL(s) for a site. Known platforms return one URL;
 * unknown returns an ordered probe list (most-likely first).
 */
export function searchUrlsFor(origin: string, query: string, platform: Platform): string[] {
  const q = encodeURIComponent(query);
  switch (platform) {
    case 'shopify':
      return [`${origin}/search?q=${q}`];
    case 'woo':
      return [`${origin}/?s=${q}&post_type=product`];
    case 'wix':
      return [`${origin}/search?q=${q}`];
    default:
      return [
        `${origin}/?s=${q}&post_type=product`,
        `${origin}/search?q=${q}`,
        `${origin}/?s=${q}`,
      ];
  }
}

/*
 * Score a scraped search page for the probe path. Product permalinks + prices
 * + a query echo ("results for X") distinguish a real results page from a
 * homepage returned when the site ignored the search param.
 */
export function scoreMarkdown(markdown: string | null, query: string): number {
  const s = markdown || '';
  const prices = (s.match(/₪/g) || []).length;
  const productLinks = (s.match(/\/products?\//g) || []).length;
  const queryEcho = query && s.includes(query) ? 50 : 0;
  return prices + productLinks + queryEcho;
}

// --- excerpt (pure) --------------------------------------------------------

/*
 * Homepages/search pages are 100KB+ and front-loaded with cookie/nav
 * boilerplate + base64 images. Strip images, then keep only product-ish lines
 * (headings, ILS prices, product permalinks) so the model sees a clean
 * name->price catalog. Themes vary: `##### [Name](url)`, plain `# Name`,
 * `- [**Name** ₪price](url)` — all are kept.
 */
export function priceFocusedExcerpt(markdown: string, max = 18000): string {
  const kept = markdown
    .split('\n')
    .map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('data:image'))
    .filter((l) => /^#{1,6}\s/.test(l) || l.includes('₪') || /\/products?\//.test(l));
  return kept.join('\n').slice(0, max);
}

// --- OpenAI ----------------------------------------------------------------

/* Call gpt-4o-mini in JSON mode and return the parsed object. Throws on
 * non-2xx or unparseable content so callers can decide how to degrade. */
export async function callOpenAIJson(
  prompt: string,
  openaiKey: string,
  maxTokens = 1200
): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- search orchestration --------------------------------------------------

export interface SearchResult {
  md: string;
  platform: Platform;
  picked: string | null;
}

/*
 * Create a searcher bound to a Firecrawl key, with a per-host platform cache.
 * A cold host pays one extra homepage fetch to detect its platform; warm hosts
 * reuse the cached value. Unknown platforms probe candidate URLs in parallel
 * and keep the highest-scoring result.
 */
export function createSearcher(firecrawlKey: string) {
  const platformCache = new Map<string, Platform>();

  async function resolvePlatform(origin: string, host: string): Promise<Platform> {
    const cached = platformCache.get(host);
    if (cached) return cached;
    const platform = await identifyPlatform(origin, firecrawlKey);
    platformCache.set(host, platform);
    return platform;
  }

  async function fetchSearchMarkdown(
    baseUrl: string,
    query: string,
    host: string
  ): Promise<SearchResult> {
    const { origin } = new URL(baseUrl);
    const platform = await resolvePlatform(origin, host);
    const urls = searchUrlsFor(origin, query, platform);

    if (urls.length === 1) {
      return { md: await scrapeUrl(urls[0], firecrawlKey), platform, picked: urls[0] };
    }

    const settled = await Promise.allSettled(urls.map((u) => scrapeUrl(u, firecrawlKey)));
    let best: SearchResult & { score: number } = { md: '', platform, picked: null, score: -1 };
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        const score = scoreMarkdown(s.value, query);
        if (score > best.score) best = { md: s.value, platform, picked: urls[i], score };
      }
    });
    return { md: best.md, platform, picked: best.picked };
  }

  return { fetchSearchMarkdown, resolvePlatform };
}
