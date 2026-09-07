/*
 * Tests for structured price extraction.
 *
 * Two halves, and both matter:
 *
 *   Unit tests pin the behaviours that were wrong in an earlier draft and cost
 *   real accuracy - sale prices, currency requirements, the class-token filter.
 *   Each one names the shop that exposed it.
 *
 *   Fixture tests grade the reader against 28 hand-labelled real nursery pages
 *   (SCRAPE-ACCURACY-PLAN Phase 0). They assert the metric itself, so a change
 *   that improves one shop by breaking another cannot land quietly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceNumber,
  hasCurrency,
  availabilityFromText,
  parseJsonLdProducts,
  parseMicrodataProducts,
  parseMetaProduct,
  parseProductCards,
  extractStructuredProducts,
  formatPrice,
} from './structuredPrice.ts';
import { labelledFixtures, readFixture } from './fixtures.ts';

// --- price parsing ----------------------------------------------------------

test('parsePriceNumber reads the forms Israeli shops write', () => {
  assert.equal(parsePriceNumber('₪49.90'), 49.9);
  assert.equal(parsePriceNumber('1,499.90'), 1499.9);
  assert.equal(parsePriceNumber('&#8362;180'), 180);
  assert.equal(parsePriceNumber('49 ש"ח'), 49);
  assert.equal(parsePriceNumber(299), 299);
});

test('parsePriceNumber takes ONE number, never the digits of several', () => {
  /*
   * The al-haderech.co.il sale block: a struck-through original, WooCommerce's
   * screen-reader duplicate of it, then the real price. Stripping every
   * non-digit and parsing what was left produced 699.00699 - a number that
   * appears nowhere on the page - and quoted it to the user with confidence.
   */
  assert.equal(parsePriceNumber('₪699.00 המחיר המקורי היה: ₪699.00. ₪499.90'), 699);
  assert.equal(parsePriceNumber('₪499.90'), 499.9);
});

test('parsePriceNumber rejects what is not a price', () => {
  assert.equal(parsePriceNumber(''), null);
  assert.equal(parsePriceNumber(null), null);
  assert.equal(parsePriceNumber('אזל המלאי'), null);
  assert.equal(parsePriceNumber('₪0.00'), null); // an empty cart total
});

test('hasCurrency recognises every ILS spelling, entity form included', () => {
  for (const s of ['₪49', '49 ש"ח', '49 ש״ח', '49 שח', '49 NIS', 'ILS 49', '&#8362;49']) {
    assert.ok(hasCurrency(s), s);
  }
  assert.equal(hasCurrency('49'), false);
  // The bare word must not match inside ordinary Hebrew words.
  assert.equal(hasCurrency('שחור'), false);
});

test('availabilityFromText reads Hebrew stock wording', () => {
  assert.equal(availabilityFromText('אזל המלאי'), 'out_of_stock');
  assert.equal(availabilityFromText('הוסף לסל'), 'in_stock');
  assert.equal(availabilityFromText('מונסטרה יפה'), 'unknown');
});

// --- JSON-LD ----------------------------------------------------------------

test('parseJsonLdProducts reads a plain Product', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'מונסטרה',
    offers: { '@type': 'Offer', price: '129.90', priceCurrency: 'ILS', availability: 'https://schema.org/InStock' },
  })}</script>`;
  const [p] = parseJsonLdProducts(html);
  assert.equal(p.name, 'מונסטרה');
  assert.equal(p.price, 129.9);
  assert.equal(p.currency, 'ILS');
  assert.equal(p.availability, 'in_stock');
  assert.equal(p.source, 'jsonld');
});

test('parseJsonLdProducts walks @graph, arrays and ItemList', () => {
  // Three shapes schema.org allows for the same fact. Missing any one of them
  // is the difference between reading a shop's whole grid and reading none.
  const graph = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [{ '@type': 'Product', name: 'A', offers: { price: 10 } }],
  })}</script>`;
  const array = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Product', name: 'B', offers: { price: 20 } },
  ])}</script>`;
  const list = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ItemList',
    itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Product', name: 'C', offers: { price: 30 } } }],
  })}</script>`;
  assert.deepEqual(
    parseJsonLdProducts(graph + array + list).map((p) => [p.name, p.price]),
    [['A', 10], ['B', 20], ['C', 30]]
  );
});

test('parseJsonLdProducts survives one malformed block', () => {
  const html =
    '<script type="application/ld+json">{not json</script>' +
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'ok',
      offers: { price: 5 },
    })}</script>`;
  assert.equal(parseJsonLdProducts(html).length, 1);
});

test('parseJsonLdProducts takes an AggregateOffer low price', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name: 'variants',
    offers: { '@type': 'AggregateOffer', lowPrice: '39.00', highPrice: '99.00', priceCurrency: 'ILS' },
  })}</script>`;
  assert.equal(parseJsonLdProducts(html)[0].price, 39);
});

// --- microdata and meta -----------------------------------------------------

test('parseMicrodataProducts reads content attribute and text alike', () => {
  const html = `
    <div itemscope itemtype="http://schema.org/Product">
      <span itemprop="name">מונסטרה</span>
      <span itemprop="offers" itemscope itemtype="http://schema.org/Offer">
        <meta itemprop="price" content="88.50">
        <meta itemprop="priceCurrency" content="ILS">
      </span>
    </div>`;
  const [p] = parseMicrodataProducts(html);
  assert.equal(p.name, 'מונסטרה');
  assert.equal(p.price, 88.5);
  assert.equal(p.source, 'microdata');
});

test('parseMetaProduct reads og/product price tags', () => {
  const html = `
    <meta property="og:title" content="מונסטרה דליסיוזה">
    <meta property="product:price:amount" content="149.90">
    <meta property="product:price:currency" content="ILS">`;
  const p = parseMetaProduct(html);
  assert.equal(p?.price, 149.9);
  assert.equal(p?.name, 'מונסטרה דליסיוזה');
});

test('parseMetaProduct is null without a price', () => {
  assert.equal(parseMetaProduct('<meta property="og:title" content="חנות">'), null);
});

// --- product cards ----------------------------------------------------------

/* A WooCommerce grid cell, reduced to the parts that matter. */
const wooCard = (extra = '') => `
  <ul class="products">
    <li class="product type-product instock shipping-taxable purchasable product-type-simple">
      <a href="/items/monstera-monkey" class="woocommerce-LoopProduct-link">
        <img src="x.jpg" alt="">
        <h2 class="woocommerce-loop-product__title">מונסטרה מאנקי</h2>
        <span class="price">${extra || '<span class="amount"><bdi>&#8362;180</bdi></span>'}</span>
      </a>
    </li>
  </ul>`;

test('parseProductCards pairs a name with the price in its own card', () => {
  const [p] = parseProductCards(wooCard(), 'https://h-shtilshop.co.il/');
  assert.equal(p.name, 'מונסטרה מאנקי');
  assert.equal(p.price, 180);
  assert.equal(p.url, 'https://h-shtilshop.co.il/items/monstera-monkey');
  assert.equal(p.source, 'card');
});

test('parseProductCards quotes the sale price, not the struck-through one', () => {
  // al-haderech.co.il. The pre-sale price comes FIRST in the DOM, so any
  // "first price wins" rule quotes ₪699 for a plant the shop sells at ₪499.90.
  const sale = `
    <del aria-hidden="true"><span class="amount"><bdi>&#8362;699.00</bdi></span></del>
    <span class="screen-reader-text">המחיר המקורי היה: &#8362;699.00.</span>
    <ins aria-hidden="true"><span class="amount"><bdi>&#8362;499.90</bdi></span></ins>
    <span class="screen-reader-text">המחיר הנוכחי הוא: &#8362;499.90.</span>`;
  const [p] = parseProductCards(wooCard(sale));
  assert.equal(p.price, 499.9);
});

test('parseProductCards finds products whose URLs are not /product/', () => {
  /*
   * al-haderech.co.il links its products at /items/{slug}. The existing
   * PRODUCT_LINK_RE whitelist (/products?/, /product-page/, ...) does not match
   * it, so any reader keyed on the URL shape reads that shop's entire grid as
   * zero products. Detection climbs from the price instead, for this reason.
   */
  const [p] = parseProductCards(wooCard());
  assert.ok(p, 'a /items/ product must still be found');
});

test('parseProductCards is not fooled by class-name substrings', () => {
  // The card above carries `shipping-taxable`. Filtering chrome by substring
  // match on "shipping" threw away every product on h-shtilshop.co.il.
  assert.equal(parseProductCards(wooCard()).length, 1);
});

test('parseProductCards ignores the cart total and the shipping notice', () => {
  const chrome = `
    <div class="header-cart"><a href="/cart">עגלת קניות <span class="amount">&#8362;0.00</span></a></div>
    <div class="widget_price_filter"><span class="price">&#8362;0 — &#8362;900</span></div>
    <p class="free-shipping">החל מ-<span class="amount">&#8362;500</span> משלוח חינם</p>`;
  assert.deepEqual(parseProductCards(chrome), []);
});

test('parseProductCards requires a currency, so ratings are not prices', () => {
  const html = `
    <li class="product">
      <a href="/products/x"><h2>מונסטרה</h2></a>
      <span class="rating amount">4.8</span>
    </li>`;
  assert.deepEqual(parseProductCards(html), []);
});

test('parseProductCards keeps two products apart', () => {
  const html = `
    <ul class="products">
      <li class="product"><a href="/products/a"><h2>אלוקזיה</h2><span class="price">&#8362;100</span></a></li>
      <li class="product"><a href="/products/b"><h2>פותוס</h2><span class="price">&#8362;200</span></a></li>
    </ul>`;
  assert.deepEqual(
    parseProductCards(html).map((p) => [p.name, p.price]),
    [['אלוקזיה', 100], ['פותוס', 200]]
  );
});

// --- the union --------------------------------------------------------------

test('extractStructuredProducts prefers JSON-LD and de-dupes the grid copy', () => {
  const html =
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'מונסטרה מאנקי',
      url: 'https://h-shtilshop.co.il/items/monstera-monkey',
      offers: { price: '180', priceCurrency: 'ILS' },
    })}</script>` + wooCard();
  const found = extractStructuredProducts(html, 'https://h-shtilshop.co.il/');
  assert.equal(found.length, 1);
  assert.equal(found[0].source, 'jsonld');
});

test('extractStructuredProducts falls back to meta only when nothing richer exists', () => {
  const html = `
    <meta property="og:title" content="מונסטרה דליסיוזה">
    <meta property="product:price:amount" content="149.90">`;
  assert.equal(extractStructuredProducts(html)[0].source, 'meta');
});

test('extractStructuredProducts is empty for an empty page', () => {
  assert.deepEqual(extractStructuredProducts(''), []);
  assert.deepEqual(extractStructuredProducts('<html><body><p>שלום</p></body></html>'), []);
});

test('formatPrice writes prices the way the pipeline does', () => {
  assert.equal(formatPrice({ price: 180 } as never), '₪180');
  assert.equal(formatPrice({ price: 499.9 } as never), '₪499.90');
});

// --- the fixtures (Phase 0 metric) ------------------------------------------

test('every labelled fixture is read correctly', () => {
  const fixtures = labelledFixtures();
  assert.ok(fixtures.length >= 28, `expected the captured golden set, got ${fixtures.length}`);

  const misses: string[] = [];
  const falsePositives: string[] = [];

  for (const f of fixtures) {
    const html = readFixture(f.htmlFile);
    const found = extractStructuredProducts(html, f.url ?? '');
    const where = `${f.host} ${f.slug}`;
    if (f.pricedProducts! > 0 && found.length === 0) misses.push(where);
    /*
     * A price invented on a page with no results is the worse failure: it puts
     * a shop in front of the user that does not sell the plant at all.
     */
    if (f.pricedProducts === 0 && found.length > 0) {
      falsePositives.push(`${where} (${found.length}: ${found[0].name} ${found[0].price})`);
    }
  }

  assert.deepEqual(misses, [], 'pages with products that we failed to read');
  assert.deepEqual(falsePositives, [], 'prices invented on pages with no products');
});

test('hand-verified prices come back exactly', () => {
  for (const f of labelledFixtures()) {
    if (!f.sample) continue;
    const found = extractStructuredProducts(readFixture(f.htmlFile), f.url ?? '');
    const hit = found.find((p) => p.name.includes(f.sample!.name));
    assert.ok(hit, `${f.host} ${f.slug}: "${f.sample.name}" not extracted`);
    assert.equal(hit.price, f.sample.price, `${f.host} ${f.slug}: wrong price for ${f.sample.name}`);
  }
});

test('a grid is read at close to its real size', () => {
  /*
   * Recall, not just presence. Reading one product off a 28-product page would
   * pass the test above while still losing the shop's cheapest listing, which
   * is the one the app quotes.
   */
  for (const f of labelledFixtures()) {
    if ((f.pricedProducts ?? 0) < 2) continue;
    const found = extractStructuredProducts(readFixture(f.htmlFile), f.url ?? '');
    assert.ok(
      found.length >= f.pricedProducts! * 0.9,
      `${f.host} ${f.slug}: read ${found.length} of ${f.pricedProducts} products`
    );
  }
});
