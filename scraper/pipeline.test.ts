/**
 * Unit tests for runNurserySearch. No network - every dependency is injected.
 * Run: node --test scraper/pipeline.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNurserySearch, parsePrice, cheapestMatch, type PipelineDeps } from './pipeline.ts';
import type { ExtractFunnel, Plant } from './core.ts';

/* runNurserySearch reads only `plants`; the rest of PipelineResult is padding
 * these fixtures have to carry to satisfy the type. */
const funnel = (over: Partial<ExtractFunnel> = {}): ExtractFunnel => ({
  stage: 'ok',
  mdChars: 0,
  excerptChars: 0,
  extracted: 0,
  kept: 0,
  ...over,
});

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    discover: async () => [
      {
        name: 'Green House',
        website: 'https://gh.example/',
        lat: 32.1,
        lng: 34.8,
        address: '1 Sokolov St',
        rating: 4.7,
        reviewCount: 143,
        hours: 'Sun 9-19',
        phone: '03-1',
        photoName: 'places/A/photos/B',
      },
    ],
    search: async () => ({ md: 'PRODUCT monstera ₪175', platform: 'shopify', picked: 'u' }),
    extract: async () => ({
      plants: [{ name: 'Monstera', price: '₪175', availability: 'in_stock' }],
      report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
      engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
      funnel: funnel(),
    }),
    scrapeHome: async () => 'homepage text',
    infer: async () => ({ confidence: 0, reasoning: '' }),
    resolvePhoto: async () => 'https://lh3.googleusercontent.com/x',
    readFallbackUrls: () => [],
    nationalUrls: [],
    ...over,
  };
}

test('assembles a NurseryResult from Places identity + scraper price', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps()
  );
  assert.equal(out.length, 1);
  const n = out[0];
  assert.equal(n.name, 'Green House');
  assert.equal(n.plantPrice, '₪175');
  assert.equal(n.hasPlant, true);
  assert.equal(n.inStockKnown, true);
  assert.equal(n.shipsToHome, false);
  assert.equal(n.rating, 4.7);
  assert.equal(n.image, 'https://lh3.googleusercontent.com/x');
  assert.ok(n.distanceKm > 0 && n.distanceKm < 50);
});

test('a shop we read that does not list the plant is classified not_sold', async () => {
  /*
   * The user does not want to see these at all - a nursery that demonstrably
   * does not stock the plant is not a result. The client hides them; the
   * pipeline's job is to say so unambiguously.
   */
  let inferCalls = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_match' }),
      }),
      infer: async () => {
        inferCalls += 1;
        return { confidence: 72, reasoning: 'general nursery, likely stocks it' };
      },
    })
  );

  assert.equal(out[0].outcome, 'not_sold');
  assert.equal(out[0].hasPlant, false);
  assert.equal(out[0].inStockKnown, false);
  assert.equal(out[0].plantPrice, '-');
  assert.equal(inferCalls, 0, 'no likelihood is displayed any more, so none is paid for');
});


test('empty Places discovery falls back to the testing URL list', async () => {
  let usedFallback = false;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [],
      readFallbackUrls: () => {
        usedFallback = true;
        return ['https://seed.example/'];
      },
    })
  );
  assert.equal(usedFallback, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'seed.example');
  assert.equal(out[0].distanceKm, Infinity); // no coords for fallback entries
});

test('no local stock → national ship-to-home options appended (shipsToHome true)', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_match' }),
      }),
      nationalUrls: ['https://shipper.example/'],
    })
  );
  const ship = out.find((n) => n.id === 'shipper.example');
  assert.ok(ship);
  assert.equal(ship!.shipsToHome, true);
});

test('in-stock nurseries sort before estimate-only ones', async () => {
  let call = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'NoStock', website: 'https://a.example/', lat: 32.5, lng: 34.9, address: '' },
        { name: 'HasStock', website: 'https://b.example/', lat: 32.2, lng: 34.85, address: '' },
      ],
      extract: async () => {
        call += 1;
        return call === 1
          ? {
              plants: [],
              report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
              engines: { extractor: 'none', verifier: 'none' },
              funnel: funnel({ stage: 'no_match' }),
            }
          : {
              plants: [{ name: 'Monstera', price: '₪150', availability: 'in_stock' }],
              report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
              engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
              funnel: funnel(),
            };
      },
    })
  );
  assert.equal(out[0].hasPlant, true); // HasStock first regardless of distance
});

test('a bot-walled nursery is not_found and costs NO LLM call', async () => {
  /*
   * A wall means the SEARCH page never yielded a catalogue, which the funnel
   * reports as no_markdown. Previously this path fetched the homepage too and
   * asked the model to estimate from the captcha, producing "~50% · the site
   * text is only a security-verification page" - a fabricated likelihood about
   * a shop we never saw. The spy is the cost half of the assertion.
   */
  let inferCalls = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_markdown' }),
      }),
      scrapeHome: async () => 'Attention Required! Please verify you are human.',
      infer: async () => {
        inferCalls += 1;
        return { confidence: 50, reasoning: 'should never be asked' };
      },
    })
  );

  assert.equal(inferCalls, 0, 'no estimate is requested for a page we could not read');
  assert.equal(out[0].outcome, 'not_found', 'unreadable is NOT proof the plant is absent');
  assert.equal(out[0].availability?.confidence, undefined, 'no percentage is invented');
});

test('a shop whose catalogue we never read is not_found, never not_sold', async () => {
  /*
   * The distinction that matters. `no_excerpt` means the page came back but
   * nothing on it looked like a catalogue - so the plant may well be there and
   * we simply could not see it. Calling that "does not sell it" would hide a
   * nursery that has the plant.
   */
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_excerpt' }),
      }),
    })
  );

  assert.equal(out[0].outcome, 'not_found');
});


test('the query is translated once for the whole fan-out, not once per site', async () => {
  // Per-site would multiply a cheap call by the width of the search.
  let translateCalls = 0;
  const searchedFor: string[] = [];

  await runNurserySearch(
    { plantName: 'alocasia regal shield', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'A', website: 'https://a.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'B', website: 'https://b.example/', lat: 32.2, lng: 34.9, address: '' },
      ],
      nationalUrls: ['https://ship.example/'],
      translate: async () => {
        translateCalls += 1;
        return 'אלוקסיה ריגל שילד';
      },
      search: async (_website, query) => {
        searchedFor.push(query);
        return { md: 'x', platform: 'woo', picked: 'u' };
      },
    })
  );

  assert.equal(translateCalls, 1, 'one translation for three sites');
  assert.equal(searchedFor.length, 3);
  assert.ok(
    searchedFor.every((q) => q === 'אלוקסיה ריגל שילד'),
    'every shop is searched in the language it indexes'
  );
});

test('ship-to-home nurseries are scraped on every search, not only as a fallback', async () => {
  /*
   * They used to run only when nothing local matched, which emptied the Deliver
   * tab in exactly the case a user opens it: a local shop had the plant but they
   * would rather have it delivered.
   */
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'Local', website: 'https://local.example/', lat: 32.1, lng: 34.8, address: '' },
      ],
      nationalUrls: ['https://al-haderech.co.il/', 'https://rootine.co.il/'],
    })
  );

  const shippers = out.filter((n) => n.shipsToHome).map((n) => n.id);
  assert.deepEqual(shippers.sort(), ['al-haderech.co.il', 'rootine.co.il']);
  assert.ok(out.some((n) => !n.shipsToHome), 'and the local shop is still there');
});

// --- which listing gets quoted ---------------------------------------------

test('parsePrice reads the formats Israeli shops actually write', () => {
  assert.equal(parsePrice('₪49'), 49);
  assert.equal(parsePrice('₪1,499.90'), 1499.9);
  assert.equal(parsePrice('249.00'), 249);
  assert.equal(parsePrice('45.00 ILS'), 45);
  // Unparseable sorts last instead of winning by accident.
  assert.equal(parsePrice('call us'), Infinity);
  assert.equal(parsePrice(''), Infinity);
  assert.equal(parsePrice('₪0'), Infinity);
});

test('the cheapest in-stock listing is quoted, not whichever came first', () => {
  /*
   * Real case: al-haderech returned 28 Alocasia cultivars from ₪39 to ₪1,499.90
   * and we quoted ₪999.90 purely because that row was first in the DOM. Every
   * number was correct; the choice was arbitrary, and it read as a broken
   * scrape.
   */
  const best = cheapestMatch([
    { name: 'זברינה מוחיטו', price: '₪999.90', availability: 'in_stock' },
    { name: 'ריגל שילד אלבו', price: '₪1,499.90', availability: 'in_stock' },
    { name: 'דרגון סקייל מיני', price: '₪39.00', availability: 'in_stock' },
    { name: 'פריידק ראונד ליף', price: '₪89.00', availability: 'in_stock' },
  ]);
  assert.equal(best.name, 'דרגון סקייל מיני');
  assert.equal(best.price, '₪39.00');
});

test('a sold-out bargain does not beat something you can actually buy', () => {
  const best = cheapestMatch([
    { name: 'cheap but gone', price: '₪10', availability: 'out_of_stock' },
    { name: 'in stock', price: '₪90', availability: 'in_stock' },
  ]);
  assert.equal(best.name, 'in stock');
});

test('an all-sold-out shop still reports its cheapest rather than nothing', () => {
  const best = cheapestMatch([
    { name: 'b', price: '₪90', availability: 'out_of_stock' },
    { name: 'a', price: '₪10', availability: 'out_of_stock' },
  ]);
  assert.equal(best.name, 'a');
});

test('the quoted listing carries its own product link and match count', async () => {
  // The Order button opened the homepage before this, leaving the user to find
  // the plant again at a shop with two dozen of them.
  const out = await runNurserySearch(
    { plantName: 'alocasia', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [
          { name: 'pricey', price: '₪999', availability: 'in_stock', url: 'https://x.co.il/products/pricey' },
          { name: 'cheap', price: '₪39', availability: 'in_stock', url: 'https://x.co.il/products/cheap' },
        ],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel(),
      }),
    })
  );

  assert.equal(out[0].plantPrice, '₪39');
  assert.equal(out[0].productUrl, 'https://x.co.il/products/cheap');
  assert.equal(out[0].productName, 'cheap');
  assert.equal(out[0].matchCount, 2);
});

test('a price the final check rejects is hidden, but the nursery stays', async () => {
  /*
   * The shop does stock the plant - we simply do not trust the figure we read
   * off its page. A wrong price is worse than no price, so the number goes and
   * the row remains with a "See price" tag pointing at the product.
   */
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [{ name: 'Monstera', price: '₪0521234567', availability: 'in_stock' }],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel(),
      }),
      checkPrices: async () => [{ plausible: false, reason: 'that is a phone number' }],
    })
  );

  assert.equal(out[0].priceSuspect, true);
  assert.equal(out[0].plantPrice, '-', 'the number we do not trust is not shown');
  assert.equal(out[0].priceNote, 'that is a phone number');
  assert.equal(out[0].inStockKnown, true, 'the shop still stocks it');
  assert.equal(out[0].outcome, 'found');
});

test('a price the final check accepts is left exactly as scraped', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      checkPrices: async () => [{ plausible: true, reason: '' }],
    })
  );
  assert.equal(out[0].plantPrice, '₪175');
  assert.equal(out[0].priceSuspect, undefined);
});

test('the price check is one call for the whole search, over priced rows only', async () => {
  // Comparing nurseries against each other is the point, so it cannot be
  // per-site; and rows with no price have nothing to check.
  let calls = 0;
  let batch: { site: string; price: string }[] = [];

  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'A', website: 'https://a.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'B', website: 'https://b.example/', lat: 32.2, lng: 34.9, address: '' },
      ],
      nationalUrls: [],
      checkPrices: async (_q, candidates) => {
        calls += 1;
        batch = candidates;
        return candidates.map(() => ({ plausible: true, reason: '' }));
      },
    })
  );

  assert.equal(calls, 1, 'two nurseries, one call');
  assert.equal(batch.length, 2, 'both priced rows go in the same comparison');
});

// --- one slow shop must not set the length of the whole search -------------

test('scrapeOne: a site that exceeds its budget reports as unread, not as absent', async () => {
  const never = new Promise<never>(() => {}); // a shop that answers neither provider
  const deps = {
    ...makeDeps(),
    siteBudgetMs: 30,
    discover: async () => [{ name: 'Dead Shop', website: 'https://dead.co.il/', lat: 0, lng: 0, address: '' }],
    search: () => never,
  };
  const t0 = Date.now();
  const rows = await runNurserySearch({ plantName: 'sage', lat: 32, lng: 34 }, deps as any);
  const elapsed = Date.now() - t0;
  const dead = rows.find((r) => r.id === 'dead.co.il')!;
  assert.equal(dead.outcome, 'not_found'); // never 'not_sold' - we did not read a catalogue
  assert.equal(dead.availability?.kind, 'error');
  assert.match(dead.availability!.detail, /did not respond/);
  assert.ok(elapsed < 2000, `search should not wait on a dead shop, took ${elapsed}ms`);
});

test('scrapeOne: a site answering inside its budget is unaffected', async () => {
  const deps = {
    ...makeDeps(),
    siteBudgetMs: 2000,
    discover: async () => [{ name: 'Live Shop', website: 'https://live.co.il/', lat: 0, lng: 0, address: '' }],
    search: async () => ({ md: 'page', platform: 'woo', picked: 'u' }),
    extract: async () => ({
      plants: [{ name: 'Sage', price: '₪49', availability: 'in_stock' as const, url: 'u' }],
      funnel: { stage: 'ok' as const, mdChars: 4, excerptChars: 4, extracted: 1 },
    }),
  };
  const rows = await runNurserySearch({ plantName: 'sage', lat: 32, lng: 34 }, deps as any);
  assert.equal(rows[0].outcome, 'found');
  assert.equal(rows[0].plantPrice, '₪49');
});
