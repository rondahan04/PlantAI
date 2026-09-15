/*
 * Run: node --test scraper/productFollow.test.ts
 *
 * Fixtures are today's live mashtela-urbanit HTML, captured 2026-09-15:
 *   __monstera-search.html.gz   the Joomla search page - product links, no prices
 *   __monstera-product.html.gz  one product page - `<span class="PricesalesPrice">49 ₪`
 * Nothing here touches the network; the fetcher and the extractor are injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as zlib from 'zlib';

import { productLinks, followProductPages, PRODUCT_FOLLOW_MAX } from './productFollow.ts';
import { buildQueryPlan } from './queryPlan.ts';

/* import.meta rather than __dirname: `npm test` is `node --test`, which runs
 * these as ESM. See the note in tsconfig.node.json. */
const readFixture = (name: string): string =>
  zlib.gunzipSync(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString('utf8');

const SEARCH_HTML = readFixture('mashtela-urbanit.co.il__monstera-search.html.gz');
const PRODUCT_HTML = readFixture('mashtela-urbanit.co.il__monstera-product.html.gz');
const BASE = 'https://mashtela-urbanit.co.il/component/search/?searchword=monstera';

/* The plan a monstera search actually carries. */
const monsteraPlan = buildQueryPlan({
  original: 'Monstera deliciosa',
  hebrew: 'מונסטרה דליסיוסה',
  latin: 'Monstera deliciosa',
});

// --- productLinks (pure) ----------------------------------------------------

test('the product links on a price-less search page are found', () => {
  const links = productLinks(SEARCH_HTML, BASE, monsteraPlan);
  assert.ok(links.length > 0, 'expected at least one monstera product link');
  assert.ok(
    links.every((l) => /^https:\/\/mashtela-urbanit\.co\.il\//.test(l.url)),
    'every link is absolute and same-origin'
  );
});

test('the monstera product page is among them, and the cart and nav are not', () => {
  const links = productLinks(SEARCH_HTML, BASE, monsteraPlan);
  const urls = links.map((l) => decodeURIComponent(l.url));
  assert.ok(
    urls.some((u) => u.includes('מונסטרה-detail')),
    `expected the monstera product page, got:\n${urls.join('\n')}`
  );
  assert.ok(
    !urls.some((u) => /\/register|\/faq|\/contect|\/הסל|wa\.me|instagram/.test(u)),
    'nav, cart and social links are not products'
  );
});

test('a link whose text does not name the plant is not followed', () => {
  const html = `
    <a href="/catalog/soil/תערובת-שתילה-detail">תערובת שתילה</a>
    <a href="/catalog/home-office/מונסטרה-detail">מונסטרה</a>`;
  const urls = productLinks(html, 'https://shop.example/search', monsteraPlan).map((l) =>
    decodeURIComponent(l.url)
  );
  assert.deepEqual(urls, ['https://shop.example/catalog/home-office/מונסטרה-detail']);
});

test('the same product linked twice is followed once', () => {
  const html = `
    <a href="/p/מונסטרה-detail"><img src="x.png"></a>
    <a href="/p/מונסטרה-detail">מונסטרה דליסיוסה</a>`;
  const links = productLinks(html, 'https://shop.example/search', monsteraPlan);
  assert.equal(links.length, 1);
  /* The anchor that names the plant wins - an image link has no title to show. */
  assert.equal(links[0].name, 'מונסטרה דליסיוסה');
});

test('an off-site link is never followed', () => {
  const html = `<a href="https://other-shop.example/מונסטרה-detail">מונסטרה</a>`;
  assert.deepEqual(productLinks(html, 'https://shop.example/search', monsteraPlan), []);
});

test('the follow is capped, however many products match', () => {
  const html = Array.from(
    { length: 20 },
    (_, i) => `<a href="/p/monstera-${i}-detail">מונסטרה ${i}</a>`
  ).join('\n');
  const links = productLinks(html, 'https://shop.example/search', monsteraPlan);
  assert.equal(links.length, PRODUCT_FOLLOW_MAX);
});

test('a page with no anchors at all yields nothing rather than throwing', () => {
  assert.deepEqual(productLinks('', BASE, monsteraPlan), []);
  assert.deepEqual(productLinks('<html><body>no links</body></html>', BASE, monsteraPlan), []);
});

test("the free-shipping banner is not a catalogue price, so the page is still followed", () => {
  /*
   * Measured live 2026-09-15: mashtela's search page carries exactly one ₪ -
   * "משלוחים חינם בקנייה מעל 350 ₪" - so a rescue gated on "this page prices
   * nothing" never fired on the one page it was written for. A banner, a cart
   * total and a phone number all read as prices; the count cannot tell a priced
   * catalogue from a priceless one, and the link text is what can.
   */
  const html = `
    <div>משלוחים חינם בקנייה מעל 350 ₪ בתל אביב בלבד</div>
    <a href="/catalog/home-office/מונסטרה-detail">מונסטרה דליסיוסה</a>`;
  const links = productLinks(html, 'https://shop.example/search', monsteraPlan);
  assert.equal(links.length, 1);
});

// --- followProductPages (injected fetch + extract) ---------------------------

const okExtract = async () => ({
  plants: [{ name: 'מונסטרה', price: '49 ₪', availability: 'unknown' as const }],
  report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
  engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'none' as const },
  funnel: { stage: 'ok' as const, mdChars: 0, excerptChars: 0, extracted: 1, kept: 1, prices: 1 },
});

test('a followed product page turns a price-less shop into a priced row', async () => {
  const fetched: string[] = [];
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://mashtela-urbanit.co.il/p/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'mashtela-urbanit.co.il',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async (u) => {
      fetched.push(u);
      return PRODUCT_HTML;
    },
    extract: okExtract,
  });
  assert.deepEqual(fetched, ['https://mashtela-urbanit.co.il/p/monstera-detail']);
  assert.equal(out.plants.length, 1);
  assert.equal(out.plants[0].price, '49 ₪');
});

test('the row carries the product page it was priced from, not the search page', async () => {
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://mashtela-urbanit.co.il/p/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'mashtela-urbanit.co.il',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async () => PRODUCT_HTML,
    extract: okExtract,
  });
  assert.equal(out.plants[0].url, 'https://mashtela-urbanit.co.il/p/monstera-detail');
});

test('a product page that will not load costs the others nothing', async () => {
  const out = await followProductPages({
    links: [
      { name: 'a', url: 'https://shop.example/a-detail' },
      { name: 'b', url: 'https://shop.example/b-detail' },
    ],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async (u) => {
      if (u.endsWith('a-detail')) throw new Error('ECONNRESET');
      return PRODUCT_HTML;
    },
    extract: okExtract,
  });
  assert.equal(out.plants.length, 1, 'the reachable product still priced');
  assert.equal(out.followed, 2);
  assert.equal(out.priced, 1);
});

test('a product page the extractor cannot price yields no row rather than a bare name', async () => {
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://shop.example/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async () => '<html><body>no price here</body></html>',
    extract: async () => ({
      plants: [],
      report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
      engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'none' as const },
      funnel: { stage: 'no_match' as const, mdChars: 0, excerptChars: 0, extracted: 0, kept: 0, prices: 0 },
    }),
  });
  assert.deepEqual(out.plants, []);
  assert.equal(out.priced, 0);
});

test('an extractor that throws does not fail the shop', async () => {
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://shop.example/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async () => PRODUCT_HTML,
    extract: async () => {
      throw new Error('openai 500');
    },
  });
  assert.deepEqual(out.plants, []);
  assert.equal(out.followed, 1);
});

test('two variants both priced come back cheapest-comparable, not merged', async () => {
  const prices: Record<string, string> = {
    'https://shop.example/a-detail': '49 ₪',
    'https://shop.example/b-detail': '120 ₪',
  };
  const out = await followProductPages({
    links: [
      { name: 'מונסטרה', url: 'https://shop.example/a-detail' },
      { name: 'מונסטרה מאנקי', url: 'https://shop.example/b-detail' },
    ],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async () => PRODUCT_HTML,
    extract: async (opts) => ({
      plants: [
        { name: 'מונסטרה', price: prices[opts.url ?? ''] ?? '0 ₪', availability: 'unknown' as const },
      ],
      report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
      engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'none' as const },
      funnel: { stage: 'ok' as const, mdChars: 0, excerptChars: 0, extracted: 1, kept: 1, prices: 1 },
    }),
  });
  assert.equal(out.plants.length, 2);
  assert.deepEqual(
    out.plants.map((p) => p.price).sort(),
    ['120 ₪', '49 ₪']
  );
});

test('a follow that runs long is abandoned, and the shop keeps what it had', async () => {
  /*
   * The follow spends its fetches and model calls INSIDE the pipeline's 45s
   * per-site budget, so an unbounded rescue can cost a shop the read it would
   * otherwise have had. Measured across a live fan-out, timeouts went 1 -> 3
   * when the follow was unbounded. Losing the rescue is the acceptable failure;
   * losing the site is not.
   */
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://shop.example/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    budgetMs: 20,
    fetchProductHtml: () => new Promise((resolve) => setTimeout(() => resolve(PRODUCT_HTML), 200)),
    extract: okExtract,
  });
  assert.deepEqual(out.plants, []);
  assert.equal(out.timedOut, true);
});

test('a follow that finishes inside its budget is not reported as abandoned', async () => {
  const out = await followProductPages({
    links: [{ name: 'מונסטרה', url: 'https://shop.example/monstera-detail' }],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    budgetMs: 5_000,
    fetchProductHtml: async () => PRODUCT_HTML,
    extract: okExtract,
  });
  assert.equal(out.timedOut, false);
  assert.equal(out.plants.length, 1);
});

test('no links means no fetches and no model calls', async () => {
  let calls = 0;
  const out = await followProductPages({
    links: [],
    query: 'Monstera deliciosa',
    site: 'shop.example',
    openaiKey: 'k',
    plan: monsteraPlan,
    fetchProductHtml: async () => {
      calls++;
      return PRODUCT_HTML;
    },
    extract: okExtract,
  });
  assert.equal(calls, 0);
  assert.deepEqual(out.plants, []);
  assert.equal(out.followed, 0);
});
