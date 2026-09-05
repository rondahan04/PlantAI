/**
 * Shared nursery-scraping core. Single source of truth for the Firecrawl +
 * OpenAI pipeline and the platform-aware product search. Consumed by:
 *   - dashboard/server.ts        (interactive query dashboard)
 *   - scripts/scrape-nurseries.ts (offline nurseries.json builder)
 *
 * Node-only (uses fs + global fetch). Not bundled into the RN app - see the
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

/*
 * Canonical host key: lowercase, no leading www. Lives here rather than in
 * pipeline.ts because the searcher's per-host caches (platform, homepage
 * markdown) are keyed by it, and a second private copy that drifted would turn
 * every cache read into a silent miss.
 */
export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

// --- env -------------------------------------------------------------------

/*
 * Load a .env file into process.env (no dotenv dependency).
 *
 * A REAL ENVIRONMENT VARIABLE ALWAYS WINS. This used to overwrite, which meant
 * `GATE_MODE=enforce node server/index.ts` silently ran in log mode because
 * .env said log - the flag you set to protect the API was the one thing that
 * could not take effect. It also matches dotenv's own default and how every
 * host works: the file is the fallback for local dev, the environment is the
 * truth in production.
 *
 * Comment lines are skipped rather than parsed, because prose containing an '='
 * would otherwise be read as a key/value pair.
 */
export function loadEnv(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key?.trim();
    if (name && rest.length && process.env[name] === undefined) {
      process.env[name] = rest.join('=').trim().replace(/^"|"$/g, '');
    }
  }
}

/*
 * A key's plain name (`TAVILY_API_KEY`) wins in production hosts, which never
 * set the `EXPO_PUBLIC_` build-time prefix; the prefixed name is the fallback
 * for local dev, where `.env` is shared with the Expo app. `server/index.ts`
 * had this logic; `dashboard/server.ts` and `scripts/scrape-nurseries.ts` each
 * redeclared a narrower, prefix-only version that could not see a plain-name
 * production var (TODOS H1) - one copy here, three callers.
 */
export function env(key: string): string | undefined {
  return process.env[key] || process.env[`EXPO_PUBLIC_${key}`];
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
 * fallback key - the fallback decision is made once, after this resolves.
 */
/*
 * Cap on Firecrawl requests in flight across the WHOLE process.
 *
 * A nursery search fans out over every discovered site at once, and each site
 * can itself issue several scrapes (platform identification, then up to three
 * probe URLs when the platform is unknown). A 7-site fan-out therefore peaked
 * around 28 simultaneous requests, Firecrawl answered 429, and the failure fed
 * itself: a rate-limited identification returns 'unknown', and 'unknown' is
 * exactly the path that fires THREE probes instead of one. Measured 2026-08-25:
 * 58% of sites failed at the fetch layer, and every one of them returned
 * 16KB-167KB of markdown when scraped on its own moments later.
 *
 * The cap is deliberately process-wide rather than per-search: two concurrent
 * searches share one Firecrawl quota, so a per-search limiter would not bound
 * anything. Override with FIRECRAWL_MAX_CONCURRENCY once the plan's real limit
 * is known - the API returns no RateLimit-* headers to discover it from.
 */
const DEFAULT_MAX_CONCURRENCY = 5;

/*
 * Run at most `max` tasks concurrently; the rest queue in FIFO order. Returned
 * as a factory rather than a class so tests can build a limiter of their own
 * without touching the module-level one.
 */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.(); // hand the slot to the next waiter, if any
    }
  };
}

/*
 * Built on first use, not at import time: callers run loadEnv() AFTER importing
 * this module, so reading the override at module scope would see only a real
 * environment variable and silently ignore the one in .env.
 */
let firecrawlLimiter: ReturnType<typeof createLimiter> | null = null;
let firecrawlRate: ReturnType<typeof createRateLimiter> | null = null;
function firecrawlLimit<T>(fn: () => Promise<T>): Promise<T> {
  firecrawlLimiter ??= createLimiter(
    Number(env('FIRECRAWL_MAX_CONCURRENCY')) || DEFAULT_MAX_CONCURRENCY
  );
  firecrawlRate ??= createRateLimiter(
    Number(env('FIRECRAWL_MAX_PER_MINUTE')) || DEFAULT_MAX_PER_MINUTE
  );
  // Rate token first, then a concurrency slot: a request waiting for its turn
  // in the minute window must not sit in a slot another request could use.
  return firecrawlRate.take().then(() => firecrawlLimiter!(fn));
}

/*
 * Requests per minute the Firecrawl plan allows. Measured 2026-09-02 against
 * this project's key: the 11th request inside a minute is refused with
 * "Rate limit exceeded. Consumed (req/min): 15, Remaining (req/min): 0 ...
 * please retry after 51s". Cached (`maxAge`) hits count too.
 *
 * This, not concurrency, is what the benchmark ran into: 13 sites x (one
 * identification read + probes) blew the window in seconds, every refused
 * identification came back 'unknown', and 'unknown' is the path that spends
 * THREE more requests per site per search. A request that waits its turn here
 * succeeds; the same request fired into the window is refused, retried 1-4s
 * later inside the same window, refused again, and finally counted as a site
 * we could not read. Override when the plan changes - Hobby is 100/min and
 * would make this limiter a no-op.
 */
const DEFAULT_MAX_PER_MINUTE = 10;

/*
 * Sliding-window rate limiter. `take()` resolves when a request may be sent;
 * `holdUntil(ts)` freezes the window until a server-stated reset time, so one
 * 429 stops the whole queue from marching into the same refusal. `now` is
 * injectable for tests; `wait` too, so a test never sleeps for real.
 */
export function createRateLimiter(
  perMinute: number,
  deps: { now?: () => number; wait?: (ms: number) => Promise<void> } = {}
) {
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? sleep;
  /*
   * A minute plus slack. The server stamps a request when it ARRIVES, a few
   * hundred ms after we counted it, so a window measured exactly here frees a
   * token the server is still holding - two refusals per window in the trace.
   */
  const WINDOW = 62_000;
  const sent: number[] = [];
  let heldUntil = 0;
  const expire = (t: number) => {
    while (sent.length && t - sent[0] >= WINDOW) sent.shift();
  };
  return {
    /* ms a take() would spend waiting right now; 0 when a token is free. */
    waitEstimateMs(): number {
      const t = now();
      expire(t);
      const hold = Math.max(0, heldUntil - t);
      if (sent.length < perMinute) return hold;
      return Math.max(hold, sent[0] + WINDOW - t);
    },
    async take(): Promise<void> {
      for (;;) {
        const t = now();
        expire(t);
        const holdMs = heldUntil - t;
        if (holdMs > 0) {
          await wait(holdMs);
          continue;
        }
        if (sent.length < perMinute) {
          sent.push(t);
          return;
        }
        await wait(sent[0] + WINDOW - t);
      }
    },
    holdUntil(ts: number): void {
      heldUntil = Math.max(heldUntil, ts);
    },
    inFlightWindow(): number {
      expire(now());
      return sent.length;
    },
  };
}

/* How long the next Firecrawl request would queue for the minute window. */
export function firecrawlWaitMs(): number {
  return firecrawlRate?.waitEstimateMs() ?? 0;
}

/*
 * How long a 429 is asking us to wait, in ms, or null when it does not say.
 * Firecrawl puts the answer in the body ("please retry after 51s"), not in a
 * Retry-After header; the header is honoured first when present.
 */
export function rateLimitWaitMs(retryAfter: string | null | undefined, body: string): number | null {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const m = /retry after (\d+)\s*s/i.exec(body || '');
  if (m) return Number(m[1]) * 1000;
  return null;
}

const MAX_SCRAPE_ATTEMPTS = 4;

/*
 * Whether a thrown fetch error is our own deadline firing rather than a blip.
 *
 * This distinction is worth real money and minutes. The retry ladder exists for
 * transient network failures, which resolve in a second; a timeout says the
 * page did not answer in 25 seconds, and asking again buys another 25 seconds
 * of the same. Traced on vcactus.co.il: four attempts, four timeouts, 100s
 * spent per URL and three URLs probed - one dead shop held a whole search for
 * five minutes. So a timeout is thrown straight to the caller, where
 * resolveScrape hands the URL to the other provider, which is the only thing
 * that can actually differ.
 */
export function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/*
 * How long to wait before retrying a throttled/failed Firecrawl call.
 *
 * The old code retried IMMEDIATELY, three times. Against a rate limiter that is
 * the same as not retrying at all - the whole budget burns in milliseconds
 * inside the window that is rejecting us, turning a soft 429 into a hard
 * failure. Exponential (1s, 2s, 4s) with jitter so a fan-out that all got 429
 * together does not march back in lockstep. `rand` is injected for tests.
 *
 * A Retry-After header, when present, is the server telling us the answer, so
 * it wins outright - capped so a pathological value cannot stall a search.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter?: string | null,
  rand: () => number = Math.random
): number {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30000);
  const base = 1000 * 2 ** (attempt - 1);
  return Math.round(base * (0.5 + rand())); // 50-150% of base
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/*
 * Per-request ceiling on a single Firecrawl call, client AND server side.
 *
 * Without it a hung render held one of the five concurrency slots for as long
 * as Firecrawl's own 30s default (or the socket's, if the API never answered),
 * and every other site in the fan-out queued behind it. Sent to Firecrawl as
 * `timeout` too, so the render gives up at the same moment rather than burning
 * a credit on a page nobody is waiting for any more.
 *
 * A timed-out request is NOT retried - see isTimeout.
 */
export const FIRECRAWL_TIMEOUT_MS = Number(env('FIRECRAWL_TIMEOUT_MS')) || 25000;

/*
 * Firecrawl keeps a copy of every page it renders and hands it back in
 * milliseconds when asked with `maxAge` - the default (0) never asks, so every
 * call re-rendered a page Firecrawl already had. Two horizons:
 *
 *   HOMEPAGE - read only to identify a shop's platform, which does not change
 *              week to week. A week-old copy answers exactly as well.
 *   SEARCH   - a results page, where stock and price live. One hour: a user
 *              re-running a search sees the same numbers they saw a moment ago
 *              rather than waiting on a second render, and a shop's catalogue
 *              does not turn over faster than that.
 */
export const HOMEPAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SEARCH_MAX_AGE_MS = 60 * 60 * 1000;

/* Options accepted by every scrape function in this module. */
export interface ScrapeOpts {
  /* ms to let the page's JS settle before reading it. 0 = read as served. */
  waitFor?: number;
  /* Accept a Firecrawl-cached copy no older than this (ms). 0 = always render. */
  maxAge?: number;
  /*
   * Whether a failed read may be retried with the other provider. Default true.
   * Pass false where an empty read is itself an answer rather than a failure -
   * platform detection is the case that matters: /products.json coming back
   * empty MEANS "not Shopify", and paying a second provider to confirm the
   * silence doubled the Firecrawl requests in a search (measured: 35 for 13
   * sites) against a window that only allows ten a minute.
   */
  rescue?: boolean;
  attempt?: number;
}

async function firecrawlScrape(
  url: string,
  firecrawlKey: string,
  opts: ScrapeOpts = {}
): Promise<string> {
  const { waitFor = 3500, maxAge = 0, attempt = 1 } = opts;
  const retry = async (retryAfter?: string | null): Promise<string> => {
    // Sleep OUTSIDE the concurrency slot - a waiting retry must not hold a slot
    // that another site could be scraping with.
    await sleep(retryDelayMs(attempt, retryAfter));
    return firecrawlScrape(url, firecrawlKey, { waitFor, maxAge, attempt: attempt + 1 });
  };

  let res: Response;
  try {
    // Only the request itself occupies a slot.
    res = await firecrawlLimit(() =>
      fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${firecrawlKey}` },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor,
          maxAge,
          timeout: FIRECRAWL_TIMEOUT_MS,
        }),
        signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
      })
    );
  } catch (err) {
    if (!isTimeout(err) && attempt < MAX_SCRAPE_ATTEMPTS) return retry();
    throw err; // a deadline that already fired will fire again; let the caller switch providers
  }
  if (res.status === 429 && attempt < MAX_SCRAPE_ATTEMPTS) {
    /*
     * The plan's minute window is spent. Wait for the reset the server names
     * (51s is normal) rather than the 1-4s backoff, which retried inside the
     * same window and turned a delay into a lost site - and freeze the shared
     * limiter so the requests queued behind this one wait too instead of each
     * collecting a refusal of their own.
     */
    const body = await res.text().catch(() => '');
    const waitMs = rateLimitWaitMs(res.headers.get('retry-after'), body);
    if (waitMs !== null) {
      const until = Date.now() + Math.min(waitMs, 65_000) + 500;
      firecrawlRate?.holdUntil(until);
      await sleep(until - Date.now());
      return firecrawlScrape(url, firecrawlKey, { waitFor, maxAge, attempt: attempt + 1 });
    }
    return retry();
  }
  if ((res.status === 408 || res.status >= 500) && attempt < MAX_SCRAPE_ATTEMPTS) {
    return retry(res.headers.get('retry-after'));
  }
  if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
  const data: any = await res.json();
  return data.data?.markdown ?? '';
}

/*
 * Fallback scrape provider: Tavily Extract (https://api.tavily.com/extract).
 * URL in, markdown out - a direct analog of Firecrawl scrape. `extract_depth`
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
  const data: any = await res.json();
  const first = data.results?.[0];
  if (!first) {
    const err = data.failed_results?.[0]?.error ?? 'no results';
    throw new Error(`Tavily extract failed: ${err}`);
  }
  return first.raw_content ?? '';
}

/*
 * Pure scrape orchestration: try the primary provider, hand off to the other
 * one when the read failed. Which provider leads is the caller's choice (see
 * scrapeUrl); both are injected, so every branch is unit-testable without
 * touching the network.
 *
 * A read counts as failed when it throws, returns nothing, OR returns a bot
 * wall. All three are the same story - we did not see the shop - and only the
 * first two used to be caught, so a Cloudflare interstitial was handed on as
 * though it were the page.
 *
 *   primary readable ─▶ return it (no second provider cost)
 *   primary failed + no fallbackKey ─▶ rethrow (threw) or return what we got
 *   primary failed + fallbackKey ─▶ the other provider; if IT fails too, keep
 *                                   the primary's content when there was any,
 *                                   else surface the original error
 */
export async function resolveScrape(opts: {
  url: string;
  /* Key for the fallback provider. Absent = no fallback configured. */
  fallbackKey?: string;
  primary: (url: string) => Promise<string>;
  fallback: (url: string, key: string) => Promise<string>;
}): Promise<string> {
  const { url, fallbackKey, primary, fallback } = opts;
  let primaryErr: unknown;
  let md = '';
  try {
    md = await primary(url);
  } catch (err) {
    primaryErr = err;
  }
  if (md && !looksUnreadable(md)) return md;
  if (!fallbackKey) {
    if (primaryErr) throw primaryErr;
    return md; // preserve the empty-is-OK contract when no fallback configured
  }
  try {
    const alt = await fallback(url, fallbackKey);
    return alt || md; // a fallback that read nothing does not erase the primary
  } catch (fallbackErr) {
    if (md) return md; // even a wall beats nothing
    throw primaryErr ?? fallbackErr; // both providers failed outright
  }
}

/*
 * Which provider reads a page first.
 *
 * Tavily fetches and converts a page; it does not run the page's JavaScript.
 * Firecrawl drives a real browser, which is why it can wait for a grid to
 * paint - and why it is the scarce resource: the plan allows ten requests a
 * minute against Tavily's hundred, and Tavily answers in ~700ms where
 * Firecrawl takes 1.4-2.8s (13-site benchmark, 2026-09-05).
 *
 * So the rule follows the capability, not the vendor: `waitFor: 0` says the
 * caller wants the page as served, which is exactly what Tavily does well, so
 * Tavily leads. Any `waitFor` above zero is a request to render, which only
 * Firecrawl can honour, so Firecrawl leads and Tavily is the rescue.
 */
export function tavilyLeads(opts: { waitFor?: number; tavilyKey?: string }): boolean {
  return Boolean(opts.tavilyKey) && (opts.waitFor ?? RENDER_WAIT_MS) === 0;
}

/*
 * A Tavily read that failed is worth a Firecrawl retry only if Firecrawl can
 * answer soon. With the minute window spent, that retry queues up to a minute:
 * measured on one site it turned a 13-site fan-out from 17s into 106s, all of
 * it one host waiting its turn. Past this budget we return what we have and
 * report the shop as unread, which is the honest answer and a bounded one.
 */
export const FIRECRAWL_RESCUE_BUDGET_MS = 10_000;

/* True when Firecrawl can answer soon enough to be worth asking. */
export function firecrawlReady(budgetMs = FIRECRAWL_RESCUE_BUDGET_MS): boolean {
  return firecrawlWaitMs() <= budgetMs;
}

/*
 * Scrape a URL to markdown using both providers, faster one first (see
 * tavilyLeads). Pass opts.tavilyKey wherever a real page is wanted; without it
 * this is Firecrawl alone, exactly as before.
 */
export async function scrapeUrl(
  url: string,
  firecrawlKey: string,
  opts: ScrapeOpts & { tavilyKey?: string } = {}
): Promise<string> {
  const { tavilyKey, ...fcOpts } = opts;
  if (tavilyLeads(opts)) {
    const rescueOk = opts.rescue !== false && firecrawlReady();
    return resolveScrape({
      url,
      fallbackKey: rescueOk ? firecrawlKey : undefined,
      primary: (u) => tavilyExtract(u, tavilyKey!),
      fallback: (u, k) => firecrawlScrape(u, k, fcOpts),
    });
  }
  return resolveScrape({
    url,
    fallbackKey: tavilyKey,
    primary: (u) => firecrawlScrape(u, firecrawlKey, fcOpts),
    fallback: (u, k) => tavilyExtract(u, k),
  });
}

// --- platform detection (pure) ---------------------------------------------

/*
 * Detect the store platform from page content (markdown or raw HTML).
 * Order matters - check Shopify before Woo. Shopify uses /products/ (plural)
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
  opts?: ScrapeOpts & { tavilyKey?: string }
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
    // 1500 for the same reason as inferAvailabilityLLM: the answer is two short
    // fields, but the reasoning that precedes it is not, and a cap that only
    // covers the reasoning yields empty content and a silent 'unknown' - which
    // costs us the search-URL template and therefore the whole site.
    const out = await classify(prompt, openaiKey, 1500);
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
 *   L2  rendered homepage markers         ─▶ catches JS/SPA sites   ─┐ one
 *   L3  well-known endpoints              ─▶ Shopify /products.json, │ parallel
 *                                            Woo /wp-json/          ─┘ stage
 *   L4  LLM classifies homepage signals   ─▶ names platform + search template;
 *                                            brand-new platforms are registered
 *                                            so future sites skip the LLM
 *   else 'unknown' → caller probes search URLs (still self-corrects)
 *
 * Never throws; each layer is best-effort.
 */
export interface IdentifyOpts {
  scrape?: ScrapeFn;
  /*
   * Lets the two unrendered layers (L1 static homepage, L3 well-known
   * endpoints) read through Tavily, which is both faster and drawn from a
   * budget ten times larger. L2 deliberately does not get it: rendering the
   * homepage is the whole point of that layer.
   */
  tavilyKey?: string;
  openaiKey?: string;
  learnedFile?: string;
  classify?: ClassifyFn;
  /*
   * Called with the best homepage markdown this identification happened to
   * read, before it is discarded. The cascade always fetches the homepage, and
   * the caller's availability-estimate fallback needs exactly that same page -
   * without this hook it re-scrapes an origin we just had in hand. Never called
   * when every layer came back empty.
   */
  onHomeMarkdown?: (markdown: string) => void;
}

export async function identifyPlatform(
  origin: string,
  firecrawlKey: string,
  opts: IdentifyOpts = {}
): Promise<string> {
  const { scrape = scrapeUrl, tavilyKey, openaiKey, learnedFile, classify, onHomeMarkdown } = opts;

  // L1 - fast static homepage. Resolves the common case for one scrape, so it
  // stays alone in its own stage and costs exactly what it always did.
  const home0 = await safeScrape(scrape, origin, firecrawlKey, 0, tavilyKey);
  if (home0 && onHomeMarkdown) onHomeMarkdown(home0);
  let p: string = detectPlatform(home0);
  if (p !== 'unknown') return p;

  // L2 + L3 - fired CONCURRENTLY, not in sequence. These three fetches are
  // independent (rendered homepage, /products.json, /wp-json/) and only a site
  // L1 already failed to classify ever reaches them, so the extra requests are
  // spent exactly on the sites that used to pay four serial round trips. The
  // rendered homepage carries a 4s waitFor and dominates the stage, which is
  // why the old serial form cost ~4x this one. Precedence is unchanged: the
  // results are consulted in L2 → shopify-endpoint → wp-endpoint order
  // regardless of which settles first.
  const [home, shopify, wp] = await Promise.all([
    safeScrape(scrape, origin, firecrawlKey, 4000), // rendered: Firecrawl only
    safeScrape(scrape, `${origin}/products.json`, firecrawlKey, 0, tavilyKey),
    safeScrape(scrape, `${origin}/wp-json/`, firecrawlKey, 0, tavilyKey),
  ]);

  if (home && onHomeMarkdown) onHomeMarkdown(home); // rendered beats static

  p = detectPlatform(home);
  if (p !== 'unknown') return p;

  if (/"handle"\s*:|"variants"\s*:|"product_type"\s*:/.test(shopify)) return 'shopify';
  if (/wp\/v2|"namespace"|"routes"/.test(wp)) return 'woo';

  // L4 - LLM classifies whatever homepage content we have, and teaches us the
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

/*
 * Identification reads. Every URL here (homepage, /products.json, /wp-json/)
 * exists only to name the platform, so a week-old Firecrawl copy is as good as
 * a fresh render and comes back in milliseconds instead of seconds.
 */
async function safeScrape(
  scrape: ScrapeFn,
  url: string,
  key: string,
  waitFor: number,
  tavilyKey?: string
): Promise<string> {
  try {
    return await scrape(url, key, {
      waitFor,
      maxAge: HOMEPAGE_MAX_AGE_MS,
      tavilyKey,
      rescue: false, // an empty layer is an answer; the next layer is the retry
    });
  } catch {
    return '';
  }
}

/*
 * How long to let a search-results page render before reading it.
 *
 * Shopify and WooCommerce return their results server-side: the product grid
 * is in the first byte of HTML, and the 3.5s the scraper used to wait on every
 * search was spent watching a page that had already finished. Wix renders its
 * grid client-side, and a platform the LLM taught us is an unknown quantity, so
 * both keep the settle time. The fast path is not a gamble on success rate:
 * fetchSearchMarkdown re-reads with the full wait if the quick read comes back
 * with nothing that looks like results.
 */
export const RENDER_WAIT_MS = 3500;
const SERVER_RENDERED = new Set(['shopify', 'woo', 'magento', 'bigcommerce', 'prestashop', 'opencart']);
export function searchWaitFor(platform: string): number {
  return SERVER_RENDERED.has(normalizePlatform(platform)) ? 0 : RENDER_WAIT_MS;
}

/*
 * A probe scoring this high is a results page beyond doubt: scoreMarkdown adds
 * 50 for the query echoed on the page, so this is "echo plus something" or a
 * grid of 50+ priced products. Below it the next probe still runs, so a
 * homepage that merely lists a few prices cannot end the probe early.
 */
export const PROBE_CONFIDENT_SCORE = 51;

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
  const prices = countPrices(s);
  const productLinks = (s.match(new RegExp(PRODUCT_LINK_RE.source, 'g')) || []).length;
  const queryEcho = query && s.includes(query) ? 50 : 0;
  return prices + productLinks + queryEcho;
}

// --- product/price recognition (pure) --------------------------------------

/*
 * What a product permalink looks like, per platform. Wix is the reason this is
 * an explicit list rather than /\/products?\//: its canonical product URL is
 * `/product-page/{slug}`, which that pattern does NOT match (it requires a '/'
 * immediately after "product"). A Wix store therefore had every one of its
 * listings filtered out of the excerpt before the model ever saw them, and came
 * back as an indistinguishable "0 items". Alternation is deliberate over a
 * looser `product[-/]` so blog paths like /product-reviews/ stay excluded.
 */
const PRODUCT_LINK_RE = /\/(?:products?|product-page|catalog\/product|shop\/p)\//;

/*
 * An ILS price. Israeli nursery sites write the currency at least five ways and
 * only the symbol was recognized, so a site pricing in `49 ש"ח` looked
 * priceless. A digit is required adjacent to the currency token on both sides of
 * the alternation - without it the bare word `שח` matches inside ordinary
 * Hebrew words (שחור, משחה) and drags in nav/prose lines.
 */
const ILS_PRICE_RE = /(?:₪|ש"ח|ש״ח|שח|NIS|ILS)\s*\d|\d\s*(?:₪|ש"ח|ש״ח|שח|NIS|ILS)/i;

/* Count price mentions on a page (scoreMarkdown wants a tally, not a boolean). */
function countPrices(s: string): number {
  return (s.match(new RegExp(ILS_PRICE_RE.source, 'gi')) || []).length;
}

// --- excerpt (pure) --------------------------------------------------------

/*
 * Homepages/search pages are 100KB+ and front-loaded with cookie/nav
 * boilerplate + base64 images. Strip images, then keep only product-ish lines
 * (headings, ILS prices, product permalinks) so the model sees a clean
 * name->price catalog. Themes vary: `##### [Name](url)`, plain `# Name`,
 * `- [**Name** ₪price](url)` - all are kept.
 */
export function priceFocusedExcerpt(markdown: string, max = 18000): string {
  const kept = markdown
    .split('\n')
    .map((l) => l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('data:image'))
    .filter((l) => /^#{1,6}\s/.test(l) || ILS_PRICE_RE.test(l) || PRODUCT_LINK_RE.test(l));
  return kept.join('\n').slice(0, max);
}

// --- OpenAI ----------------------------------------------------------------

/* Call the OpenAI model in JSON mode and return the parsed object. Throws on
 * non-2xx or unparseable content so callers can decide how to degrade. */
export const OPENAI_MODEL = 'gpt-5.6-luna';

/*
 * `max_completion_tokens` is a budget for reasoning AND the answer, and the
 * model spends the reasoning first. A cap that only fits the reasoning comes
 * back with `finish_reason: 'length'` and an EMPTY content string - a 200 OK
 * that parses to nothing.
 *
 * That is exactly how the Deliver tab broke: al-haderech and rootine return
 * long Hebrew catalogue pages, the extraction pass spent all 2000 tokens
 * thinking, `JSON.parse('')` threw "Unexpected end of JSON input", and
 * `scrapeOne` recorded the site as `not_found`. Both shippers failing that way
 * emptied the only tab they populate, while the shorter local pages that
 * happened to fit kept working - which is why Pick Up looked healthy.
 *
 * Two defences, because a bigger cap alone would only move the cliff:
 * retry once with a doubled budget, then report the truncation by name instead
 * of as a parse error.
 */
export async function callOpenAIJson(
  prompt: string,
  openaiKey: string,
  maxTokens = 1200
): Promise<any> {
  const attempt = async (cap: number) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: cap,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status} ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const choice = data?.choices?.[0];
    return {
      content: String(choice?.message?.content ?? ''),
      finish: String(choice?.finish_reason ?? ''),
    };
  };

  let { content, finish } = await attempt(maxTokens);
  if (!content.trim() && finish === 'length') {
    ({ content, finish } = await attempt(maxTokens * 2));
  }
  if (!content.trim()) {
    throw new Error(
      `OpenAI returned no content (finish_reason=${finish || 'unknown'}, max_completion_tokens=${maxTokens})`
    );
  }
  return JSON.parse(content);
}

// --- two-pass GPT extraction pipeline --------------------------------------
//
//   markdown ─▶ the model (extract) ─▶ the model (verify/critic) ─▶ verified plants
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
  /*
   * The product page, when the listing carried a link. The Order button used to
   * open the nursery's homepage and leave the user to find the plant again -
   * which for a shop with 28 Alocasias is most of the work.
   */
  url?: string;
}

/* Auditor verdict. */
export interface VerificationReport {
  is_valid: boolean;
  confidence_score: number; // 0..100
  feedback: string;
  corrected_output: Plant[];
}

/*
 * Where a site's extraction actually stopped. Every failure used to surface as
 * the same "0 item(s)" line, which made the four very different causes below
 * indistinguishable in the log - so there was no way to tell a site that genuinely
 * lacks the plant from one whose markup we simply failed to parse. Success rate
 * is not improvable without this breakdown.
 *
 *   no_markdown  scrape came back empty (site down, bot-walled, bad search URL)
 *   no_excerpt   markdown arrived but no line looked like a product/price - our
 *                filters missed this site's format, the model never saw the page
 *   no_match     model read a real catalog and found nothing matching the query
 *   rejected     model extracted rows, the auditor threw all of them out
 *   ok           rows survived
 */
export type ExtractStage = 'no_markdown' | 'no_excerpt' | 'no_match' | 'rejected' | 'ok';

export interface ExtractFunnel {
  stage: ExtractStage;
  mdChars: number; // scraped markdown size
  excerptChars: number; // what survived priceFocusedExcerpt
  extracted: number; // rows the extraction pass proposed
  kept: number; // rows that survived the audit
}

export interface PipelineResult {
  plants: Plant[];
  report: VerificationReport;
  engines: { extractor: typeof OPENAI_MODEL | 'none'; verifier: typeof OPENAI_MODEL | 'none' };
  funnel: ExtractFunnel;
}

function coercePlants(items: any): Plant[] {
  if (!Array.isArray(items)) return [];
  const valid: Availability[] = ['in_stock', 'out_of_stock', 'unknown'];
  return items
    .filter((it) => it && typeof it === 'object' && it.name && it.price)
    .map((it) => {
      const url = typeof it.url === 'string' ? it.url.trim() : '';
      return {
        name: String(it.name),
        price: String(it.price),
        availability: valid.includes(it.availability) ? it.availability : 'unknown',
        // Absolute http(s) only: a relative path or a hallucinated fragment
        // would open to nothing, which is worse than the homepage fallback.
        ...(/^https?:\/\//i.test(url) ? { url } : {}),
      };
    });
}

/* Extraction pass: the model reads the condensed markdown and returns the plant
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
{ "plants": [{ "name": "product name in its original language", "price": "₪XX", "availability": "in_stock" | "out_of_stock" | "unknown", "url": "absolute link to that product's page, or omit if the content has none" }] }
Rules:
- Prices MUST be in ILS (₪). If a price has no currency symbol assume ILS and add ₪.
- Only REAL products that have a price. Ignore blog posts, articles, guides ("איך לגדל"), categories, cart/shipping/total/free-shipping lines.
- availability: "out_of_stock" only if the text clearly says sold out / אזל / לא במלאי; "in_stock" if clearly purchasable; otherwise "unknown".
- url: copy the product's own link EXACTLY from the content (markdown links look like [name](https://...)). Never invent, guess or shorten a URL - omit the field instead.
- If nothing matches, return { "plants": [] }.
Content:\n${excerpt}`;
  /*
   * 6000, not 2000. A full nursery search page can carry 20+ matching listings,
   * and the model reasons before it writes: measured on al-haderech's Monstera
   * page the extraction pass needed 4022 completion tokens, so the old cap was
   * consumed entirely by reasoning and returned an empty string. See
   * callOpenAIJson.
   */
  return coercePlants((await callOpenAIJson(prompt, openaiKey, 6000)).plants);
}

/* Verification pass: the model acts strictly as an auditor. It cross-references
 * the extracted JSON against the source text and returns a strict verdict. */
export async function verifyPlantsWithGPT(
  excerpt: string,
  plants: Plant[],
  query: string,
  site: string,
  openaiKey: string
): Promise<VerificationReport> {
  const prompt = `You are a strict data auditor for a plant nursery scraper (${site}). The data below was extracted in a separate pass. Your only job is to verify it against the SOURCE TEXT - do not extract anything new.
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
  "corrected_output": [ { "name": "...", "price": "₪XX", "availability": "in_stock" | "out_of_stock" | "unknown", "url": "carry the url through unchanged if the extracted item had one" } ]
}
Rules:
- is_valid = true only if every returned item is faithful to the source.
- corrected_output: the verified, clean list. Fix minor errors (wrong price, bad availability), DROP hallucinated/unsupported items. If everything was already correct, return the same items.
- Never invent products that are not in the source text.
- A MISSING STOCK STATEMENT IS NOT A REASON TO DROP A ROW. If the product and its price are supported by the source but the source never says whether it is in stock, KEEP the row and set availability to "unknown". Dropping it removes a shop that does sell the plant, on the grounds that we could not prove it - "unknown" states exactly what the source supports. Drop a row only when the product or its price is unsupported or invented.

EXTRACTED JSON TO AUDIT:
${JSON.stringify({ plants }, null, 2)}

SOURCE TEXT:
${excerpt}`;

  // Same budget as the extraction pass: the auditor echoes the whole corrected
  // list back, so its answer is at least as long as what it was given.
  const parsed = await callOpenAIJson(prompt, openaiKey, 6000);
  return {
    is_valid: Boolean(parsed.is_valid),
    confidence_score: Number(parsed.confidence_score) || 0,
    feedback: String(parsed.feedback ?? ''),
    corrected_output: coercePlants(parsed.corrected_output),
  };
}

/* Orchestrate the two-pass pipeline: the model extracts, then audits itself.
 * Returns the verified plants plus the auditor's report. Per the workflow: on
 * is_valid the verified data is returned; on a rejection the failure feedback
 * is logged for evaluation. */
export interface ExtractDeps {
  extract?: typeof extractPlants;
  verify?: typeof verifyPlantsWithGPT;
}

export async function extractAndVerifyPlants(
  opts: {
    markdown: string;
    query: string;
    site: string;
    openaiKey?: string;
  },
  deps: ExtractDeps = {}
): Promise<PipelineResult> {
  const { markdown, query, site, openaiKey } = opts;
  const { extract = extractPlants, verify = verifyPlantsWithGPT } = deps;
  const excerpt = priceFocusedExcerpt(markdown);

  const empty = (stage: ExtractStage, feedback: string): PipelineResult => ({
    plants: [],
    report: { is_valid: false, confidence_score: 0, feedback, corrected_output: [] },
    engines: { extractor: 'none', verifier: 'none' },
    funnel: {
      stage,
      mdChars: markdown.length,
      excerptChars: excerpt.length,
      extracted: 0,
      kept: 0,
    },
  });

  if (!excerpt.trim()) {
    // Distinguish "nothing was scraped" from "plenty was scraped and none of it
    // looked like a product" - the second is a parser gap on our side.
    return markdown.trim()
      ? empty('no_excerpt', 'no product/price lines matched in the scraped markdown')
      : empty('no_markdown', 'scrape returned no markdown');
  }
  if (!openaiKey) return empty('no_markdown', 'no OpenAI key available');

  // --- Extraction pass -----------------------------------------------------
  const extracted = await extract(excerpt, query, site, openaiKey);

  // Nothing to audit. The auditor's only job is to cross-check extracted rows
  // against the source; with zero rows it can only ever confirm the empty list,
  // so the call was a guaranteed no-op that still cost a full LLM round trip.
  // Most sites in a fan-out return zero matches, so this is the common path.
  if (extracted.length === 0) {
    return {
      plants: [],
      report: {
        is_valid: true,
        confidence_score: 100,
        feedback: 'no products extracted - verification skipped',
        corrected_output: [],
      },
      engines: { extractor: OPENAI_MODEL, verifier: 'none' },
      funnel: {
        stage: 'no_match',
        mdChars: markdown.length,
        excerptChars: excerpt.length,
        extracted: 0,
        kept: 0,
      },
    };
  }

  // --- Verification pass ----------------------------------------------------
  const report = await verify(excerpt, extracted, query, site, openaiKey);
  /*
   * Honour an explicit rejection. The old rule was "empty corrected_output →
   * fall back to `extracted`", which quietly handed back the exact rows the
   * auditor had just rejected as hallucinated - the audit pass had no teeth in
   * the one case it exists for. Split on is_valid instead:
   *
   *   is_valid false → the auditor made a deliberate call; take corrected_output
   *                    verbatim, empty included ("drop all of these").
   *   is_valid true  → nothing was wrong; an empty corrected_output means the
   *                    auditor just didn't echo the list back, so keep
   *                    `extracted` rather than losing confirmed-good rows.
   *
   * verifyPlantsWithGPT throws when the LLM call itself fails, so reaching this
   * line means we have a real verdict, not a degraded one.
   */
  const verified = report.is_valid
    ? report.corrected_output.length
      ? report.corrected_output
      : extracted
    : report.corrected_output;

  if (!report.is_valid) {
    // Self-correction loop: log the failure feedback for evaluation.
    console.log(
      `   [${site}] ⚠️  verification REJECTED (conf ${report.confidence_score}): ${report.feedback}`
    );
  }

  return {
    plants: verified,
    report,
    engines: { extractor: OPENAI_MODEL, verifier: OPENAI_MODEL },
    funnel: {
      stage: verified.length ? 'ok' : 'rejected',
      mdChars: markdown.length,
      excerptChars: excerpt.length,
      extracted: extracted.length,
      kept: verified.length,
    },
  };
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

/*
 * Markers of a page that is a wall, not a website: Cloudflare interstitials,
 * captchas, "enable JavaScript" shells. Kept SHORT and specific on purpose - a
 * loose list would downgrade real catalogues that merely mention "verification"
 * somewhere, which is a worse failure than the one being fixed. Hebrew forms
 * are included because these are Israeli sites.
 */
const UNREADABLE_MARKERS = [
  'security verification',
  'verify you are human',
  'checking your browser',
  'cf browser verification',
  'captcha',
  'enable javascript',
  'access denied',
  'attention required',
  'אימות אבטחה',
  'אנא הפעל javascript',
  'הגישה נדחתה',
];

/*
 * True when the text we scraped is a bot wall rather than the site itself.
 *
 * Why this matters: a wall page still has words on it, so inferAvailabilityLLM
 * dutifully read one and returned "~50% · the site text is only a
 * security-verification page". That is a fabricated likelihood about a shop we
 * never actually saw, presented to the user in the same pill as a real
 * estimate. Detecting it up front is both the honest answer and one fewer LLM
 * call per walled nursery.
 */
export function looksUnreadable(text: string): boolean {
  if (!(text || '').trim()) return true; // nothing scraped is the same story to a user
  /*
   * Hyphens and underscores collapse to spaces before matching. The observed
   * failure wrote it "security-verification page" while the marker reads
   * "security verification", and a list that misses the one case that prompted
   * it is worse than no list at all.
   */
  const s = text.toLowerCase().replace(/[-_]+/g, ' ');
  return UNREADABLE_MARKERS.some((m) => s.includes(m));
}

// --- price sanity check -----------------------------------------------------

export interface PriceCandidate {
  site: string;
  name: string;
  price: string;
}

export interface PriceVerdict {
  plausible: boolean;
  reason: string;
}

/*
 * Last look at the prices before a user sees them.
 *
 * The extractor and the auditor both check a price against the SOURCE TEXT -
 * "does the page really say ₪999.90?" - and both can be perfectly right while
 * the number is still wrong for the product, because the page also contains
 * phone numbers, free-shipping thresholds, cart totals and instalment plans.
 * This pass asks the different question: is this a plausible price FOR THIS
 * PLANT, given what every other nursery in the same search is charging.
 *
 * EXPENSIVE IS NOT WRONG. al-haderech genuinely sells variegated Alocasias at
 * ₪1,499.90, and a check that flagged big numbers would have "corrected" a
 * correct price into a missing one. The prompt says so explicitly, and the
 * cross-nursery list is what makes the distinction possible: one shop charging
 * ₪999 for a plant three others sell at ₪45 is suspicious; every shop agreeing
 * it is a ₪900 plant is just an expensive plant.
 *
 * ONE call for the whole search, not one per nursery - the comparison is the
 * point, and a per-site call could not see the other sites.
 *
 * Never throws. On any failure every price is treated as plausible: this is a
 * safety net, and a broken net must not start hiding real prices.
 */
export async function sanityCheckPrices(
  query: string,
  candidates: PriceCandidate[],
  openaiKey: string,
  classify: ClassifyFn = callOpenAIJson
): Promise<PriceVerdict[]> {
  const ok = candidates.map(() => ({ plausible: true, reason: '' }));
  if (candidates.length === 0 || !openaiKey) return ok;

  const listing = candidates
    .map((c, i) => `${i}. site=${c.site} | product="${c.name}" | price=${c.price}`)
    .join('\n');

  const prompt = `You are checking scraped prices from Israeli plant nurseries before they are shown to a shopper who searched for "${query}".
For each row decide whether the price is a PLAUSIBLE PRICE FOR THAT PRODUCT.

A price is IMPLAUSIBLE when it is clearly not the product's price, for example:
- a phone number, address number, postcode or year read as a price
- a free-shipping threshold, minimum order, cart total or instalment amount
- a decimal error (₪4990 where the page means ₪49.90)
- a number wildly out of line with what the OTHER rows charge for the same kind of plant

A price is PLAUSIBLE even when it is HIGH. Rare and variegated houseplants genuinely sell for ₪500-₪1500 in Israel, and small plugs genuinely sell for ₪20-₪40. A wide spread across cultivars is normal and is NOT a reason to flag anything. Only flag a row you would be embarrassed to show a customer.

Return ONLY JSON: { "results": [ { "index": <row number>, "plausible": true|false, "reason": "<short reason, empty when plausible>" } ] }
Include one entry per row.

Rows:
${listing}`;

  try {
    // 2500: one verdict per row across every nursery in the search, after the
    // reasoning that compares them. 900 truncated on a busy result set and the
    // catch below then passed every price through unchecked.
    const out = await classify(prompt, openaiKey, 2500);
    const results = Array.isArray(out?.results) ? out.results : [];
    for (const r of results) {
      const i = Number(r?.index);
      if (!Number.isInteger(i) || i < 0 || i >= ok.length) continue;
      // Only an explicit false flags a row - a missing or malformed verdict
      // must not silently remove a price we have no evidence against.
      if (r?.plausible === false) {
        ok[i] = { plausible: false, reason: String(r?.reason ?? '').slice(0, 200) };
      }
    }
    return ok;
  } catch {
    return ok;
  }
}

// --- query translation ------------------------------------------------------

/* Any Hebrew letter. A query already in Hebrew needs no translating. */
const HEBREW_RE = /[֐-׿]/;

export function hasHebrew(s: string): boolean {
  return HEBREW_RE.test(s || '');
}

/*
 * Translate a plant name to Hebrew for the site search.
 *
 * Israeli nursery sites index their catalogue in Hebrew, so searching them for
 * "alocasia regal shield" returns nothing - not because the shop lacks the
 * plant, but because the string never appears on the page. The extractor has
 * always been told to match either language; the SEARCH URL was the half still
 * asking in English.
 *
 * Called ONCE per search rather than per site: the answer is the same for every
 * nursery, and per-site would multiply a cheap call by the fan-out width.
 * Returns the original on any failure - a search in the wrong language still
 * beats no search.
 */
export async function translateQuery(
  name: string,
  openaiKey: string,
  classify: ClassifyFn = callOpenAIJson
): Promise<string> {
  const query = (name || '').trim();
  if (!query || hasHebrew(query)) return query;

  const prompt = `Translate this plant name into Hebrew as an Israeli plant nursery would list it on its website.
Transliterate the genus and cultivar rather than translating them literally - Israeli nurseries write "Alocasia Regal Shield" as "אלוקסיה ריגל שילד", not as a description of a shield.
Return ONLY JSON: { "hebrew": "<the Hebrew name>" }
Plant name: ${query}`;

  try {
    // 1500: an empty answer here silently searches Israeli catalogues in
    // English, which matches nothing - the failure looks like "shop does not
    // stock it" rather than like a truncated model reply.
    const out = await classify(prompt, openaiKey, 1500);
    const hebrew = typeof out?.hebrew === 'string' ? out.hebrew.trim() : '';
    // Guard against the model echoing the English back, or answering in prose.
    return hebrew && hasHebrew(hebrew) ? hebrew : query;
  } catch {
    return query;
  }
}

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
 * throws - returns a 0-confidence estimate on empty input or any LLM failure. */
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
  const prompt = `You estimate whether a plant nursery (${site}) likely sells a given plant, from its website text (mostly Hebrew). A structured product search already found nothing - the site may have no online shop, or its search failed, so judge from the general text.
The user wants: "${query}" (match English or Hebrew, including translations / related plant types).
Consider: does the nursery deal in this plant's category (herbs, perennials, houseplants, succulents, trees, flowers)? Is it a general nursery that would plausibly carry a common plant? Does the text explicitly mention it?
Return ONLY JSON: { "confidence": <0-100>, "reasoning": "<short, one sentence>" }
Scale: 0 = clearly does not sell this type; 50 = general nursery, could plausibly have it; 85+ = the text strongly implies or names it.
Website text:\n${excerpt}`;
  try {
    // 1500: gpt-5.6-luna spends completion tokens on hidden reasoning first, so a
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
  /* Injectable view of the Firecrawl minute window, tests only. */
  firecrawlReady?: () => boolean;
  /*
   * Where to remember each host's platform between processes. Without it the
   * platform cache dies with the process - and the API host sleeps between
   * requests, so in practice EVERY search paid the 1-4 identification scrapes
   * per site, queued behind the concurrency cap. A shop does not change its
   * platform week to week; see HOST_PLATFORM_TTL_MS.
   */
  hostsFile?: string;
  /* Injectable for tests; defaults to the real Firecrawl + Tavily scrape. */
  scrape?: ScrapeFn;
  /* Injectable clock for the TTL, tests only. */
  now?: () => number;
}



/*
 * A remembered platform is trusted for 30 days, then re-identified. Only real
 * answers are written: 'unknown' is the slow probe path and may be a transient
 * (rate-limited) verdict, so it stays in memory for the process and gets a
 * fresh chance next start.
 */
export const HOST_PLATFORM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/* See rememberHost: how long an in-memory 'unknown' verdict stands. */
export const UNKNOWN_TTL_MS = 60 * 60 * 1000;
/*
 * `template` is a per-host search URL learned from a probe that clearly hit a
 * results page, for hosts whose platform we could not name. It turns the
 * three-request probe path into one request, like a known platform.
 */
export type HostPlatforms = Record<string, { platform: string; at: number; template?: string }>;

export function loadHostPlatforms(file: string): HostPlatforms {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveHostPlatforms(file: string, hosts: HostPlatforms): void {
  try {
    fs.writeFileSync(file, JSON.stringify(hosts, null, 2));
  } catch {
    /* best-effort persistence - a lost write costs one re-identification */
  }
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
  /*
   * Homepage markdown captured as a by-product of platform identification, per
   * host. The availability-estimate fallback (0 structured items) wants the
   * homepage, and identifyPlatform already fetched it - reading it from here
   * removes a full Firecrawl round trip from the SLOWEST and most common path.
   * Same lifetime as platformCache: a warm host skips identification entirely,
   * so it also has no cached homepage and the caller falls back to a real
   * scrape. Homepage prose ("we grow herbs and perennials") is what the
   * estimate reads, and that does not change within a process lifetime.
   */
  const homeCache = new Map<string, string>();
  /* Per-host search URL templates learned from a confident probe hit. */
  const hostTemplates = new Map<string, string>();
  const scrape: ScrapeFn = opts.scrape ?? scrapeUrl;
  const canRender = opts.firecrawlReady ?? firecrawlReady;
  const now = opts.now ?? Date.now;
  if (opts.learnedFile) loadLearnedPlatforms(opts.learnedFile);

  // Warm the in-memory cache from disk: unexpired, known platforms only.
  const persisted: HostPlatforms = opts.hostsFile ? loadHostPlatforms(opts.hostsFile) : {};
  for (const [host, entry] of Object.entries(persisted)) {
    const fresh = now() - entry.at < HOST_PLATFORM_TTL_MS;
    const known = entry.platform && entry.platform !== 'unknown';
    if (fresh && known) {
      platformCache.set(host, entry.platform);
    } else if (fresh && entry.template) {
      hostTemplates.set(host, entry.template);
    } else {
      delete persisted[host];
    }
  }

  /*
   * 'unknown' is remembered only briefly, in memory. It is as often a verdict
   * about Firecrawl's minute window as about the site - a refused homepage
   * read looks exactly like a platform we cannot name - and a host stuck on
   * 'unknown' pays the probe path on every search. An hour later it gets one
   * cheap (Firecrawl-cached) identification read and a fresh chance.
   */
  const unknownSince = new Map<string, number>();
  function rememberHost(host: string, platform: string): void {
    platformCache.set(host, platform);
    if (platform === 'unknown') {
      unknownSince.set(host, now());
      return;
    }
    unknownSince.delete(host);
    if (!opts.hostsFile) return;
    persisted[host] = { platform, at: now() };
    saveHostPlatforms(opts.hostsFile, persisted);
  }

  function rememberTemplate(host: string, picked: string, origin: string, query: string): void {
    const template = picked
      .replace(encodeURIComponent(query), '{query}')
      .replace(origin, '{origin}');
    if (!template.includes('{query}')) return;
    hostTemplates.set(host, template);
    if (!opts.hostsFile) return;
    persisted[host] = { platform: 'unknown', at: now(), template };
    saveHostPlatforms(opts.hostsFile, persisted);
  }

  /*
   * Called when a search on a remembered platform read nothing at all. The
   * likeliest story is that the platform changed (or was mis-remembered), and
   * the search URL we built no longer exists - so the next search for this host
   * re-identifies instead of failing the same way for 30 days.
   */
  function forgetHost(host: string): void {
    platformCache.delete(host);
    hostTemplates.delete(host);
    if (!opts.hostsFile || !(host in persisted)) return;
    delete persisted[host];
    saveHostPlatforms(opts.hostsFile, persisted);
  }

  async function resolvePlatform(origin: string, host: string): Promise<string> {
    const cached = platformCache.get(host);
    const since = unknownSince.get(host);
    const staleUnknown = cached === 'unknown' && since !== undefined && now() - since >= UNKNOWN_TTL_MS;
    if (cached && !staleUnknown) return cached;
    // A host we could not name but CAN search (learned template) is not worth
    // re-identifying: the template already does what a platform name would.
    if (!cached && hostTemplates.has(host)) return 'unknown';
    const platform = await identifyPlatform(origin, firecrawlKey, {
      scrape,
      tavilyKey: opts.tavilyKey,
      openaiKey: opts.openaiKey,
      learnedFile: opts.learnedFile,
      onHomeMarkdown: (md) => homeCache.set(host, md),
    });
    rememberHost(host, platform);
    return platform;
  }

  /* Homepage markdown already read for this host, or '' if we never saw one. */
  function cachedHomeMarkdown(host: string): string {
    return homeCache.get(host) ?? '';
  }

  async function fetchSearchMarkdown(
    baseUrl: string,
    query: string,
    host: string
  ): Promise<SearchResult> {
    const { origin } = new URL(baseUrl);
    const platform = await resolvePlatform(origin, host);
    const learned = platform === 'unknown' ? hostTemplates.get(host) : undefined;
    const urls = learned ? [applyTemplate(learned, origin, query)] : searchUrlsFor(origin, query, platform);

    if (urls.length === 1) {
      /*
       * Known platform → one canonical search URL, read in two speeds.
       *
       * Quick: no render wait on server-rendered platforms, and a Firecrawl copy
       * up to an hour old is accepted. This is the whole search for most sites.
       *
       * Careful: only when the quick read came back with no page at all - empty,
       * or a bot wall. Full render wait, fresh copy, and the Tavily fallback if
       * Firecrawl still reads nothing. Those are exactly the quick read's
       * failure modes, so success rate is bounded below by the old
       * always-careful behaviour.
       *
       * NOT a trigger: a page that scores zero. On a server-rendered platform a
       * results page for a plant the shop does not stock has no prices and no
       * product links - it IS the answer ("not sold"), and re-reading it slowly
       * (measured: on 6 of 13 sites per search) spent the plan's minute window
       * confirming what we already knew.
       */
      const url = urls[0];
      const quickWait = searchWaitFor(platform);
      let md = '';
      try {
        md = await scrape(url, firecrawlKey, {
          waitFor: quickWait,
          maxAge: SEARCH_MAX_AGE_MS,
          tavilyKey: opts.tavilyKey,
        });
      } catch {
        /* the careful read below is the retry */
      }
      /*
       * Rendering is the one thing Tavily cannot do, so it is worth a second
       * read - but only while Firecrawl can answer soon. With its minute spent
       * this retry queued 50s behind other sites for a page we already had a
       * readable-enough copy of, and one host set the pace for the whole
       * fan-out.
       */
      if (looksUnreadable(md) && canRender()) {
        md = await scrape(url, firecrawlKey, {
          waitFor: RENDER_WAIT_MS,
          maxAge: 0,
          tavilyKey: opts.tavilyKey,
        });
      }
      if (!md) forgetHost(host);
      return { md, platform, picked: url };
    }

    /*
     * Unknown platform → probe candidates ONE AT A TIME, stopping at the first
     * page that clearly is a results page (echoes the query, or lists plenty
     * of products). The probes used to fire together and keep the best, which
     * spent three of the plan's ten requests a minute on every unknown site,
     * every search - the budget that starved identification for the others.
     * Probes ask for the page as served (`waitFor: 0`), so Tavily leads and
     * three probes cost about what one rendered Firecrawl read used to.
     */
    let best: SearchResult & { score: number } = { md: '', platform, picked: null, score: -1 };
    for (const u of urls) {
      let md = '';
      try {
        md = await scrape(u, firecrawlKey, {
          waitFor: 0,
          maxAge: SEARCH_MAX_AGE_MS,
          tavilyKey: opts.tavilyKey,
        });
      } catch {
        continue;
      }
      const score = scoreMarkdown(md, query);
      if (score > best.score) best = { md, platform, picked: u, score };
      if (score >= PROBE_CONFIDENT_SCORE) {
        rememberTemplate(host, u, origin, query);
        break;
      }
    }

    /*
     * No probe found a results page. The one thing not yet tried is rendering:
     * a site whose grid is painted by JavaScript looks identical to a site with
     * no results when read as served. One rendered Firecrawl read of the first
     * candidate, which is the layer Tavily cannot supply.
     */
    if (best.score <= 0 && canRender()) {
      try {
        const md = await scrape(urls[0], firecrawlKey, { waitFor: RENDER_WAIT_MS, maxAge: 0 });
        if (md) best = { md, platform, picked: urls[0], score: scoreMarkdown(md, query) };
      } catch {
        /* keep best - neither provider could read this site */
      }
    }
    return { md: best.md, platform, picked: best.picked };
  }

  return { fetchSearchMarkdown, resolvePlatform, cachedHomeMarkdown };
}
