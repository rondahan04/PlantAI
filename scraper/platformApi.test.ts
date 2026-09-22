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
  probeApiRouteDetailed,
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

/*
 * netaplants.co.il sells every plant in several pot sizes, so every row is a
 * variable product priced "0" with the real numbers in `price_range`. Reading
 * `price` alone made a full catalogue look like an empty one - each row priced
 * zero and dropped by the guard below.
 */
test('a variable product is priced from its range, not dropped as free', () => {
  const row = wooRow({
    prices: {
      price: '0',
      currency_minor_unit: 2,
      price_range: { min_amount: '4200', max_amount: '49800' },
    },
  });
  assert.equal(wooProduct(row, ORIGIN)!.price, 42);
});

test('a stated price still outranks the range it sits in', () => {
  const row = wooRow({
    prices: {
      price: '5500',
      currency_minor_unit: 2,
      price_range: { min_amount: '4200', max_amount: '49800' },
    },
  });
  assert.equal(wooProduct(row, ORIGIN)!.price, 55);
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

/*
 * The truncated shelf, one level up from WOO_DEFAULT_PER_PAGE.
 *
 * per_page is capped at 100 by the Store API, so a shop with more than 100
 * products matching the genus answers with a full page and says nothing about
 * the rest - and the cultivar we were sent for is simply missing from the
 * response. The shop then looks like it stocks every Ficus except the one asked
 * for, which is the confident wrong absence this whole module exists to avoid.
 */
test('a full Woo page means the shelf may be longer, so paging continues', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => wooRow({ name: `פיקוס ${i}` }));
  const page2 = [wooRow({ name: 'פיקוס ליראטה' })];
  const seen: string[] = [];
  const res = await wooStoreSearch(ORIGIN, 'פיקוס', {
    fetchImpl: (async (url: string) => {
      seen.push(url);
      const body = url.includes('page=2') ? page2 : page1;
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }) as any,
  });
  assert.equal(res.products.length, 101);
  assert.equal(res.complete, true);
  assert.ok(seen.some((u) => u.includes('page=2')));
  assert.ok(res.products.some((p) => p.name === 'פיקוס ליראטה'));
});

test('a shelf that fits in one page still costs exactly one request', async () => {
  const seen: string[] = [];
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', {
    fetchImpl: (async (url: string) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify([wooRow()]) };
    }) as any,
  });
  assert.equal(seen.length, 1);
  assert.equal(res.complete, true);
  assert.equal(res.products.length, 1);
});

test('a Woo shelf cut off at the page cap is NOT complete, so absence proves nothing', async () => {
  const full = Array.from({ length: 100 }, (_, i) => wooRow({ name: `פיקוס ${i}` }));
  const res = await wooStoreSearch(ORIGIN, 'פיקוס', {
    maxPages: 2,
    fetchImpl: (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(full),
    })) as any,
  });
  assert.equal(res.complete, false);
  assert.equal(res.products.length, 200);
});

test('a later Woo page failing narrows the shelf rather than erasing it', async () => {
  const full = Array.from({ length: 100 }, (_, i) => wooRow({ name: `פיקוס ${i}` }));
  const res = await wooStoreSearch(ORIGIN, 'פיקוס', {
    fetchImpl: (async (url: string) =>
      url.includes('page=2')
        ? { ok: false, status: 500, text: async () => 'boom' }
        : { ok: true, status: 200, text: async () => JSON.stringify(full) }) as any,
  });
  assert.equal(res.products.length, 100);
  assert.equal(res.complete, false);
});

test('page one failing is still a route that does not answer', async () => {
  const res = await wooStoreSearch(ORIGIN, 'פיקוס', {
    fetchImpl: (async () => ({ ok: false, status: 404, text: async () => 'nope' })) as any,
  });
  assert.equal(res.products.length, 0);
  assert.equal(res.status, 404);
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

/*
 * Page 1 alone, then batches. A cold Render process re-downloads a Shopify
 * catalogue from scratch, on the user's search, so 8 serial quarter-megabyte
 * round trips are latency the user pays - and a shop whose whole catalogue fits
 * in one page must not pay for the other seven to find that out.
 */
test('page one is read alone, and the rest are read together', async () => {
  const full = (n: number) => ({
    products: Array.from({ length: SHOPIFY_PAGE_SIZE }, (_, i) => shopifyRow({ handle: `p${n}-${i}` })),
  });
  /* When a batch is in flight, every request in it starts before any settles. */
  let inFlight = 0;
  let widest = 0;
  const res = await shopifyCatalogue('https://decogarden.co.il', {
    maxPages: 8,
    fetchImpl: (async (url: string) => {
      inFlight += 1;
      widest = Math.max(widest, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      const page = Number(/page=(\d+)/.exec(url)?.[1] ?? '1');
      const body = page >= 5 ? { products: [shopifyRow({ handle: 'last' })] } : full(page);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    }) as any,
  });
  assert.equal(widest, 3, 'pages after the first are requested together');
  /* 4 full pages plus the short one that ended it. */
  assert.equal(res.products.length, SHOPIFY_PAGE_SIZE * 4 + 1);
  assert.equal(res.complete, true);
});

test('a batch is consumed in page order, so a gap cannot be read as a catalogue', async () => {
  const full = { products: Array.from({ length: SHOPIFY_PAGE_SIZE }, (_, i) => shopifyRow({ handle: `p${i}` })) };
  const res = await shopifyCatalogue('https://decogarden.co.il', {
    maxPages: 8,
    fetchImpl: (async (url: string) => {
      const page = Number(/page=(\d+)/.exec(url)?.[1] ?? '1');
      /* Page 3 fails while page 4 answers. Taking 4 anyway would report a
       * catalogue with a hole in it as though it were contiguous. */
      if (page === 3) return { ok: false, status: 503, text: async () => 'down' };
      return { ok: true, status: 200, text: async () => JSON.stringify(full) };
    }) as any,
  });
  assert.equal(res.products.length, SHOPIFY_PAGE_SIZE * 2, 'stops at the gap, keeps pages 1-2');
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

// --- the second way in ------------------------------------------------------

/*
 * plantit.co.il and peer-nursery.co.il answer a home connection and refuse a
 * datacenter one, and the API host runs in a datacenter. The rescue is the same
 * request made from somewhere the shop will answer.
 */
function countingFetch(inner: any) {
  const urls: string[] = [];
  const fn = async (url: string, init?: unknown) => {
    urls.push(url);
    return inner(url, init);
  };
  return { fn: fn as any, urls };
}

test('a refused Store API read is asked again the second way, and says so', async () => {
  const direct = fakeFetch({ '/wp-json/wc/store/v1/products': { status: 403, body: 'Forbidden' } });
  const rescue = countingFetch(fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow()] } }));
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', { fetchImpl: direct, rescue: rescue.fn });
  assert.equal(res.products.length, 1);
  assert.equal(res.status, 200);
  assert.equal(res.rescued, true);
  assert.equal(rescue.urls.length, 1);
});

test('a read that never completed is rescued too', async () => {
  const direct = async () => {
    throw new Error('The operation was aborted due to timeout');
  };
  const rescue = fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow()] } });
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', { fetchImpl: direct as any, rescue });
  assert.equal(res.products.length, 1);
  assert.equal(res.rescued, true);
});

test('a bot wall served as a 200 page is a refusal, not an empty shelf', async () => {
  const wall = '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script></html>';
  const direct = fakeFetch({ '/wp-json/wc/store/v1/products': { body: wall } });
  const rescue = fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow()] } });
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', { fetchImpl: direct, rescue });
  assert.equal(res.products.length, 1);
});

test('a 404 is the shop answering, and is not asked twice', async () => {
  const rescue = countingFetch(fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow()] } }));
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', { fetchImpl: fakeFetch({}), rescue: rescue.fn });
  assert.equal(res.status, 404);
  assert.equal(res.products.length, 0);
  assert.equal(rescue.urls.length, 0);
});

test('a read that answers the first time never touches the rescue', async () => {
  const rescue = countingFetch(fakeFetch({}));
  const direct = fakeFetch({ '/wp-json/wc/store/v1/products': { body: [wooRow()] } });
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', { fetchImpl: direct, rescue: rescue.fn });
  assert.equal(res.rescued, false);
  assert.equal(rescue.urls.length, 0);
});

/*
 * 'none' is remembered for a week. A shop that answered nothing at all has not
 * told us it has no JSON, and must not lose its fastest route over one refusal.
 */
test('a probe nobody answered is not a definitive "none"', async () => {
  const silent = async () => {
    throw new Error('timeout');
  };
  const res = await probeApiRouteDetailed(ORIGIN, { fetchImpl: silent as any });
  assert.equal(res.route, 'none');
  assert.equal(res.definitive, false);
});

test('a probe the shop answered with 404s is a definitive "none"', async () => {
  const res = await probeApiRouteDetailed(ORIGIN, { fetchImpl: fakeFetch({}) });
  assert.equal(res.route, 'none');
  assert.equal(res.definitive, true);
});

test('a refused probe is rescued, and names the Woo route it found', async () => {
  const direct = fakeFetch({
    '/wp-json/': { status: 403, body: 'Forbidden' },
    '/products.json': { status: 403, body: 'Forbidden' },
  });
  const rescue = fakeFetch({ '/wp-json/wc/store/v1/products': { body: [] } });
  const res = await probeApiRouteDetailed(ORIGIN, { fetchImpl: direct, rescue });
  assert.deepEqual(res, { route: 'woo-store', definitive: true, rescued: true });
});

/*
 * The rescue path reads the body back out of a browser page, which strips the
 * HTML tags inside the description strings and breaks the JSON. Asking for the
 * four fields we map keeps HTML out of the payload entirely.
 */
test('the Store API is asked for only the fields we map', () => {
  const url = new URL(wooSearchUrl(ORIGIN, 'מונסטרה'));
  assert.equal(url.searchParams.get('_fields'), 'name,permalink,prices,is_in_stock');
  assert.equal(url.searchParams.get('search'), 'מונסטרה');
});

test('a bot wall served as a 200 page reads as a refusal, not an empty shelf', async () => {
  const wall = '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x.js"></script></html>';
  const res = await wooStoreSearch(ORIGIN, 'אלוקסיה', {
    fetchImpl: fakeFetch({ '/wp-json/wc/store/v1/products': { body: wall } }),
  });
  assert.equal(res.status, 403);
  assert.equal(res.products.length, 0);
});
