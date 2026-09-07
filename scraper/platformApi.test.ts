/*
 * Tests for the platform-native product APIs.
 *
 * The payload shapes below are trimmed copies of real responses captured from
 * al-haderech.co.il (Woo) and rootine.co.il / decogarden.co.il (Shopify), so
 * the field quirks under test are the shops' quirks and not invented ones.
 *
 * The one that would hurt most if it regressed is the minor-unit conversion:
 * Woo sends ₪599.90 as the string "59990", and reading that as a plain number
 * quotes every plant at a hundred times its price. A missing price is a gap; a
 * confidently wrong one is a lie.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities,
  cleanName,
  wooProduct,
  shopifyProduct,
  wooStoreSearch,
  shopifyCatalogue,
  probeApiRoute,
  routeForPlatform,
  wooSearchUrl,
  shopifyPageUrl,
  SHOPIFY_PAGE_SIZE,
} from './platformApi.ts';

const ORIGIN = 'https://al-haderech.co.il';

/* A fetch that answers from a table, so no test touches the network. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown | string }>): any {
  return async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, text: async () => 'not found' };
    const { status = 200, body } = routes[key];
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

const wooRow = (over: Record<string, unknown> = {}) => ({
  name: 'אלוקסיה זברינה',
  permalink: 'https://al-haderech.co.il/items/alocasia-zebrina/',
  is_in_stock: true,
  prices: { price: '59990', currency_code: 'ILS', currency_minor_unit: 2 },
  ...over,
});

// --- entities ---------------------------------------------------------------

test('WordPress product names arrive with entities still in them', () => {
  // The literal name al-haderech's live Store API returns.
  assert.equal(
    cleanName('מבצע אלוקסיה סביריאן טייגר ע&#8217; 9'),
    'מבצע אלוקסיה סביריאן טייגר ע’ 9'
  );
  assert.equal(decodeEntities('עציץ אלוקסיה ונטי &#8211; אוזן'), 'עציץ אלוקסיה ונטי – אוזן');
  assert.equal(decodeEntities('Ficus &amp; Co &lt;3'), 'Ficus & Co <3');
});

test('an unknown or malformed entity is left alone rather than eating the name', () => {
  assert.equal(decodeEntities('&notareal; plant'), '&notareal; plant');
  assert.equal(decodeEntities('&#999999999;plant'), 'plant');
});

// --- WooCommerce ------------------------------------------------------------

test('Woo prices are minor units - "59990" at minor_unit 2 is ₪599.90', () => {
  assert.equal(wooProduct(wooRow(), ORIGIN)!.price, 599.9);
});

test('a shop that deviates and sends decimals is believed over its own minor_unit', () => {
  // Dividing "599.90" by 100 would be the same hundredfold error, downward.
  assert.equal(wooProduct(wooRow({ prices: { price: '599.90', currency_minor_unit: 2 } }), ORIGIN)!.price, 599.9);
});

test('the Store API always states stock, so this route never answers unknown', () => {
  assert.equal(wooProduct(wooRow(), ORIGIN)!.availability, 'in_stock');
  assert.equal(wooProduct(wooRow({ is_in_stock: false }), ORIGIN)!.availability, 'out_of_stock');
});

test('a row with no usable price is dropped, not priced at zero', () => {
  assert.equal(wooProduct(wooRow({ prices: { price: '0', currency_minor_unit: 2 } }), ORIGIN), null);
  assert.equal(wooProduct(wooRow({ name: '  ' }), ORIGIN), null);
});

test('a Woo search maps the shelf and reports that the SERVER did the filtering', async () => {
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', {
    fetchImpl: fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow(), wooRow({ name: 'אלוקסיה פולי' })] } }),
  });
  assert.equal(res.products.length, 2);
  assert.equal(res.route, 'woo-store');
  assert.equal(res.filteredByServer, true);
  assert.equal(res.products[0].source, 'api');
});

test('the search term is encoded, so Hebrew and spaces survive the URL', () => {
  const url = wooSearchUrl(ORIGIN, 'אלוקסיה ריגל שילד');
  assert.ok(url.includes('search=%D7%90'));
  assert.ok(!url.includes(' '));
});

// --- Shopify ----------------------------------------------------------------

const shopifyRow = (over: Record<string, unknown> = {}) => ({
  title: 'אלוקסיה ריגל שילד 10 ליטר',
  handle: 'alocasia-regal-shield',
  variants: [{ price: '249.00', available: true }],
  ...over,
});

test('Shopify prices are already major units', () => {
  assert.equal(shopifyProduct(shopifyRow(), 'https://decogarden.co.il')!.price, 249);
});

test('the cheapest variant is quoted - a plant sold in three pot sizes has three prices', () => {
  const p = shopifyProduct(
    shopifyRow({
      variants: [
        { price: '499.00', available: true },
        { price: '199.00', available: true },
        { price: '299.00', available: false },
      ],
    }),
    'https://decogarden.co.il'
  );
  assert.equal(p!.price, 199);
});

test('a product is buyable if ANY variant is', () => {
  const sold = shopifyProduct(
    shopifyRow({ variants: [{ price: '10.00', available: false }, { price: '20.00', available: false }] }),
    'https://decogarden.co.il'
  );
  assert.equal(sold!.availability, 'out_of_stock');
});

test('the product URL is built from the handle', () => {
  assert.equal(
    shopifyProduct(shopifyRow(), 'https://decogarden.co.il')!.url,
    'https://decogarden.co.il/products/alocasia-regal-shield'
  );
});

test('a full page means there may be more, so paging continues', async () => {
  const page1 = { products: Array.from({ length: SHOPIFY_PAGE_SIZE }, (_, i) => shopifyRow({ handle: `p${i}` })) };
  const page2 = { products: [shopifyRow({ handle: 'last' })] };
  const res = await shopifyCatalogue('https://decogarden.co.il', {
    fetchImpl: fakeFetch({ 'page=1': { body: page1 }, 'page=2': { body: page2 } }),
  });
  assert.equal(res.products.length, SHOPIFY_PAGE_SIZE + 1);
  assert.equal(res.complete, true);
  /* Nothing applied the query - the filtering is ours, and the caller has to
   * know that before it treats an absence as proof. */
  assert.equal(res.filteredByServer, false);
});

test('a catalogue cut off at the page cap is NOT complete, so absence proves nothing', async () => {
  const full = { products: Array.from({ length: SHOPIFY_PAGE_SIZE }, (_, i) => shopifyRow({ handle: `p${i}` })) };
  const res = await shopifyCatalogue('https://decogarden.co.il', {
    maxPages: 2,
    fetchImpl: fakeFetch({ '/products.json': { body: full } }),
  });
  assert.equal(res.complete, false);
});

test('page one failing means there is no catalogue at all', async () => {
  const res = await shopifyCatalogue('https://getzler.co.il', {
    fetchImpl: fakeFetch({ '/products.json': { status: 404, body: '<!DOCTYPE html>' } }),
  });
  assert.deepEqual(res.products, []);
  assert.equal(res.status, 404);
});

// --- probing and failure ----------------------------------------------------

test('an array from the Store API proves WooCommerce, whatever we remembered', async () => {
  // peer-nursery.co.il is cached as shopify and is in fact a Woo shop.
  const route = await probeApiRoute('https://www.peer-nursery.co.il', {
    fetchImpl: fakeFetch({
      '/wp-json/': { body: [] },
      '/products.json': { status: 404, body: '<!DOCTYPE html>' },
    }),
  });
  assert.equal(route, 'woo-store');
});

test('a WordPress site without WooCommerce is not a Woo shop', async () => {
  // getzler.co.il answers rest_no_route on one and 404 HTML on the other.
  const route = await probeApiRoute('https://getzler.co.il', {
    fetchImpl: fakeFetch({
      '/wp-json/': { status: 404, body: { code: 'rest_no_route' } },
      '/products.json': { status: 404, body: '<!DOCTYPE html>' },
    }),
  });
  assert.equal(route, 'none');
});

test('a 200 that is really an HTML error page is not an API', async () => {
  // Some shops answer 200 with their 404 page, so the status alone proves nothing.
  const res = await wooStoreSearch(ORIGIN, 'x', {
    fetchImpl: fakeFetch({ '/wp-json/': { status: 200, body: '<!DOCTYPE html><html>' } }),
  });
  assert.deepEqual(res.products, []);
});

test('nothing here throws - there is always a slower route that still works', async () => {
  const boom: any = async () => {
    throw new Error('ECONNRESET');
  };
  const woo = await wooStoreSearch(ORIGIN, 'x', { fetchImpl: boom });
  const shop = await shopifyCatalogue(ORIGIN, { fetchImpl: boom });
  assert.equal(woo.status, 0);
  assert.equal(shop.status, 0);
  assert.equal(await probeApiRoute(ORIGIN, { fetchImpl: boom }), 'none');
});

test('a known platform implies its route without paying for a probe', () => {
  assert.equal(routeForPlatform('woo'), 'woo-store');
  assert.equal(routeForPlatform('shopify'), 'shopify-json');
  assert.equal(routeForPlatform('wix'), null);
  assert.equal(routeForPlatform('unknown'), null);
});

test('page URLs are built the way the endpoints expect', () => {
  assert.equal(shopifyPageUrl('https://x.co.il/', 2), 'https://x.co.il/products.json?limit=250&page=2');
});
