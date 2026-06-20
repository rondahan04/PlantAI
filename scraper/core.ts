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
/*
 * Primary scrape provider: Firecrawl. Retries up to 3x on network throw or a
 * transient status (408/429/5xx). Returns markdown ('' if the page yielded
 * none) or throws on a non-retryable / exhausted failure.
 *
 * The retry recursion lives HERE, one layer below the Tavily fallback in
 * scrapeUrl, so a retried Firecrawl call can never accidentally drop the
 * fallback key — the fallback decision is made once, after this resolves.
 */
async function firecrawlScrape(
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
    if (attempt < 3) return firecrawlScrape(url, firecrawlKey, { waitFor, attempt: attempt + 1 });
    throw err;
  }
  if ((res.status === 408 || res.status === 429 || res.status >= 500) && attempt < 3) {
    return firecrawlScrape(url, firecrawlKey, { waitFor, attempt: attempt + 1 });
  }
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const data = await res.json();
  return data.data?.markdown ?? '';
}

/*
 * Fallback scrape provider: Tavily Extract (https://api.tavily.com/extract).
 * URL in, markdown out — a direct analog of Firecrawl scrape. `extract_depth`
 * defaults to 'advanced' because Tavily is only ever reached after Firecrawl
 * already failed, so we spend the extra credit to maximize rescue odds.
 * `fetchImpl` is injectable so the parser can be unit-tested without network.
 * Throws on a non-2xx response or when Tavily reports the URL in failed_results.
 */
export async function tavilyExtract(
  url: string,
  tavilyKey: string,
  opts: { extractDepth?: 'basic' | 'advanced' } = {},
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const { extractDepth = 'advanced' } = opts;
  const res = await fetchImpl('https://api.tavily.com/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavilyKey}` },
    body: JSON.stringify({ urls: url, format: 'markdown', extract_depth: extractDepth }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  const first = data.results?.[0];
  if (!first) {
    const err = data.failed_results?.[0]?.error ?? 'no results';
    throw new Error(`Tavily extract failed: ${err}`);
  }
  return first.raw_content ?? '';
}

/*
 * Pure scrape orchestration: try the primary provider, fall back to Tavily on
 * throw-OR-empty. "Empty" matters as much as "throw" — bot-walled sites
 * (e.g. irism.co.il) return HTTP 200 with len=0 markdown rather than erroring,
 * so a throw-only fallback would miss the common failure. Both providers are
 * injected, so every branch is unit-testable without touching the network.
 *
 *   primary md non-empty ─▶ return it (Firecrawl won, no Tavily cost)
 *   primary throws/empty + no tavilyKey ─▶ rethrow (throw) or return '' (empty)
 *   primary throws/empty + tavilyKey ─▶ Tavily; on its failure, surface the
 *                                       original primary error if there was one
 */
export async function resolveScrape(opts: {
  url: string;
  tavilyKey?: string;
  primary: (url: string) => Promise<string>;
  fallback: (url: string, key: string) => Promise<string>;
}): Promise<string> {
  const { url, tavilyKey, primary, fallback } = opts;
  let primaryErr: unknown;
  let md = '';
  try {
    md = await primary(url);
  } catch (err) {
    primaryErr = err;
  }
  if (md) return md;
  if (!tavilyKey) {
    if (primaryErr) throw primaryErr;
    return md; // '' — preserve today's empty-is-OK contract when no fallback configured
  }
  try {
    return await fallback(url, tavilyKey);
  } catch (fallbackErr) {
    throw primaryErr ?? fallbackErr; // both providers failed
  }
}

/*
 * Scrape a URL to markdown, with an optional Tavily fallback. Pass
 * opts.tavilyKey ONLY for real product scrapes — not for identifyPlatform's
 * detection probes, which return '' by design for the wrong platform and would
 * waste Tavily credits. Firecrawl retry/timeout config is forwarded unchanged.
 */
export async function scrapeUrl(
  url: string,
  firecrawlKey: string,
  opts: { waitFor?: number; attempt?: number; tavilyKey?: string } = {}
): Promise<string> {
  const { tavilyKey, ...fcOpts } = opts;
  return resolveScrape({
    url,
    tavilyKey,
    primary: (u) => firecrawlScrape(u, firecrawlKey, fcOpts),
    fallback: (u, k) => tavilyExtract(u, k),
  });
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
export const OPENAI_MODEL = 'gpt-5.5';

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
      max_completion_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- two-pass GPT extraction pipeline --------------------------------------
//
//   markdown ─▶ GPT-5.5 (extract) ─▶ GPT-5.5 (verify/critic) ─▶ verified plants
//
// Pass 1 extracts the plant JSON; pass 2 re-reads the source as a strict
// auditor and confirms (or corrects) every field before we trust it. Only an
// OpenAI key is required; missing key skips verification.

export type Availability = 'in_stock' | 'out_of_stock' | 'unknown';

/* The structural schema every pass extracts/returns. */
export interface Plant {
  name: string;
  price: string; // ILS, e.g. "₪49"
  availability: Availability;
}

/* GPT-5.5 auditor verdict. */
export interface VerificationReport {
  is_valid: boolean;
  confidence_score: number; // 0..100
  feedback: string;
  corrected_output: Plant[];
}

export interface PipelineResult {
  plants: Plant[];
  report: VerificationReport;
  engines: { extractor: 'gpt-5.5' | 'none'; verifier: 'gpt-5.5' | 'none' };
}

function coercePlants(items: any): Plant[] {
  if (!Array.isArray(items)) return [];
  const valid: Availability[] = ['in_stock', 'out_of_stock', 'unknown'];
  return items
    .filter((it) => it && typeof it === 'object' && it.name && it.price)
    .map((it) => ({
      name: String(it.name),
      price: String(it.price),
      availability: valid.includes(it.availability) ? it.availability : 'unknown',
    }));
}

/* Extraction pass: GPT-5.5 reads the condensed markdown and returns the plant
 * JSON array matching the Plant schema. */
export async function extractPlants(
  excerpt: string,
  query: string,
  site: string,
  openaiKey: string
): Promise<Plant[]> {
  const prompt = `You are extracting products from a plant nursery website (${site}).
The content is mostly Hebrew. The user searched for: "${query}" (match either English or Hebrew, including translations and related plant types).
From the content below, return ONLY products that match the search query.
Return ONLY valid JSON in exactly this shape:
{ "plants": [{ "name": "product name in its original language", "price": "₪XX", "availability": "in_stock" | "out_of_stock" | "unknown" }] }
Rules:
- Prices MUST be in ILS (₪). If a price has no currency symbol assume ILS and add ₪.
- Only REAL products that have a price. Ignore blog posts, articles, guides ("איך לגדל"), categories, cart/shipping/total/free-shipping lines.
- availability: "out_of_stock" only if the text clearly says sold out / אזל / לא במלאי; "in_stock" if clearly purchasable; otherwise "unknown".
- If nothing matches, return { "plants": [] }.
Content:\n${excerpt}`;
  return coercePlants((await callOpenAIJson(prompt, openaiKey, 2000)).plants);
}

/* Verification pass: GPT-5.5 acts strictly as an auditor. It cross-references
 * the extracted JSON against the source text and returns a strict verdict. */
export async function verifyPlantsWithGPT(
  excerpt: string,
  plants: Plant[],
  query: string,
  site: string,
  openaiKey: string
): Promise<VerificationReport> {
  const prompt = `You are a strict data auditor for a plant nursery scraper (${site}). The data below was extracted in a separate pass. Your only job is to verify it against the SOURCE TEXT — do not extract anything new.
The user searched for: "${query}". The source is mostly Hebrew.
Cross-reference every field of the extracted JSON against the SOURCE TEXT and check:
- Plant name: is it actually present in the source and accurately captured (not hallucinated, not a blog/category)?
- Price: does it match the source EXACTLY? Was the number or the currency misread? Prices must be ILS (₪).
- Availability: is in_stock/out_of_stock/unknown justified by the text context?
Return ONLY valid JSON in exactly this shape:
{
  "is_valid": boolean,
  "confidence_score": number,        // 0 to 100
  "feedback": string,                // explain any issues found; "" if none
  "corrected_output": [ { "name": "...", "price": "₪XX", "availability": "in_stock" | "out_of_stock" | "unknown" } ]
}
Rules:
- is_valid = true only if every returned item is faithful to the source.
- corrected_output: the verified, clean list. Fix minor errors (wrong price, bad availability), DROP hallucinated/unsupported items. If everything was already correct, return the same items.
- Never invent products that are not in the source text.

EXTRACTED JSON TO AUDIT:
${JSON.stringify({ plants }, null, 2)}

SOURCE TEXT:
${excerpt}`;

  const parsed = await callOpenAIJson(prompt, openaiKey, 2000);
  return {
    is_valid: Boolean(parsed.is_valid),
    confidence_score: Number(parsed.confidence_score) || 0,
    feedback: String(parsed.feedback ?? ''),
    corrected_output: coercePlants(parsed.corrected_output),
  };
}

/* Orchestrate the two-pass pipeline: GPT-5.5 extracts, GPT-5.5 verifies.
 * Returns the verified plants plus the auditor's report. Per the workflow: on
 * is_valid the verified data is returned; on a rejection the failure feedback
 * is logged for evaluation. */
export async function extractAndVerifyPlants(opts: {
  markdown: string;
  query: string;
  site: string;
  openaiKey?: string;
}): Promise<PipelineResult> {
  const { markdown, query, site, openaiKey } = opts;
  const excerpt = priceFocusedExcerpt(markdown);

  const empty = (feedback: string): PipelineResult => ({
    plants: [],
    report: { is_valid: false, confidence_score: 0, feedback, corrected_output: [] },
    engines: { extractor: 'none', verifier: 'none' },
  });

  if (!excerpt.trim()) return empty('empty excerpt — no product/price lines matched');
  if (!openaiKey) return empty('no OpenAI key available');

  // --- Extraction pass -----------------------------------------------------
  const extracted = await extractPlants(excerpt, query, site, openaiKey);

  // --- Verification pass ----------------------------------------------------
  const report = await verifyPlantsWithGPT(excerpt, extracted, query, site, openaiKey);
  const verified = report.corrected_output.length ? report.corrected_output : extracted;

  if (!report.is_valid) {
    // Self-correction loop: log the failure feedback for evaluation.
    console.log(
      `   [${site}] ⚠️  verification REJECTED (conf ${report.confidence_score}): ${report.feedback}`
    );
  }

  return { plants: verified, report, engines: { extractor: 'gpt-5.5', verifier: 'gpt-5.5' } };
}

// --- availability inference (informational / no-shop sites) -----------------
//
// When the structured pipeline returns 0 items, that result is overloaded: the
// shop may genuinely lack the plant, its search may have failed, OR the site is
// purely informational with no online store at all. For that last case the
// homepage text still carries signal ("we grow herbs and Mediterranean
// perennials") that a human would read as "they probably stock sage". This call
// turns that text into an explicit 0–100 likelihood so the UI can show
// "~75% likely" instead of a bare, ambiguous "nothing found".
//
// Pair it with the SITE HOMEPAGE, not the (often empty/broken) search page.

export interface AvailabilityEstimate {
  confidence: number; // 0–100: likelihood the nursery carries the queried plant
  reasoning: string; // one-line justification, or why no estimate was possible
}

const clampConfidence = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
};

/* Estimate, from a nursery's website text, how likely it stocks `query`.
 * Used only as a fallback when structured extraction found nothing. Never
 * throws — returns a 0-confidence estimate on empty input or any LLM failure. */
export async function inferAvailabilityLLM(
  siteText: string,
  query: string,
  site: string,
  openaiKey: string,
  classify: ClassifyFn = callOpenAIJson
): Promise<AvailabilityEstimate> {
  if (!siteText.trim()) {
    return { confidence: 0, reasoning: 'no reachable site content' };
  }
  const excerpt = siteText.slice(0, 12000); // homepage/about text is plenty
  const prompt = `You estimate whether a plant nursery (${site}) likely sells a given plant, from its website text (mostly Hebrew). A structured product search already found nothing — the site may have no online shop, or its search failed, so judge from the general text.
The user wants: "${query}" (match English or Hebrew, including translations / related plant types).
Consider: does the nursery deal in this plant's category (herbs, perennials, houseplants, succulents, trees, flowers)? Is it a general nursery that would plausibly carry a common plant? Does the text explicitly mention it?
Return ONLY JSON: { "confidence": <0-100>, "reasoning": "<short, one sentence>" }
Scale: 0 = clearly does not sell this type; 50 = general nursery, could plausibly have it; 85+ = the text strongly implies or names it.
Website text:\n${excerpt}`;
  try {
    // 1500: gpt-5.5 spends completion tokens on hidden reasoning first, so a
    // tight cap (200/500) returns empty content → JSON.parse fails → false
    // "unavailable". 1500 reliably clears reasoning + the tiny JSON output.
    const out = await classify(prompt, openaiKey, 1500);
    return {
      confidence: clampConfidence(out.confidence),
      reasoning: String(out.reasoning ?? '').slice(0, 200) || 'no reasoning given',
    };
  } catch {
    return { confidence: 0, reasoning: 'availability estimate unavailable' };
  }
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
  tavilyKey?: string;
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
      // Known platform → single canonical search URL gets the Tavily fallback.
      const md = await scrapeUrl(urls[0], firecrawlKey, { tavilyKey: opts.tavilyKey });
      return { md, platform, picked: urls[0] };
    }

    // Unknown platform → probe candidates with Firecrawl only (no per-probe
    // tavilyKey: most probes are empty by design and would waste credits).
    const settled = await Promise.allSettled(urls.map((u) => scrapeUrl(u, firecrawlKey)));
    let best: SearchResult & { score: number } = { md: '', platform, picked: null, score: -1 };
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        const score = scoreMarkdown(s.value, query);
        if (score > best.score) best = { md: s.value, platform, picked: urls[i], score };
      }
    });

    // All probes came back empty/failed — try Tavily once on the top candidate.
    if (best.score <= 0 && opts.tavilyKey) {
      try {
        const md = await tavilyExtract(urls[0], opts.tavilyKey);
        if (md) best = { md, platform, picked: urls[0], score: scoreMarkdown(md, query) };
      } catch {
        /* keep best (empty) — both providers failed for the probe set */
      }
    }
    return { md: best.md, platform, picked: best.picked };
  }

  return { fetchSearchMarkdown, resolvePlatform };
}
