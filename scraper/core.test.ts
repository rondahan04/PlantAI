/**
 * Unit tests for the pure scraper-core functions. No network.
 * Run: node --test scraper/core.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  identifyPlatform,
  searchUrlsFor,
  scoreMarkdown,
  priceFocusedExcerpt,
  normalizePlatform,
  templateFor,
  registerPlatform,
  platformFingerprint,
  classifyPlatformLLM,
  resolveScrape,
  tavilyExtract,
  inferAvailabilityLLM,
  extractAndVerifyPlants,
  OPENAI_MODEL,
  hostOf,
  createSearcher,
  createLimiter,
  retryDelayMs,
  looksUnreadable,
  translateQuery,
  hasHebrew,
  sanityCheckPrices,
  callOpenAIJson,
  searchWaitFor,
  loadHostPlatforms,
  RENDER_WAIT_MS,
  HOMEPAGE_MAX_AGE_MS,
  SEARCH_MAX_AGE_MS,
  HOST_PLATFORM_TTL_MS,
  UNKNOWN_TTL_MS,
  PROBE_CONFIDENT_SCORE,
  createRateLimiter,
  rateLimitWaitMs,
} from './core.ts';
import type { ScrapeFn, ClassifyFn, Plant, VerificationReport } from './core.ts';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('detectPlatform: Shopify markers', () => {
  assert.equal(detectPlatform('![x](https://rootine.co.il/cdn/shop/files/a.png)'), 'shopify');
  assert.equal(detectPlatform('[all](https://x.co.il/collections/all)'), 'shopify');
  assert.equal(detectPlatform('[p](https://x.co.il/products/monstera)'), 'shopify');
});

test('detectPlatform: WooCommerce markers', () => {
  assert.equal(detectPlatform('![](https://x.co.il/wp-content/uploads/logo.png)'), 'woo');
  assert.equal(detectPlatform('[p](https://x.co.il/product/mint/)'), 'woo');
  assert.equal(detectPlatform('[cat](https://x.co.il/product-category/herbs/)'), 'woo');
});

test('detectPlatform: Wix markers', () => {
  assert.equal(detectPlatform('![](https://static.wixstatic.com/media/abc.jpg)'), 'wix');
  assert.equal(detectPlatform('<div class="_wix-root">'), 'wix');
});

test('detectPlatform: unknown / custom', () => {
  assert.equal(detectPlatform('# Welcome\nSome custom HTML with no platform markers'), 'unknown');
  assert.equal(detectPlatform(''), 'unknown');
  assert.equal(detectPlatform(null), 'unknown');
});

test('detectPlatform: Shopify wins over Woo when both /products/ and /product/ appear', () => {
  const md = '[a](https://x.co.il/collections/all) [b](https://x.co.il/product/x/)';
  assert.equal(detectPlatform(md), 'shopify');
});

test('detectPlatform: extra high-signal markers', () => {
  assert.equal(detectPlatform('<script>window.Shopify={}</script>'), 'shopify');
  assert.equal(detectPlatform('https://shop.myshopify.com/x'), 'shopify');
  assert.equal(detectPlatform('<a href="/cart/?add-to-cart=42">buy</a>'), 'woo');
  assert.equal(detectPlatform('uses /wp-json/ rest api'), 'woo');
  assert.equal(detectPlatform('Server: Pepyaka'), 'wix');
});

// --- identifyPlatform cascade (injected fake scrape, no network) ----------

/* Build a fake ScrapeFn that returns canned content per URL substring. */
function fakeScrape(map: Record<string, string>): ScrapeFn {
  return async (url: string) => {
    for (const [needle, body] of Object.entries(map)) {
      if (url.includes(needle)) return body;
    }
    return '';
  };
}

test('identifyPlatform L1: static homepage markers win immediately', async () => {
  const scrape = fakeScrape({ 'x.co.il': '[a](https://x.co.il/collections/all)' });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'shopify');
});

test('identifyPlatform L2: empty static, rendered homepage reveals platform', async () => {
  let calls = 0;
  const scrape: ScrapeFn = async (url, _k, opts) => {
    if (url === 'https://x.co.il') {
      calls++;
      return opts?.waitFor ? '<div>woocommerce wc-block</div>' : ''; // empty until rendered
    }
    return '';
  };
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'woo');
  assert.equal(calls, 2); // tried static then rendered
});

test('identifyPlatform L3: endpoint fallback - Shopify /products.json', async () => {
  const scrape = fakeScrape({
    '/products.json': '{"products":[{"handle":"mint","variants":[]}]}',
  });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'shopify');
});

test('identifyPlatform L3: endpoint fallback - WordPress /wp-json/', async () => {
  const scrape = fakeScrape({ '/wp-json/': '{"namespace":"wp/v2","routes":{}}' });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'woo');
});

test('identifyPlatform: truly unknown stays unknown (caller will probe)', async () => {
  const scrape = fakeScrape({ nothing: 'x' });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'unknown');
});

test('identifyPlatform: never throws when scrape rejects', async () => {
  const scrape: ScrapeFn = async () => {
    throw new Error('network down');
  };
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'unknown');
});

// --- platform template registry -------------------------------------------

test('normalizePlatform: aliases collapse to canonical slugs', () => {
  assert.equal(normalizePlatform('WooCommerce'), 'woo');
  assert.equal(normalizePlatform('WordPress'), 'woo');
  assert.equal(normalizePlatform('Shopify'), 'shopify');
  assert.equal(normalizePlatform('Magento'), 'magento'); // unknown-but-valid slug
});

test('templateFor: built-ins known, unseen platform is null until learned', () => {
  assert.equal(templateFor('woo'), '{origin}/?s={query}&post_type=product');
  assert.equal(templateFor('shopify'), '{origin}/search?q={query}');
  assert.equal(templateFor('magento'), null);
});

test('registerPlatform: learned template is usable by searchUrlsFor', () => {
  registerPlatform('Magento', '{origin}/catalogsearch/result/?q={query}'); // no file = in-memory
  assert.equal(templateFor('magento'), '{origin}/catalogsearch/result/?q={query}');
  assert.deepEqual(searchUrlsFor('https://x.co.il', 'mint', 'magento'), [
    'https://x.co.il/catalogsearch/result/?q=mint',
  ]);
});

test('searchUrlsFor: still probes for genuinely unknown platform', () => {
  assert.equal(searchUrlsFor('https://x.co.il', 'mint', 'unknown').length, 3);
});

// --- LLM classification (Layer 4) -----------------------------------------

test('platformFingerprint: extracts URLs + truncates', () => {
  const md = 'x'.repeat(5000) + ' https://cdn.example.com/app.js';
  const fp = platformFingerprint(md, 1000);
  assert.ok(fp.includes('cdn.example.com'));
  assert.ok(fp.length < md.length);
});

test('classifyPlatformLLM: normalizes platform, keeps template with {query}', async () => {
  const classify: ClassifyFn = async () => ({
    platform: 'WooCommerce',
    searchTemplate: '{origin}/?s={query}&post_type=product',
  });
  const out = await classifyPlatformLLM('signals', 'k', classify);
  assert.equal(out.platform, 'woo');
  assert.equal(out.searchTemplate, '{origin}/?s={query}&post_type=product');
});

test('classifyPlatformLLM: rejects a template missing {query}', async () => {
  const classify: ClassifyFn = async () => ({ platform: 'shopify', searchTemplate: '{origin}/all' });
  const out = await classifyPlatformLLM('signals', 'k', classify);
  assert.equal(out.searchTemplate, null);
});

test('classifyPlatformLLM: never throws when the LLM call fails', async () => {
  const classify: ClassifyFn = async () => {
    throw new Error('openai down');
  };
  assert.deepEqual(await classifyPlatformLLM('signals', 'k', classify), {
    platform: 'unknown',
    searchTemplate: null,
  });
});

test('identifyPlatform L4: LLM names a new platform, registers + returns it', async () => {
  // L1-L3 all empty so the cascade reaches the LLM with homepage content.
  const scrape: ScrapeFn = async (url, _k, opts) =>
    url === 'https://x.co.il' && opts?.waitFor ? 'some custom storefront html' : '';
  const classify: ClassifyFn = async () => ({
    platform: 'bigcommerce',
    searchTemplate: '{origin}/search.php?search_query={query}',
  });
  const p = await identifyPlatform('https://x.co.il', 'k', { scrape, openaiKey: 'o', classify });
  assert.equal(p, 'bigcommerce');
  assert.equal(templateFor('bigcommerce'), '{origin}/search.php?search_query={query}');
});

test('identifyPlatform L4: skipped without openaiKey → unknown', async () => {
  const scrape: ScrapeFn = async (url, _k, opts) =>
    url === 'https://x.co.il' && opts?.waitFor ? 'some custom storefront html' : '';
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'unknown');
});

test('searchUrlsFor: known platforms return exactly one URL', () => {
  assert.deepEqual(searchUrlsFor('https://x.co.il', 'נענע', 'shopify'), [
    'https://x.co.il/search?q=%D7%A0%D7%A2%D7%A0%D7%A2',
  ]);
  assert.deepEqual(searchUrlsFor('https://x.co.il', 'mint', 'woo'), [
    'https://x.co.il/?s=mint&post_type=product',
  ]);
  assert.equal(searchUrlsFor('https://x.co.il', 'mint', 'wix').length, 1);
});

test('searchUrlsFor: unknown returns an ordered probe list', () => {
  const urls = searchUrlsFor('https://x.co.il', 'mint', 'unknown');
  assert.equal(urls.length, 3);
  assert.ok(urls[0].includes('post_type=product'));
  assert.ok(urls.some((u) => u.includes('/search?q=')));
});

test('searchUrlsFor: query is URL-encoded (no injection / spaces)', () => {
  const [url] = searchUrlsFor('https://x.co.il', 'aloe vera', 'woo');
  assert.ok(url.includes('aloe%20vera'));
});

test('scoreMarkdown: results page beats homepage fallback', () => {
  const resultsPage = '# תוצאות חיפוש עבור: נענע\n[נענע](https://x.co.il/product/mint/) ₪14';
  const homepageFallback = '[a](https://x.co.il/product/rose/) ₪20 ₪30 ₪40';
  assert.ok(scoreMarkdown(resultsPage, 'נענע') > scoreMarkdown(homepageFallback, 'נענע'));
});

test('scoreMarkdown: empty / null is zero', () => {
  assert.equal(scoreMarkdown('', 'mint'), 0);
  assert.equal(scoreMarkdown(null, 'mint'), 0);
});

test('priceFocusedExcerpt: keeps product/price lines, drops images + boilerplate', () => {
  const md = [
    '![logo](data:image/png;base64,AAAA)',
    'Some cookie banner text that should be dropped',
    '##### [נענע](https://x.co.il/product/mint/)',
    '₪14.00',
    'random footer line',
  ].join('\n');
  const out = priceFocusedExcerpt(md);
  assert.ok(out.includes('נענע'));
  assert.ok(out.includes('₪14.00'));
  assert.ok(!out.includes('cookie banner'));
  assert.ok(!out.includes('footer line'));
});

// --- Tavily fallback: resolveScrape orchestration (pure, injected providers) ---

const okPrimary = (md: string) => async () => md;
const throwPrimary = (msg: string) => async () => {
  throw new Error(msg);
};

test('resolveScrape: primary returns markdown → Tavily not called', async () => {
  let tavilyCalls = 0;
  const fallback = async () => {
    tavilyCalls++;
    return 'TAVILY';
  };
  const md = await resolveScrape({ url: 'x', tavilyKey: 'k', primary: okPrimary('FIRECRAWL'), fallback });
  assert.equal(md, 'FIRECRAWL');
  assert.equal(tavilyCalls, 0);
});

test('resolveScrape: primary throws → Tavily rescues', async () => {
  const md = await resolveScrape({
    url: 'x',
    tavilyKey: 'k',
    primary: throwPrimary('Firecrawl 500'),
    fallback: async () => 'TAVILY',
  });
  assert.equal(md, 'TAVILY');
});

test('resolveScrape: primary empty → Tavily rescues', async () => {
  const md = await resolveScrape({
    url: 'x',
    tavilyKey: 'k',
    primary: okPrimary(''),
    fallback: async () => 'TAVILY',
  });
  assert.equal(md, 'TAVILY');
});

test('resolveScrape: no tavilyKey → empty stays empty, throw rethrows', async () => {
  let tavilyCalls = 0;
  const fallback = async () => {
    tavilyCalls++;
    return 'TAVILY';
  };
  const empty = await resolveScrape({ url: 'x', primary: okPrimary(''), fallback });
  assert.equal(empty, '');
  await assert.rejects(
    () => resolveScrape({ url: 'x', primary: throwPrimary('boom'), fallback }),
    /boom/
  );
  assert.equal(tavilyCalls, 0);
});

test('resolveScrape: both fail → empty+empty is "", throw+throw surfaces primary error', async () => {
  const bothEmpty = await resolveScrape({
    url: 'x',
    tavilyKey: 'k',
    primary: okPrimary(''),
    fallback: async () => '',
  });
  assert.equal(bothEmpty, '');
  await assert.rejects(
    () =>
      resolveScrape({
        url: 'x',
        tavilyKey: 'k',
        primary: throwPrimary('FIRECRAWL_ERR'),
        fallback: throwPrimary('TAVILY_ERR'),
      }),
    /FIRECRAWL_ERR/
  );
});

// --- Tavily fallback: tavilyExtract response parsing (injected fetch) ---

const fakeFetch = (status: number, body: unknown): typeof fetch =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;

test('tavilyExtract: 200 → results[0].raw_content, sends markdown + extract_depth', async () => {
  let sentBody: any = null;
  const capturingFetch = (async (_url: string, init: any) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ results: [{ raw_content: 'MD' }] }) };
  }) as unknown as typeof fetch;
  const md = await tavilyExtract('https://x.co.il', 'k', {}, capturingFetch);
  assert.equal(md, 'MD');
  assert.equal(sentBody.urls, 'https://x.co.il');
  assert.equal(sentBody.format, 'markdown');
  assert.equal(sentBody.extract_depth, 'advanced');
});

test('tavilyExtract: failed_results → throws', async () => {
  await assert.rejects(
    () =>
      tavilyExtract(
        'https://x.co.il',
        'k',
        {},
        fakeFetch(200, { results: [], failed_results: [{ url: 'https://x.co.il', error: 'blocked' }] })
      ),
    /blocked/
  );
});

test('tavilyExtract: non-2xx → throws', async () => {
  await assert.rejects(() => tavilyExtract('https://x.co.il', 'k', {}, fakeFetch(429, {})), /Tavily 429/);
});

// --- inferAvailabilityLLM: availability estimate for no-shop sites ---

const fakeClassify =
  (out: any): ClassifyFn =>
  async () =>
    out;

test('inferAvailabilityLLM: empty site text → 0, no LLM call', async () => {
  let called = false;
  const classify: ClassifyFn = async () => {
    called = true;
    return {};
  };
  const est = await inferAvailabilityLLM('   ', 'מרווה', 'x.co.il', 'k', classify);
  assert.equal(est.confidence, 0);
  assert.equal(called, false);
  assert.match(est.reasoning, /no reachable/);
});

test('inferAvailabilityLLM: parses confidence + reasoning', async () => {
  const est = await inferAvailabilityLLM(
    'אנחנו מגדלים עשבי תיבול ורב-שנתיים',
    'מרווה',
    'x.co.il',
    'k',
    fakeClassify({ confidence: 75, reasoning: 'sells herbs & perennials' })
  );
  assert.equal(est.confidence, 75);
  assert.equal(est.reasoning, 'sells herbs & perennials');
});

test('inferAvailabilityLLM: clamps out-of-range / non-numeric confidence', async () => {
  assert.equal((await inferAvailabilityLLM('text', 'q', 's', 'k', fakeClassify({ confidence: 140 }))).confidence, 100);
  assert.equal((await inferAvailabilityLLM('text', 'q', 's', 'k', fakeClassify({ confidence: -5 }))).confidence, 0);
  assert.equal((await inferAvailabilityLLM('text', 'q', 's', 'k', fakeClassify({ confidence: 'lots' }))).confidence, 0);
});

test('inferAvailabilityLLM: never throws when the LLM call fails', async () => {
  const classify: ClassifyFn = async () => {
    throw new Error('LLM down');
  };
  const est = await inferAvailabilityLLM('text', 'q', 's', 'k', classify);
  assert.equal(est.confidence, 0);
  assert.match(est.reasoning, /unavailable/);
});

// --- extractAndVerifyPlants orchestration (injected passes, no network) -----

/* Markdown that survives priceFocusedExcerpt, so the real orchestration runs. */
const PRICED_MD = '##### [מרווה](https://x.co.il/products/sage)\n₪49\n';

const plant = (name: string): Plant => ({ name, price: '₪49', availability: 'in_stock' });

const verdict = (over: Partial<VerificationReport> = {}): VerificationReport => ({
  is_valid: true,
  confidence_score: 100,
  feedback: '',
  corrected_output: [],
  ...over,
});

test('extractAndVerifyPlants: zero extracted rows skip the auditor call entirely', async () => {
  let verifyCalls = 0;
  const res = await extractAndVerifyPlants(
    { markdown: PRICED_MD, query: 'q', site: 's', openaiKey: 'k' },
    {
      extract: async () => [],
      verify: async () => {
        verifyCalls++;
        return verdict();
      },
    }
  );
  assert.equal(verifyCalls, 0); // the whole point: no wasted LLM round trip
  assert.deepEqual(res.plants, []);
  assert.equal(res.report.is_valid, true);
  assert.equal(res.engines.extractor, OPENAI_MODEL);
  assert.equal(res.engines.verifier, 'none');
});

test('extractAndVerifyPlants: a rejection that drops every row is honoured', async () => {
  const res = await extractAndVerifyPlants(
    { markdown: PRICED_MD, query: 'q', site: 's', openaiKey: 'k' },
    {
      extract: async () => [plant('hallucinated')],
      verify: async () =>
        verdict({ is_valid: false, feedback: 'not in source', corrected_output: [] }),
    }
  );
  assert.deepEqual(res.plants, []); // NOT the rejected extraction
});

test('extractAndVerifyPlants: a rejection that corrects rows returns the corrections', async () => {
  const res = await extractAndVerifyPlants(
    { markdown: PRICED_MD, query: 'q', site: 's', openaiKey: 'k' },
    {
      extract: async () => [{ name: 'מרווה', price: '₪9', availability: 'in_stock' }],
      verify: async () =>
        verdict({ is_valid: false, feedback: 'price misread', corrected_output: [plant('מרווה')] }),
    }
  );
  assert.deepEqual(res.plants, [plant('מרווה')]);
});

test('extractAndVerifyPlants: a clean verdict with no echo keeps the extracted rows', async () => {
  const res = await extractAndVerifyPlants(
    { markdown: PRICED_MD, query: 'q', site: 's', openaiKey: 'k' },
    { extract: async () => [plant('מרווה')], verify: async () => verdict() }
  );
  assert.deepEqual(res.plants, [plant('מרווה')]);
  assert.equal(res.engines.verifier, OPENAI_MODEL);
});

test('extractAndVerifyPlants: no excerpt and no key both short-circuit before any pass', async () => {
  let passes = 0;
  const count = { extract: async () => (passes++, []), verify: async () => (passes++, verdict()) };
  const noText = await extractAndVerifyPlants(
    { markdown: 'just prose, no prices', query: 'q', site: 's', openaiKey: 'k' },
    count
  );
  const noKey = await extractAndVerifyPlants({ markdown: PRICED_MD, query: 'q', site: 's' }, count);
  assert.equal(passes, 0);
  assert.equal(noText.funnel.stage, 'no_excerpt');
  assert.match(noKey.report.feedback, /no OpenAI key/);
});

test('identifyPlatform: L2 and both L3 endpoint probes run concurrently, not serially', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const scrape: ScrapeFn = async (url, _k, o) => {
    // L1 (static homepage, no waitFor) is a stage of its own - exclude it so the
    // counter measures only the concurrent stage.
    if (url === 'https://x.co.il' && !o?.waitFor) return '';
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return url.includes('/wp-json/') ? '{"namespace":"wp/v2"}' : '';
  };
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'woo');
  assert.equal(maxInFlight, 3); // L2 + /products.json + /wp-json/ overlap
});

test('identifyPlatform: L2 still wins over an L3 endpoint that also matches', async () => {
  const scrape = fakeScrape({
    '/products.json': '{"handle":"mint"}',
    'x.co.il': '<div>wixstatic.com</div>',
  });
  // Both would classify, but precedence must stay L2 -> shopify -> wp regardless
  // of which concurrent probe settles first. L1 sees the same wix body here, so
  // assert against a site whose static read is empty.
  const staged: ScrapeFn = async (url, k, o) =>
    url === 'https://x.co.il' && !o?.waitFor ? '' : scrape(url, k, o);
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape: staged }), 'wix');
});

// --- hostOf + the searcher's homepage reuse --------------------------------

test('hostOf: canonical key - strips www, lowercases, survives a non-URL', () => {
  assert.equal(hostOf('https://WWW.Decogarden.co.il/search?q=x'), 'decogarden.co.il');
  assert.equal(hostOf('http://gan-ad.com'), 'gan-ad.com');
  assert.equal(hostOf('not a url'), 'not a url');
});

test('identifyPlatform: publishes the homepage it read, rendered copy winning', async () => {
  const seen: string[] = [];
  const l1 = fakeScrape({ 'x.co.il': '[a](https://x.co.il/collections/all)' });
  await identifyPlatform('https://x.co.il', 'k', { scrape: l1, onHomeMarkdown: (m) => seen.push(m) });
  assert.deepEqual(seen, ['[a](https://x.co.il/collections/all)']); // L1 hit, published once

  const seen2: string[] = [];
  const staged: ScrapeFn = async (url, _k, o) => {
    if (url !== 'https://x.co.il') return '';
    return o?.waitFor ? 'rendered wixstatic.com' : 'static, unclassifiable';
  };
  await identifyPlatform('https://x.co.il', 'k', {
    scrape: staged,
    onHomeMarkdown: (m) => seen2.push(m),
  });
  assert.deepEqual(seen2, ['static, unclassifiable', 'rendered wixstatic.com']);
});

test('identifyPlatform: publishes nothing when every layer comes back empty', async () => {
  let calls = 0;
  await identifyPlatform('https://x.co.il', 'k', {
    scrape: fakeScrape({}),
    onHomeMarkdown: () => calls++,
  });
  assert.equal(calls, 0);
});

test('createSearcher: caches the homepage read during identification, per host', async () => {
  const searcher = createSearcher('fc-key');
  assert.equal(searcher.cachedHomeMarkdown('never-seen.co.il'), ''); // cold host, no lie
});

// --- product/price recognition + the extraction funnel ---------------------

test('priceFocusedExcerpt: keeps Wix /product-page/ listings', () => {
  // Wix's canonical product URL does not match /\/products?\//, so these lines
  // used to be filtered out entirely and the model saw an empty page.
  const md = '[מרווה רפואית](https://gan-ad.com/product-page/salvia)\n49 ש"ח';
  assert.match(priceFocusedExcerpt(md), /product-page/);
  assert.ok(scoreMarkdown(md, 'מרווה') > 50); // link + price both counted
});

test('priceFocusedExcerpt: keeps the Hebrew and Latin ways to write ILS', () => {
  for (const price of ['₪49', '49 ש"ח', '49 ש״ח', 'מחיר: 32 שח', '45.00 NIS', '45.00 ILS']) {
    assert.equal(priceFocusedExcerpt(price), price, `dropped: ${price}`);
  }
});

test('priceFocusedExcerpt: bare Hebrew prose is not mistaken for a price', () => {
  // 'שח' is a substring of ordinary words; only a digit-adjacent match counts.
  for (const line of ['משחה לצמחים', 'פרחים בצבע שחור', 'שעות פתיחה 9 עד 17']) {
    assert.equal(priceFocusedExcerpt(line), '', `false positive: ${line}`);
  }
  assert.equal(priceFocusedExcerpt('[מדריך](https://x.co.il/product-reviews/sage)'), '');
});

test('extractAndVerifyPlants: funnel separates no_markdown from no_excerpt', async () => {
  const noMd = await extractAndVerifyPlants({ markdown: '', query: 'q', site: 's', openaiKey: 'k' });
  assert.equal(noMd.funnel.stage, 'no_markdown');

  const noExcerpt = await extractAndVerifyPlants({
    markdown: 'a real page of prose about gardening, with no product lines at all',
    query: 'q',
    site: 's',
    openaiKey: 'k',
  });
  assert.equal(noExcerpt.funnel.stage, 'no_excerpt'); // our parser missed it - fixable
  assert.ok(noExcerpt.funnel.mdChars > 0);
});

test('extractAndVerifyPlants: funnel reports no_match, rejected and ok', async () => {
  const run = (extract: () => Promise<Plant[]>, verify: () => Promise<VerificationReport>) =>
    extractAndVerifyPlants(
      { markdown: PRICED_MD, query: 'q', site: 's', openaiKey: 'k' },
      { extract, verify }
    );

  const noMatch = await run(async () => [], async () => verdict());
  assert.equal(noMatch.funnel.stage, 'no_match');

  const rejected = await run(
    async () => [plant('ghost')],
    async () => verdict({ is_valid: false, corrected_output: [] })
  );
  assert.equal(rejected.funnel.stage, 'rejected');
  assert.equal(rejected.funnel.extracted, 1);
  assert.equal(rejected.funnel.kept, 0);

  const ok = await run(async () => [plant('מרווה')], async () => verdict());
  assert.equal(ok.funnel.stage, 'ok');
  assert.equal(ok.funnel.kept, 1);
});

// --- rate-limit defences ---------------------------------------------------

test('createLimiter: never exceeds max in flight, and still runs everything', async () => {
  const run = createLimiter(3);
  let inFlight = 0;
  let peak = 0;
  const done: number[] = [];
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        done.push(i);
      })
    )
  );
  assert.equal(peak, 3);
  assert.equal(done.length, 20); // queued work is run, not dropped
});

test('createLimiter: a throwing task releases its slot', async () => {
  const run = createLimiter(1);
  await assert.rejects(() => run(async () => { throw new Error('boom'); }));
  assert.equal(await run(async () => 'after'), 'after'); // would hang if leaked
});

test('retryDelayMs: backs off exponentially instead of retrying instantly', () => {
  // The bug this replaces: three immediate retries burned the whole budget
  // inside the same rate-limit window, turning a soft 429 into a hard failure.
  const noJitter = () => 0.5; // -> exactly 100% of base
  assert.equal(retryDelayMs(1, null, noJitter), 1000);
  assert.equal(retryDelayMs(2, null, noJitter), 2000);
  assert.equal(retryDelayMs(3, null, noJitter), 4000);
});

test('retryDelayMs: jitter spreads a synchronized fan-out across a window', () => {
  assert.equal(retryDelayMs(1, null, () => 0), 500); // 50% of base
  assert.equal(retryDelayMs(1, null, () => 1), 1500); // 150% of base
});

test('retryDelayMs: Retry-After wins over the backoff, but is capped', () => {
  assert.equal(retryDelayMs(1, '7'), 7000);
  assert.equal(retryDelayMs(3, '2'), 2000); // server's answer beats our guess
  assert.equal(retryDelayMs(1, '9999'), 30000); // cannot stall a whole search
  // Junk or absent headers fall through to the exponential path.
  assert.equal(retryDelayMs(1, 'Wed, 21 Oct 2026 07:28:00 GMT', () => 0.5), 1000);
  assert.equal(retryDelayMs(1, '0', () => 0.5), 1000);
});

// --- bot-wall detection ----------------------------------------------------

test('looksUnreadable: catches the walls that produced fabricated estimates', () => {
  // The observed case: the model was handed a Cloudflare page and returned
  // "~50% · the site text is only a security-verification page".
  for (const page of [
    'Security Verification required to continue',
    'Please verify you are human',
    'Checking your browser before accessing',
    '<div id="cf-browser-verification">',
    'Complete the CAPTCHA to continue',
    'Please enable JavaScript to view this site',
    'Access Denied',
    'Attention Required! | Cloudflare',
    'נדרש אימות אבטחה כדי להמשיך',
    '',
    '   ',
  ]) {
    assert.equal(looksUnreadable(page), true, `should be unreadable: ${JSON.stringify(page)}`);
  }
});

test('looksUnreadable: a real catalogue is not mistaken for a wall', () => {
  // A loose marker list would downgrade working shops, which is worse than the
  // bug being fixed - these are the negatives that keep the list honest.
  for (const page of [
    '##### [מרווה רפואית](https://x.co.il/products/sage)\n₪49',
    'We verify every plant before shipping. Free delivery over ₪200.',
    'Our security policy protects your payment details.',
    'משתלה אורגנית - צמחי תבלין, ורדים ועצי פרי',
  ]) {
    assert.equal(looksUnreadable(page), false, `should be readable: ${JSON.stringify(page)}`);
  }
});

// --- query translation -----------------------------------------------------

test('translateQuery: an English name becomes the Hebrew a nursery would list', async () => {
  /*
   * Israeli nurseries index their catalogues in Hebrew, so searching them for
   * "alocasia regal shield" matches nothing - the shop may stock the plant, the
   * string just never appears on the page.
   */
  const out = await translateQuery(
    'alocasia regal shield',
    'k',
    fakeClassify({ hebrew: 'אלוקסיה ריגל שילד' })
  );
  assert.equal(out, 'אלוקסיה ריגל שילד');
});

test('translateQuery: a query already in Hebrew costs nothing', async () => {
  let calls = 0;
  const counting: ClassifyFn = async () => {
    calls += 1;
    return {};
  };
  assert.equal(await translateQuery('מרווה', 'k', counting), 'מרווה');
  assert.equal(calls, 0, 'no round trip for a query that needs none');
});

test('translateQuery: a useless answer falls back to the original', async () => {
  // Better to search in the wrong language than not to search at all.
  assert.equal(await translateQuery('monstera', 'k', fakeClassify({ hebrew: '' })), 'monstera');
  assert.equal(
    await translateQuery('monstera', 'k', fakeClassify({ hebrew: 'Monstera deliciosa' })),
    'monstera',
    'an English echo is not a translation'
  );
  const throwing: ClassifyFn = async () => {
    throw new Error('LLM down');
  };
  assert.equal(await translateQuery('monstera', 'k', throwing), 'monstera');
});

test('hasHebrew distinguishes the two scripts', () => {
  assert.equal(hasHebrew('אלוקסיה'), true);
  assert.equal(hasHebrew('alocasia'), false);
  assert.equal(hasHebrew('Alocasia אלוקסיה'), true);
  assert.equal(hasHebrew(''), false);
});

// --- price sanity check ----------------------------------------------------

test('sanityCheckPrices: an explicit false is the only thing that flags a row', async () => {
  const candidates = [
    { site: 'a.co.il', name: 'Monstera', price: '₪89' },
    { site: 'b.co.il', name: 'Monstera', price: '₪0521234567' },
  ];
  const out = await sanityCheckPrices(
    'monstera',
    candidates,
    'k',
    fakeClassify({
      results: [
        { index: 0, plausible: true, reason: '' },
        { index: 1, plausible: false, reason: 'that is a phone number' },
      ],
    })
  );

  assert.equal(out[0].plausible, true);
  assert.equal(out[1].plausible, false);
  assert.equal(out[1].reason, 'that is a phone number');
});

test('sanityCheckPrices: a broken or missing verdict never hides a real price', async () => {
  /*
   * This is a safety net, and a torn net must not start dropping prices. Only
   * an explicit `plausible: false` removes a number; silence, junk indexes and
   * outright failure all leave every row intact.
   */
  const candidates = [{ site: 'a.co.il', name: 'Monstera', price: '₪89' }];
  const allPlausible = (out: { plausible: boolean }[]) =>
    assert.ok(out.every((v) => v.plausible));

  allPlausible(await sanityCheckPrices('monstera', candidates, 'k', fakeClassify({})));
  allPlausible(await sanityCheckPrices('monstera', candidates, 'k', fakeClassify({ results: [] })));
  allPlausible(
    await sanityCheckPrices(
      'monstera',
      candidates,
      'k',
      fakeClassify({ results: [{ index: 99, plausible: false, reason: 'out of range' }] })
    )
  );
  const throwing: ClassifyFn = async () => {
    throw new Error('LLM down');
  };
  allPlausible(await sanityCheckPrices('monstera', candidates, 'k', throwing));
  // No key and no rows are both no-ops rather than errors.
  allPlausible(await sanityCheckPrices('monstera', candidates, '', fakeClassify({})));
  assert.deepEqual(await sanityCheckPrices('monstera', [], 'k', fakeClassify({})), []);
});

test('sanityCheckPrices: the prompt tells the model that expensive is not wrong', async () => {
  /*
   * al-haderech genuinely sells variegated Alocasias at ₪1,499.90. A check that
   * flagged big numbers would have turned a correct price into a missing one,
   * so the instruction is part of the contract, not decoration.
   */
  let seen = '';
  const capture: ClassifyFn = async (prompt) => {
    seen = prompt;
    return { results: [] };
  };
  await sanityCheckPrices('alocasia', [{ site: 'a', name: 'x', price: '₪1,499.90' }], 'k', capture);

  assert.match(seen, /PLAUSIBLE even when it is HIGH/);
  assert.match(seen, /₪500-₪1500/);
  assert.match(seen, /phone number/);
  assert.match(seen, /free-shipping threshold/i);
});

// --- callOpenAIJson: reasoning models can spend the whole token budget -------
//
// The Deliver tab bug: a 200 OK whose content is '' because finish_reason was
// 'length'. The old code fed that straight to JSON.parse and threw a parse
// error, which scrapeOne recorded as "we could not read this shop".

function openAiFetchStub(replies: { content: string; finish: string }[]) {
  const caps: number[] = [];
  const fn = (async (_url: string, init: any) => {
    caps.push(JSON.parse(init.body).max_completion_tokens);
    const r = replies[Math.min(caps.length - 1, replies.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: r.content }, finish_reason: r.finish }] }),
    };
  }) as unknown as typeof fetch;
  return { fn, caps };
}

test('callOpenAIJson: truncated empty reply retries once at double the budget', async () => {
  const original = globalThis.fetch;
  const { fn, caps } = openAiFetchStub([
    { content: '', finish: 'length' },
    { content: '{"plants":[{"name":"מונסטרה"}]}', finish: 'stop' },
  ]);
  globalThis.fetch = fn;
  try {
    const out = await callOpenAIJson('p', 'k', 2000);
    assert.deepEqual(caps, [2000, 4000]);
    assert.equal(out.plants[0].name, 'מונסטרה');
  } finally {
    globalThis.fetch = original;
  }
});

test('callOpenAIJson: still empty after the retry → names the truncation, not a parse error', async () => {
  const original = globalThis.fetch;
  const { fn } = openAiFetchStub([{ content: '', finish: 'length' }]);
  globalThis.fetch = fn;
  try {
    await assert.rejects(() => callOpenAIJson('p', 'k', 2000), /finish_reason=length/);
  } finally {
    globalThis.fetch = original;
  }
});

test('callOpenAIJson: a good first answer costs no second call', async () => {
  const original = globalThis.fetch;
  const { fn, caps } = openAiFetchStub([{ content: '{"ok":true}', finish: 'stop' }]);
  globalThis.fetch = fn;
  try {
    assert.deepEqual(await callOpenAIJson('p', 'k', 6000), { ok: true });
    assert.deepEqual(caps, [6000]);
  } finally {
    globalThis.fetch = original;
  }
});

// --- scrape speed: cached reads, quick-then-careful search, host memory -----

/* A ScrapeFn that records every call and answers from a URL-substring map. */
function recordingScrape(map: Record<string, string>) {
  const calls: Array<{ url: string; opts: any }> = [];
  const fn: ScrapeFn = async (url, _key, opts) => {
    calls.push({ url, opts: opts ?? {} });
    for (const [needle, body] of Object.entries(map)) {
      if (url.includes(needle)) return body;
    }
    return '';
  };
  return { fn, calls };
}

const SHOPIFY_HOME = '[all](https://shop.co.il/collections/all)';
const RESULTS = '[מרווה](https://shop.co.il/products/salvia) ₪49';

test('searchWaitFor: server-rendered platforms skip the render wait, others keep it', () => {
  assert.equal(searchWaitFor('shopify'), 0);
  assert.equal(searchWaitFor('woo'), 0);
  assert.equal(searchWaitFor('WooCommerce'), 0); // alias-normalized
  assert.equal(searchWaitFor('wix'), RENDER_WAIT_MS);
  assert.equal(searchWaitFor('unknown'), RENDER_WAIT_MS);
  assert.equal(searchWaitFor('some-llm-taught-platform'), RENDER_WAIT_MS);
});

test('identification reads accept a week-old Firecrawl copy', async () => {
  const { fn, calls } = recordingScrape({ 'shop.co.il': SHOPIFY_HOME });
  await identifyPlatform('https://shop.co.il', 'k', { scrape: fn });
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.equal(c.opts.maxAge, HOMEPAGE_MAX_AGE_MS, c.url);
});

test('fetchSearchMarkdown: known platform reads quick first - no wait, hour-old copy OK', async () => {
  const { fn, calls } = recordingScrape({ 'search?q=': RESULTS, 'shop.co.il': SHOPIFY_HOME });
  const searcher = createSearcher('k', { scrape: fn, tavilyKey: 't' });
  const r = await searcher.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
  assert.equal(r.platform, 'shopify');
  assert.equal(r.md, RESULTS);
  const search = calls.filter((c) => c.url.includes('search?q='));
  assert.equal(search.length, 1); // the quick read was enough
  assert.equal(search[0].opts.waitFor, 0);
  assert.equal(search[0].opts.maxAge, SEARCH_MAX_AGE_MS);
  assert.equal(search[0].opts.tavilyKey, undefined); // Tavily is the careful read's job
});

test('fetchSearchMarkdown: an empty quick read is followed by a careful one', async () => {
  let searchReads = 0;
  const fn: ScrapeFn = async (url, _key, opts) => {
    if (url.includes('collections') || url === 'https://shop.co.il') return SHOPIFY_HOME;
    if (url.includes('search?q=')) {
      searchReads++;
      // Quick read: the grid had not painted. Careful read: results.
      return opts?.waitFor === RENDER_WAIT_MS ? RESULTS : '';
    }
    return '';
  };
  const calls: any[] = [];
  const spy: ScrapeFn = (u, k, o) => (calls.push({ u, o }), fn(u, k, o));
  const searcher = createSearcher('k', { scrape: spy, tavilyKey: 't' });
  const r = await searcher.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
  assert.equal(r.md, RESULTS);
  assert.equal(searchReads, 2);
  const careful = calls.filter((c) => c.u.includes('search?q=')).at(-1);
  assert.equal(careful.o.waitFor, RENDER_WAIT_MS);
  assert.equal(careful.o.maxAge, 0); // fresh, never a cached miss
  assert.equal(careful.o.tavilyKey, 't');
});

test('fetchSearchMarkdown: a quick read that throws is not fatal - the careful read runs', async () => {
  let first = true;
  const fn: ScrapeFn = async (url) => {
    if (!url.includes('search?q=')) return SHOPIFY_HOME;
    if (first) {
      first = false;
      throw new Error('timeout');
    }
    return RESULTS;
  };
  const searcher = createSearcher('k', { scrape: fn });
  const r = await searcher.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
  assert.equal(r.md, RESULTS);
});

test('createSearcher: remembers a host platform on disk, and a new process skips identification', async () => {
  const file = path.join(os.tmpdir(), `known-hosts-${process.pid}-${Date.now()}.json`);
  try {
    const a = recordingScrape({ 'search?q=': RESULTS, 'shop.co.il': SHOPIFY_HOME });
    const s1 = createSearcher('k', { scrape: a.fn, hostsFile: file });
    await s1.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.ok(a.calls.some((c) => !c.url.includes('search?q=')), 'cold host was identified');
    assert.equal(loadHostPlatforms(file)['shop.co.il']?.platform, 'shopify');

    const b = recordingScrape({ 'search?q=': RESULTS });
    const s2 = createSearcher('k', { scrape: b.fn, hostsFile: file });
    const r = await s2.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.equal(r.platform, 'shopify');
    assert.ok(b.calls.every((c) => c.url.includes('search?q=')), 'warm host: search only');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('createSearcher: an expired host memory is re-identified, unknown is never written', async () => {
  const file = path.join(os.tmpdir(), `known-hosts-${process.pid}-${Date.now()}-ttl.json`);
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({ 'shop.co.il': { platform: 'woo', at: 0 } }) // ancient
    );
    const a = recordingScrape({ 'search?q=': RESULTS, 'shop.co.il': SHOPIFY_HOME });
    const s = createSearcher('k', { scrape: a.fn, hostsFile: file, now: () => HOST_PLATFORM_TTL_MS + 1 });
    const r = await s.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.equal(r.platform, 'shopify'); // not the stale 'woo'

    const u = recordingScrape({});
    const s3 = createSearcher('k', { scrape: u.fn, hostsFile: file });
    await s3.fetchSearchMarkdown('https://nothing.co.il', 'x', 'nothing.co.il');
    assert.equal(loadHostPlatforms(file)['nothing.co.il'], undefined);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('createSearcher: a remembered host that reads nothing is forgotten, so the next search re-identifies', async () => {
  const file = path.join(os.tmpdir(), `known-hosts-${process.pid}-${Date.now()}-forget.json`);
  try {
    fs.writeFileSync(file, JSON.stringify({ 'shop.co.il': { platform: 'shopify', at: Date.now() } }));
    const a = recordingScrape({}); // every read empty
    const s = createSearcher('k', { scrape: a.fn, hostsFile: file });
    const r = await s.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.equal(r.md, '');
    assert.equal(loadHostPlatforms(file)['shop.co.il'], undefined);
    const before = a.calls.length;
    await s.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.ok(a.calls.length - before > 1, 'second search identified again');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

// --- the plan's minute window --------------------------------------------

test('rateLimitWaitMs: Retry-After header wins, else the wait named in the body, else null', () => {
  assert.equal(rateLimitWaitMs('7', 'ignored'), 7000);
  assert.equal(
    rateLimitWaitMs(null, 'Rate limit exceeded. Consumed (req/min): 15, Remaining (req/min): 0. ... please retry after 51s, resets at Wed'),
    51000
  );
  assert.equal(rateLimitWaitMs(undefined, 'Rate limit exceeded'), null);
  assert.equal(rateLimitWaitMs('', ''), null);
});

/* A fake clock + wait: `wait` advances the clock instead of sleeping. */
function fakeClock() {
  let t = 0;
  const waits: number[] = [];
  return {
    now: () => t,
    wait: async (ms: number) => {
      waits.push(ms);
      t += ms;
    },
    waits,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

test('createRateLimiter: the N+1th request in a minute waits for the window to slide', async () => {
  const c = fakeClock();
  const rl = createRateLimiter(3, c);
  await rl.take();
  c.tick(1000);
  await rl.take();
  await rl.take();
  assert.deepEqual(c.waits, []); // three fit
  await rl.take(); // fourth: must wait until the first one is a minute old
  assert.deepEqual(c.waits, [61000]); // until the first send is a minute (plus slack) old
  assert.equal(c.now(), 62000);
});

test('createRateLimiter: holdUntil freezes every waiter until the server-named reset', async () => {
  const c = fakeClock();
  const rl = createRateLimiter(10, c);
  rl.holdUntil(51000);
  assert.equal(rl.waitEstimateMs(), 51000);
  await rl.take();
  assert.deepEqual(c.waits, [51000]);
  assert.equal(rl.waitEstimateMs(), 0);
  await rl.take(); // hold is over, no further wait
  assert.deepEqual(c.waits, [51000]);
});

test('fetchSearchMarkdown: unknown platform probes one at a time and stops at a confident hit', async () => {
  const calls: string[] = [];
  const fn: ScrapeFn = async (url) => {
    calls.push(url);
    if (url.includes('post_type=product')) return 'results for מרווה: [a](https://x.co.il/products/a) ₪49';
    return '';
  };
  const s = createSearcher('k', { scrape: fn });
  const r = await s.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il');
  assert.equal(r.platform, 'unknown');
  assert.ok(scoreMarkdown(r.md, 'מרווה') >= PROBE_CONFIDENT_SCORE);
  const probes = calls.filter((u) => u.includes('%D7%9E')); // encoded query
  assert.equal(probes.length, 1, `probed: ${probes.join(' ')}`); // first probe hit, the other two never ran
});

test('fetchSearchMarkdown: an unconfident probe does not end the search - all probes run, best kept', async () => {
  const calls: string[] = [];
  const fn: ScrapeFn = async (url) => {
    calls.push(url);
    if (url.includes('post_type=product')) return 'homepage-ish, one price ₪49';
    if (url.includes('/search?q=')) return 'results for מרווה [a](https://x.co.il/products/a) ₪49 ₪59';
    return '';
  };
  const s = createSearcher('k', { scrape: fn });
  const r = await s.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il');
  assert.match(r.picked ?? '', /search\?q=/);
  assert.ok(calls.filter((u) => u.includes('%D7%9E')).length >= 2);
});

test('createSearcher: an unknown verdict expires after an hour and the host is re-identified', async () => {
  const c = fakeClock();
  let home = '';
  const fn: ScrapeFn = async (url) => (url.includes('%D7%9E') ? '' : home);
  const s = createSearcher('k', { scrape: fn, now: c.now });
  assert.equal((await s.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il')).platform, 'unknown');
  home = SHOPIFY_HOME; // the site was readable all along; the first read was refused
  c.tick(UNKNOWN_TTL_MS - 1);
  assert.equal((await s.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il')).platform, 'unknown');
  c.tick(2);
  assert.equal((await s.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il')).platform, 'shopify');
});

test('fetchSearchMarkdown: a readable page that scores zero is the answer - no careful re-read', async () => {
  const { fn, calls } = recordingScrape({
    'search?q=': 'תוצאות חיפוש\nלא נמצאו מוצרים התואמים את הבחירה שלך.\nעמוד הבית | אודות | צור קשר',
    'shop.co.il': SHOPIFY_HOME,
  });
  const searcher = createSearcher('k', { scrape: fn, tavilyKey: 't' });
  const r = await searcher.fetchSearchMarkdown('https://shop.co.il', 'לבנדר', 'shop.co.il');
  assert.equal(scoreMarkdown(r.md, 'לבנדר'), 0);
  assert.equal(calls.filter((c) => c.url.includes('search?q=')).length, 1);
});

test('fetchSearchMarkdown: a bot wall on the quick read triggers the careful one', async () => {
  const calls: any[] = [];
  const fn: ScrapeFn = async (url, _k, opts) => {
    calls.push({ url, opts });
    if (!url.includes('search?q=')) return SHOPIFY_HOME;
    return opts?.waitFor === RENDER_WAIT_MS ? RESULTS : 'Checking your browser before accessing the site. Please enable JavaScript.';
  };
  const searcher = createSearcher('k', { scrape: fn, tavilyKey: 't' });
  const r = await searcher.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
  assert.equal(r.md, RESULTS);
  assert.equal(calls.filter((c) => c.url.includes('search?q=')).length, 2);
});

test('createSearcher: a confident probe hit teaches a per-host template - one request next time', async () => {
  const file = path.join(os.tmpdir(), `known-hosts-${process.pid}-${Date.now()}-tpl.json`);
  try {
    const calls: string[] = [];
    const fn: ScrapeFn = async (url) => {
      calls.push(url);
      if (url.includes('/search?q=')) return 'results for מרווה [a](https://x.co.il/products/a) ₪49';
      return '';
    };
    const s1 = createSearcher('k', { scrape: fn, hostsFile: file });
    await s1.fetchSearchMarkdown('https://x.co.il', 'מרווה', 'x.co.il');
    assert.equal(loadHostPlatforms(file)['x.co.il']?.template, '{origin}/search?q={query}');

    const calls2: string[] = [];
    const fn2: ScrapeFn = async (url) => {
      calls2.push(url);
      return url.includes('/search?q=') ? 'results [b](https://x.co.il/products/b) ₪59' : '';
    };
    const s2 = createSearcher('k', { scrape: fn2, hostsFile: file });
    const r = await s2.fetchSearchMarkdown('https://x.co.il', 'לבנדר', 'x.co.il');
    assert.equal(r.platform, 'unknown');
    assert.deepEqual(calls2, ['https://x.co.il/search?q=%D7%9C%D7%91%D7%A0%D7%93%D7%A8']); // no identification, no probes
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('fetchSearchMarkdown: with Firecrawl\'s minute spent, a search read goes to Tavily first', async () => {
  const realFetch = globalThis.fetch;
  const tavilyCalls: string[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    tavilyCalls.push(JSON.parse(init.body).urls);
    return new Response(JSON.stringify({ results: [{ raw_content: RESULTS }] }), { status: 200 });
  }) as any;
  try {
    const { fn, calls } = recordingScrape({ 'shop.co.il': SHOPIFY_HOME });
    const s = createSearcher('k', { scrape: fn, tavilyKey: 't', firecrawlWaitMs: () => 40_000 });
    const r = await s.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.equal(r.md, RESULTS);
    assert.equal(tavilyCalls.length, 1);
    assert.equal(calls.filter((c) => c.url.includes('search?q=')).length, 0); // Firecrawl never asked
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchSearchMarkdown: a short Firecrawl queue is waited out, Tavily untouched', async () => {
  const realFetch = globalThis.fetch;
  let tavilyCalls = 0;
  globalThis.fetch = (async () => {
    tavilyCalls++;
    return new Response('{}', { status: 500 });
  }) as any;
  try {
    const { fn } = recordingScrape({ 'search?q=': RESULTS, 'shop.co.il': SHOPIFY_HOME });
    const s = createSearcher('k', { scrape: fn, tavilyKey: 't', firecrawlWaitMs: () => 2_000 });
    const r = await s.fetchSearchMarkdown('https://shop.co.il', 'מרווה', 'shop.co.il');
    assert.equal(r.md, RESULTS);
    assert.equal(tavilyCalls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
