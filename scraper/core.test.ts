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
} from './core.ts';
import type { ScrapeFn, ClassifyFn } from './core.ts';

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

test('identifyPlatform L3: endpoint fallback — Shopify /products.json', async () => {
  const scrape = fakeScrape({
    '/products.json': '{"products":[{"handle":"mint","variants":[]}]}',
  });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', { scrape }), 'shopify');
});

test('identifyPlatform L3: endpoint fallback — WordPress /wp-json/', async () => {
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
