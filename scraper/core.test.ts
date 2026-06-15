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
} from './core.ts';
import type { ScrapeFn } from './core.ts';

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
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'shopify');
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
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'woo');
  assert.equal(calls, 2); // tried static then rendered
});

test('identifyPlatform L3: endpoint fallback — Shopify /products.json', async () => {
  const scrape = fakeScrape({
    '/products.json': '{"products":[{"handle":"mint","variants":[]}]}',
  });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'shopify');
});

test('identifyPlatform L3: endpoint fallback — WordPress /wp-json/', async () => {
  const scrape = fakeScrape({ '/wp-json/': '{"namespace":"wp/v2","routes":{}}' });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'woo');
});

test('identifyPlatform: truly unknown stays unknown (caller will probe)', async () => {
  const scrape = fakeScrape({ nothing: 'x' });
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'unknown');
});

test('identifyPlatform: never throws when scrape rejects', async () => {
  const scrape: ScrapeFn = async () => {
    throw new Error('network down');
  };
  assert.equal(await identifyPlatform('https://x.co.il', 'k', scrape), 'unknown');
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
