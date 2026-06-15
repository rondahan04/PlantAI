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

// --- platform template registry -------------------------------------------

/*
 * Search-URL templates keyed by platform slug. A template is a string with
 * {origin} and {query} placeholders. Built-ins cover the common platforms; the
 * LLM fallback (Layer 4) can teach us new ones at runtime via registerPlatform,
 * which persist to a JSON file so we only pay the LLM once per new platform.
 */
const BUILTIN_TEMPLATES: Record<string, string> = {
  shopify: '{origin}/search?q={query}',
  woo: '{origin}/?s={query}&post_type=product',
  wix: '{origin}/search?q={query}',
};

/* Normalize the many names an LLM or site uses down to our canonical slugs. */
const PLATFORM_ALIASES: Record<string, string> = {
  woocommerce: 'woo',
  wordpress: 'woo',
  'wordpress/woocommerce': 'woo',
  wixstores: 'wix',
};

let learnedTemplates: Record<string, string> = {};

export function normalizePlatform(name: string): string {
  const slug = (name || '').toLowerCase().trim().replace(/\s+/g, '');
  return PLATFORM_ALIASES[slug] ?? slug;
}

/* Load previously learned platform→template pairs (merged over built-ins). */
export function loadLearnedPlatforms(file: string): void {
  try {
    if (fs.existsSync(file)) learnedTemplates = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    learnedTemplates = {};
  }
}

/* Teach the registry a new platform and persist it ("add it to the formats"). */
export function registerPlatform(name: string, template: string, file?: string): void {
  learnedTemplates[normalizePlatform(name)] = template;
  if (file) {
    try {
      fs.writeFileSync(file, JSON.stringify(learnedTemplates, null, 2));
    } catch {
      /* best-effort persistence */
    }
  }
}

/* Return the search-URL template for a platform, or null if we don't know it. */
export function templateFor(platform: string): string | null {
  const slug = normalizePlatform(platform);
  return BUILTIN_TEMPLATES[slug] ?? learnedTemplates[slug] ?? null;
}

function applyTemplate(template: string, origin: string, query: string): string {
  return template.replace(/\{origin\}/g, origin).replace(/\{query\}/g, encodeURIComponent(query));
}

// --- LLM platform classification (Layer 4) --------------------------------

/* Signature of the scrape function identifyPlatform depends on. Injectable so
 * the cascade can be unit-tested without hitting the network. */
export type ScrapeFn = (
  url: string,
  key: string,
  opts?: { waitFor?: number; attempt?: number }
) => Promise<string>;

/* Signature of the JSON LLM call. Injectable for tests. */
export type ClassifyFn = (prompt: string, key: string, maxTokens?: number) => Promise<any>;

/*
 * Distill homepage content into a compact platform fingerprint for the LLM:
 * the host/CDN/script URLs plus any generator hint and a content head. Pure.
 */
export function platformFingerprint(content: string, max = 2500): string {
  const s = content || '';
  const signals = new Set<string>();
  for (const m of s.matchAll(/https?:\/\/[a-z0-9.\-]+\.[a-z]{2,}[^\s)"']*/gi)) {
    signals.add(m[0].slice(0, 120));
    if (signals.size >= 40) break;
  }
  const generator = (s.match(/generator["'>\s:]+[^"'<\n]{0,60}/i) || [])[0] ?? '';
  return [generator, [...signals].join('\n'), '---', s.slice(0, max)].filter(Boolean).join('\n');
}

export interface LLMClassification {
  platform: string;
  searchTemplate: string | null;
}

/*
 * Ask the LLM to name the e-commerce platform and give a product-search URL
 * template. Returns {platform:'unknown'} on any failure. Never throws.
 */
export async function classifyPlatformLLM(
  fingerprint: string,
  openaiKey: string,
  classify: ClassifyFn = callOpenAIJson
): Promise<LLMClassification> {
  const prompt = `You are identifying the e-commerce platform / CMS of a website from its homepage signals.
Common platforms: shopify, woocommerce, wix, magento, bigcommerce, squarespace, prestashop, opencart, or "custom".
Return ONLY JSON: { "platform": "<lowercase slug>", "searchTemplate": "<product search URL template using {origin} and {query}, or null>" }
Template examples: woocommerce -> "{origin}/?s={query}&post_type=product", shopify -> "{origin}/search?q={query}", magento -> "{origin}/catalogsearch/result/?q={query}".
If you cannot tell, return { "platform": "unknown", "searchTemplate": null }.
Homepage signals:\n${fingerprint}`;
  try {
    const out = await classify(prompt, openaiKey, 300);
    const platform = normalizePlatform(String(out.platform ?? 'unknown'));
    const searchTemplate =
      typeof out.searchTemplate === 'string' && out.searchTemplate.includes('{query}')
        ? out.searchTemplate
        : null;
    return { platform, searchTemplate };
  } catch {
    return { platform: 'unknown', searchTemplate: null };
  }
}

/*
 * Identify a site's platform with layered fallbacks so a cold first run lands
 * on a real platform with high probability instead of bailing to 'unknown':
 *
 *   L1  fast static homepage markers      ─▶ done (common case)
 *   L2  rendered homepage markers         ─▶ catches JS/SPA sites
 *   L3  well-known endpoints              ─▶ Shopify /products.json, Woo /wp-json/
 *   L4  LLM classifies homepage signals   ─▶ names platform + search template;
 *                                            brand-new platforms are registered
 *                                            so future sites skip the LLM
 *   else 'unknown' → caller probes search URLs (still self-corrects)
 *
 * Never throws; each layer is best-effort.
 */
export interface IdentifyOpts {
  scrape?: ScrapeFn;
  openaiKey?: string;
  learnedFile?: string;
  classify?: ClassifyFn;
}

export async function identifyPlatform(
  origin: string,
  firecrawlKey: string,
  opts: IdentifyOpts = {}
): Promise<string> {
  const { scrape = scrapeUrl, openaiKey, learnedFile, classify } = opts;

  // L1 — fast static homepage.
  const home0 = await safeScrape(scrape, origin, firecrawlKey, 0);
  let p: string = detectPlatform(home0);
  if (p !== 'unknown') return p;

  // L2 — rendered homepage (client-rendered storefronts).
  const home = await safeScrape(scrape, origin, firecrawlKey, 4000);
  p = detectPlatform(home);
  if (p !== 'unknown') return p;

  // L3 — platform-specific endpoints (content-independent tells).
  const shopify = await safeScrape(scrape, `${origin}/products.json`, firecrawlKey, 0);
  if (/"handle"\s*:|"variants"\s*:|"product_type"\s*:/.test(shopify)) return 'shopify';
  const wp = await safeScrape(scrape, `${origin}/wp-json/`, firecrawlKey, 0);
  if (/wp\/v2|"namespace"|"routes"/.test(wp)) return 'woo';

  // L4 — LLM classifies whatever homepage content we have, and teaches us the
  // search template for platforms we don't yet know.
  const content = home || home0;
  if (openaiKey && content) {
    const { platform, searchTemplate } = await classifyPlatformLLM(
      platformFingerprint(content),
      openaiKey,
      classify
    );
    if (platform && platform !== 'unknown') {
      if (!templateFor(platform) && searchTemplate) {
        registerPlatform(platform, searchTemplate, learnedFile);
      }
      if (templateFor(platform)) return platform;
    }
  }

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
 * Build product-search URL(s) for a site. Known/learned platforms return one
 * URL from their template; unknown returns an ordered probe list.
 */
export function searchUrlsFor(origin: string, query: string, platform: string): string[] {
  const tpl = templateFor(platform);
  if (tpl) return [applyTemplate(tpl, origin, query)];
  const q = encodeURIComponent(query);
  return [
    `${origin}/?s=${q}&post_type=product`,
    `${origin}/search?q=${q}`,
    `${origin}/?s=${q}`,
  ];
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

/* Call the OpenAI model in JSON mode and return the parsed object. Throws on
 * non-2xx or unparseable content so callers can decide how to degrade. */
export const OPENAI_MODEL = 'gpt-5.5-mini';

export async function callOpenAIJson(
  prompt: string,
  openaiKey: string,
  maxTokens = 1200
): Promise<any> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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
  platform: string;
  picked: string | null;
}

export interface SearcherOpts {
  openaiKey?: string;
  learnedFile?: string;
}

/*
 * Create a searcher bound to a Firecrawl key, with a per-host platform cache.
 * A cold host pays one extra homepage fetch to detect its platform; warm hosts
 * reuse the cached value. Pass openaiKey to enable the LLM Layer-4 fallback for
 * sites the heuristics can't classify. Unknown platforms probe candidate URLs
 * in parallel and keep the highest-scoring result.
 */
export function createSearcher(firecrawlKey: string, opts: SearcherOpts = {}) {
  const platformCache = new Map<string, string>();
  if (opts.learnedFile) loadLearnedPlatforms(opts.learnedFile);

  async function resolvePlatform(origin: string, host: string): Promise<string> {
    const cached = platformCache.get(host);
    if (cached) return cached;
    const platform = await identifyPlatform(origin, firecrawlKey, {
      openaiKey: opts.openaiKey,
      learnedFile: opts.learnedFile,
    });
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
