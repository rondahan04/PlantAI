/**
 * Unit tests for platform detection + search URL building.
 * Pure functions, no network. Run: node --test dashboard/platform.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, searchUrlsFor, scoreMarkdown } from './platform.mjs';

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
  // Shopify check runs first; /collections/ is unambiguous Shopify.
  const md = '[a](https://x.co.il/collections/all) [b](https://x.co.il/product/x/)';
  assert.equal(detectPlatform(md), 'shopify');
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
  assert.ok(urls[0].includes('post_type=product')); // Woo first (most common)
  assert.ok(urls.some((u) => u.includes('/search?q=')));
});

test('searchUrlsFor: query is URL-encoded (no injection / spaces)', () => {
  const [url] = searchUrlsFor('https://x.co.il', 'aloe vera', 'woo');
  assert.ok(url.includes('aloe%20vera'));
});

test('scoreMarkdown: results page (prices + product links + query echo) beats homepage', () => {
  const resultsPage = '# תוצאות חיפוש עבור: נענע\n[נענע](https://x.co.il/product/mint/) ₪14';
  const homepageFallback = '[a](https://x.co.il/product/rose/) ₪20 ₪30 ₪40'; // more prices, no query
  assert.ok(scoreMarkdown(resultsPage, 'נענע') > scoreMarkdown(homepageFallback, 'נענע'));
});

test('scoreMarkdown: empty / null is zero', () => {
  assert.equal(scoreMarkdown('', 'mint'), 0);
  assert.equal(scoreMarkdown(null, 'mint'), 0);
});
