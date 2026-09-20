/**
 * Unit tests for runNurserySearch. No network - every dependency is injected.
 * Run: node --test scraper/pipeline.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNurserySearch, parsePrice, cheapestMatch, type PipelineDeps } from './pipeline.ts';
import type { ExtractFunnel } from './core.ts';

/* runNurserySearch reads only `plants`; the rest of PipelineResult is padding
 * these fixtures have to carry to satisfy the type. */
const funnel = (over: Partial<ExtractFunnel> = {}): ExtractFunnel => ({
  stage: 'ok',
  mdChars: 0,
  excerptChars: 0,
  extracted: 0,
  kept: 0,
  prices: 0,
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
   *
   * `prices` is part of "demonstrably": a page that prices nothing drops every
   * row for want of a price and closes at no_match regardless of what the shop
   * stocks, so it cannot carry this claim. A real grid prices its cards.
   */
  let inferCalls = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_match', prices: 14 }),
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


/*
 * The other half of that rule, and a correction to it.
 *
 * "We read a catalogue and it was not there" is only true if the shop actually
 * searched. mashtela-urbanit.co.il (Joomla/VirtueMart, remembered as Woo) and
 * yifrach.co.il (ASP.NET) both answer our search URL with their homepage: full
 * of products, none matching, funnel closes at no_match - and the user was told
 * a shop does not stock a plant nobody ever asked it about.
 */
test('a search the shop never applied is not evidence of absence', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({
        md: 'the homepage, again',
        platform: 'woo',
        picked: 'u',
        answered: false,
      }),
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_match' }),
      }),
    })
  );

  assert.equal(out[0].outcome, 'not_found', 'not_sold would be a confident wrong answer');
  assert.equal(out[0].availability?.kind, 'unreadable');
});

/*
 * yahalomr.co.il: eight kilobytes of brochure, a phone number, and no shop.
 * "We couldn't check" invites the user to wait for a check that will never
 * succeed - the useful answer is that this one takes a phone call.
 */
test('a nursery with no shop on its site is a phone call, not a failed read', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({
        md: 'משתלת יהלום רוני - שעות פתיחה וטלפון',
        platform: 'unknown',
        picked: 'u',
        storefront: false,
      }),
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_excerpt' }),
      }),
    })
  );

  assert.equal(out[0].outcome, 'not_found');
  assert.equal(out[0].availability?.kind, 'no_catalogue');
});

test('a shop we simply could not read is still reported as unread', async () => {
  // storefront is only load-bearing when it is FALSE; a site we could not read
  // tells us nothing about whether it has a shop.
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({ md: '', platform: 'unknown', picked: 'u' }),
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel({ stage: 'no_markdown' }),
      }),
    })
  );
  assert.equal(out[0].availability?.kind, 'unreadable');
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
        // `translate` yields a plain string, so that is what arrives here.
        searchedFor.push(typeof query === 'string' ? query : query.hebrew);
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

/*
 * The pipeline knows where each site's read stopped and used to throw
 * that away, which is why a nursery that quietly stops parsing has been
 * invisible - the search still succeeds, it just silently contains fewer shops.
 */
test('onSiteRead reports the stage the site actually reached', async () => {
  const seen: Array<[string, string]> = [];
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        // The distinction that matters: we never read this shop's catalogue.
        funnel: funnel({ stage: 'no_excerpt' }),
      }),
      onSiteRead: (host, stage) => seen.push([host, stage]),
    })
  );
  assert.deepEqual(seen, [['gh.example', 'no_excerpt']]);
});

/*
 * The health signal and the user-facing outcome must agree about whether we
 * read a shop, and they did not.
 *
 * `answered === false` means the shop handed back a page that ignores the
 * query - a 404, or its own homepage served to every term. The outcome path
 * already refuses to call that "we read the catalogue" (see readCatalogue), but
 * noteSite recorded the raw stage, and a 404 page that happens to parse into
 * zero rows arrives as `no_match` - which readable() counts as a SUCCESSFUL
 * read. So a shop that has been answering nothing for a month reports as a shop
 * that simply does not stock the plant, which is the exact blindness `no_search`
 * was added to end.
 *
 * Measured on yahalomr.co.il 2026-09-13: platform unknown, so the search URL is
 * a guess, and https://yahalomr.co.il/search?q=... is an IIS 404. The direct
 * HTML read returns nothing (the shop refuses it), so `searchStatus` is
 * undefined and the status test alone can never fire.
 */
/*
 * "Not stocked" is a claim, and it needs a priced catalogue behind it.
 *
 * mashtela-urbanit.co.il is the case. Its search DOES answer - Joomla core
 * search filters properly - but it returns product names and links with no
 * prices on the page. Every row the extractor proposes is then dropped for
 * want of a price, the funnel closes at no_match, and the shop was reported as
 * `not_sold`: hidden from the user (see isWorthShowing) under the assertion
 * "The shop was searched and this plant was not listed." They sell monstera.
 *
 * Reading a page that cannot state a price is not reading a catalogue.
 */
test('a searched shop whose page carries no prices is not called not_sold', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({
        md: '## Search results\n[Monstera Monkey](https://gh.example/p/1)',
        platform: 'virtuemart',
        picked: 'u',
        answered: true, // the shop really did search
      }),
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'gpt-5.6-luna' as const },
        /* Names on the page, but nothing priced. */
        funnel: funnel({ stage: 'no_match', prices: 0 }),
      }),
    })
  );
  assert.equal(out[0].outcome, 'not_found', 'we cannot claim a plant is absent from an unpriced page');
  assert.equal(out[0].availability?.kind, 'unreadable');
  /* "We could not read this shop" is the wrong sentence here - we read it fine,
   * the price is the only thing missing, and the user may be standing nearby. */
  assert.match(out[0].availability!.detail, /could not read its prices/);
});

/* The converse, so the fix cannot quietly delete not_sold: a page that prices
 * its products and does not list this plant is a real "not stocked". */
test('a searched shop whose page prices its products still reports not_sold', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({ md: 'a priced grid', platform: 'woo', picked: 'u', answered: true }),
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'gpt-5.6-luna' as const },
        funnel: funnel({ stage: 'no_match', prices: 12 }),
      }),
    })
  );
  assert.equal(out[0].outcome, 'not_sold');
});

/* The shop's own JSON is priced by definition, and the HTML page is empty on
 * that path - so a structured catalogue read must not be judged by page prices. */
test('a structured catalogue read is priced evidence even with no page markdown', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({
        md: '',
        platform: 'woo',
        picked: 'u',
        answered: true,
        catalogueRead: true,
      }),
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'gpt-5.6-luna' as const },
        funnel: funnel({ stage: 'no_match', prices: 0 }),
      }),
    })
  );
  assert.equal(out[0].outcome, 'not_sold', 'the Store API answered; its rows carry prices');
});

test('a shop that answered nothing is no_search, even when the stage looks readable', async () => {
  const seen: Array<[string, string]> = [];
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      /* No searchStatus: the shop refused our direct GET, so the 404 is only
       * visible as the provider's copy of the page. */
      search: async () => ({ md: '## 404 - File or directory not found.', platform: 'unknown', picked: 'u', answered: false }),
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'gpt-5.6-luna' as const },
        funnel: funnel({ stage: 'no_match' }),
      }),
      onSiteRead: (host, stage) => seen.push([host, stage]),
    })
  );
  assert.deepEqual(seen, [['gh.example', 'no_search']]);
});

/* The converse, so the fix cannot be "call everything no_search": a shop that
 * genuinely answered and genuinely lacks the plant is still a successful read. */
test('a shop that answered and lacks the plant stays no_match', async () => {
  const seen: Array<[string, string]> = [];
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => ({ md: 'a real results page', platform: 'woo', picked: 'u', answered: true }),
      extract: async () => ({
        plants: [],
        report: { is_valid: true, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna' as const, verifier: 'gpt-5.6-luna' as const },
        funnel: funnel({ stage: 'no_match' }),
      }),
      onSiteRead: (host, stage) => seen.push([host, stage]),
    })
  );
  assert.deepEqual(seen, [['gh.example', 'no_match']]);
});

test('a site that throws is reported as unreadable, not as a plant that is absent', async () => {
  const seen: Array<[string, string]> = [];
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      search: async () => {
        throw new Error('ECONNRESET');
      },
      onSiteRead: (host, stage) => seen.push([host, stage]),
    })
  );
  assert.deepEqual(seen, [['gh.example', 'error']]);
  // And the user-facing story is unchanged: we did not manage to look.
  assert.equal(out[0].outcome, 'not_found');
});

test('a throwing observer cannot fail a scrape that has already been paid for', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      onSiteRead: () => {
        throw new Error('monitoring is down');
      },
    })
  );
  // The observer is a diagnostic bolted onto a scrape the user has waited for
  // and we have spent money on. Losing that to a broken counter is absurd.
  assert.equal(out.length, 1);
  assert.equal(out[0].plantPrice, '₪175');
});

/*
 * "Stock unknown" instead of dropping the row.
 *
 * The auditor was right to refuse an in-stock claim the page never made -
 * `verification REJECTED (conf 92): the source text does not explicitly state
 * stock status` - but dropping the row deleted a nursery that does sell the
 * plant. These cover the half that decides what to DO with such a row, which
 * is testable with an injected verdict and needs no model call.
 */
test('a listing with no stock statement keeps the shop, and does not claim it is in stock', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [{ name: 'Monstera deliciosa', price: '₪175', availability: 'unknown' }],
        report: { is_valid: true, confidence_score: 92, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel({ stage: 'ok', extracted: 1, kept: 1 }),
      }),
    })
  );

  assert.equal(out.length, 1, 'the shop survives - it was being deleted before');
  assert.equal(out[0].outcome, 'found');
  assert.equal(out[0].plantPrice, '₪175', 'the price is real and is kept');
  // The whole point: we do NOT claim certainty the source never gave us.
  assert.equal(out[0].inStockKnown, false);
  assert.equal(out[0].availability?.kind, 'stock_unknown');
});

test('an explicit in-stock listing still reports certainty', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps()
  );
  assert.equal(out[0].inStockKnown, true);
  assert.equal(out[0].availability, undefined, 'nothing to caveat');
});

test('an out-of-stock listing is not laundered into "unknown"', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [{ name: 'Monstera', price: '₪175', availability: 'out_of_stock' }],
        report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel({ stage: 'ok', extracted: 1, kept: 1 }),
      }),
    })
  );
  // Sold out is knowledge, not absence of it.
  assert.equal(out[0].hasPlant, false);
  assert.equal(out[0].inStockKnown, true);
});

// --- nurseries with no website --------------------------------------------

test('a nursery with no website is reported, never scraped', async () => {
  let searched = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        {
          name: 'משתלת רימון',
          website: '',
          lat: 32.1,
          lng: 34.8,
          address: 'רימון 3',
          phone: '03-9',
        },
      ],
      search: async () => {
        searched += 1;
        return { md: '', platform: 'unknown', picked: null };
      },
    })
  );
  assert.equal(searched, 0, 'there is no site to read, so nothing may be paid for');
  assert.equal(out.length, 1);
  const n = out[0];
  assert.equal(n.name, 'משתלת רימון');
  assert.equal(n.phone, '03-9');
  assert.equal(n.hasPlant, false);
  assert.equal(n.outcome, 'not_found');
  assert.equal(n.availability?.kind, 'no_website');
  // Finite distance is what puts it in the Pick Up tab.
  assert.ok(Number.isFinite(n.distanceKm));
});

test('two site-less nurseries do not collide on an empty host', async () => {
  const at = (name: string, lat: number) => ({
    name,
    website: '',
    lat,
    lng: 34.8,
    address: name,
  });
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({ discover: async () => [at('A', 32.1), at('B', 32.2)] })
  );
  assert.deepEqual(out.map((n) => n.name).sort(), ['A', 'B']);
});

test('a shop with stock still outranks a nearer nursery with no website', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'No Site', website: '', lat: 32.086, lng: 34.782, address: 'next door' },
        { name: 'Green House', website: 'https://gh.example/', lat: 32.3, lng: 34.9, address: 'far' },
      ],
    })
  );
  assert.deepEqual(out.map((n) => n.name), ['Green House', 'No Site']);
});

// --- what the final price check is actually for -----------------------------

/*
 * It filtered on `inStockKnown`, which is a fact about STOCK, not about the
 * price. A listing whose page never says whether the plant is in stock kept its
 * price and skipped the check entirely - and a delivery threshold read off such
 * a page is exactly as wrong as one read off any other.
 */
test('a price on a listing with no stock statement is still checked', async () => {
  let seen: { site: string; price: string }[] = [];
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [{ name: 'Monstera', price: '₪350', availability: 'unknown' }],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel(),
      }),
      checkPrices: async (_q, candidates) => {
        seen = candidates;
        return candidates.map(() => ({ plausible: false, reason: 'free-delivery threshold' }));
      },
    })
  );
  assert.equal(seen.length, 1, 'the row was checked');
  assert.equal(out[0].inStockKnown, false);
  assert.equal(out[0].plantPrice, '-', 'and the number we do not trust is hidden');
  assert.equal(out[0].priceSuspect, true);
});

/*
 * The check catches a READING failure: a phone number or a shipping threshold
 * mistaken for a price. That cannot happen to a number copied out of the shop's
 * own price field, and the call is the last thing standing between the user and
 * their results.
 */
test('a price the shop published is not sent to the model to be second-guessed', async () => {
  let calls = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [
          { name: 'Monstera', price: '₪175', availability: 'in_stock', priceSource: 'stated' },
        ],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
        funnel: funnel(),
      }),
      checkPrices: async (_q, candidates) => {
        calls += 1;
        return candidates.map(() => ({ plausible: true, reason: '' }));
      },
    })
  );
  assert.equal(calls, 0, 'nothing on this search was read by a model');
  assert.equal(out[0].plantPrice, '₪175');
  assert.equal(out[0].priceStated, true);
});

test('a search mixing published and read prices checks only the read ones', async () => {
  let batch: { site: string; price: string }[] = [];
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [
        { name: 'A', website: 'https://a.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'B', website: 'https://b.example/', lat: 32.2, lng: 34.9, address: '' },
      ],
      nationalUrls: [],
      extract: async (o) => ({
        plants: [
          o.site === 'a.example'
            ? { name: 'Monstera', price: '₪175', availability: 'in_stock', priceSource: 'stated' as const }
            : { name: 'Monstera', price: '₪350', availability: 'in_stock' },
        ],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel(),
      }),
      checkPrices: async (_q, candidates) => {
        batch = candidates;
        return candidates.map(() => ({ plausible: true, reason: '' }));
      },
    })
  );
  assert.deepEqual(batch.map((c) => c.price), ['₪350']);
});

// --- the fan-out stops waiting on its tail ----------------------------------

/*
 * With most shops answering from their own JSON in about a second, a 45s
 * per-site ceiling means one dead nursery decides how long a search takes that
 * was otherwise finished in two - and the user sits in front of a complete set
 * of results waiting for a shop that is not going to answer.
 */
test('once most of the fan-out is in, a straggler gets a grace period, not the ceiling', async () => {
  const never = new Promise<never>(() => {});
  const started = Date.now();
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      siteBudgetMs: 60_000, // the ceiling must NOT be what ends this
      tailGraceMs: 40,
      nationalUrls: [],
      discover: async () => [
        { name: 'A', website: 'https://a.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'B', website: 'https://b.example/', lat: 32.2, lng: 34.9, address: '' },
        { name: 'Dead', website: 'https://dead.example/', lat: 32.3, lng: 34.9, address: '' },
      ],
      search: async (website) =>
        website.includes('dead')
          ? ((await never) as never)
          : { md: '# מונסטרה\n₪175', platform: 'woo', picked: `${website}?s=x` },
    })
  );
  assert.ok(Date.now() - started < 5000, 'the search did not wait out the ceiling');
  const dead = out.find((n) => n.id === 'dead.example');
  assert.equal(dead?.outcome, 'not_found', 'a shop we stopped waiting for is unread');
  assert.equal(dead?.availability?.kind, 'error');
  /* And the shops that answered are all still here, priced. */
  assert.equal(out.filter((n) => n.outcome === 'found').length, 2);
});

/*
 * The grace period may not start before there is a quorum to start it. A fan-out
 * where nothing has finished has no evidence that anything is slow.
 */
test('the grace period does not start until enough sites have settled', async () => {
  const slowButGood = (ms: number) =>
    new Promise((resolve) => setTimeout(() => resolve({ md: '# מונסטרה\n₪175', platform: 'woo', picked: 'https://x/?s=y' }), ms));
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      siteBudgetMs: 60_000,
      tailGraceMs: 30,
      nationalUrls: [],
      discover: async () => [
        { name: 'A', website: 'https://a.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'B', website: 'https://b.example/', lat: 32.2, lng: 34.9, address: '' },
      ],
      /* Both shops are slow; neither is a straggler, because neither has anyone
       * to straggle behind. */
      search: async () => (await slowButGood(80)) as any,
    })
  );
  assert.equal(out.filter((n) => n.outcome === 'found').length, 2);
});

// --- the per-shop cache: what a search actually reuses -----------------------

/*
 * The whole-search cache keys on term + point + radius, so it answers only when
 * the same thing is asked from within ~100m of where it was asked before - GPS
 * jitter alone defeats it. What is genuinely the same answer for everybody is
 * one shop's shelf for one plant.
 */
test('a shop read today is not read again for the next user', async () => {
  let searched = 0;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      nationalUrls: [],
      search: async () => {
        searched += 1;
        return { md: '# מונסטרה\n₪175', platform: 'woo', picked: 'https://x/?s=y' };
      },
      readShopCache: async () => ({
        results: {
          plantPrice: '₪149',
          hasPlant: true,
          inStockKnown: true,
          outcome: 'found' as const,
          productName: 'מונסטרה דליסיוסה',
          productUrl: 'https://shop.example/product/monstera/',
        },
        scrapedAt: Date.now() - 60_000,
      }),
    })
  );
  assert.equal(searched, 0, 'nobody paid to read this shop again');
  assert.equal(out[0].plantPrice, '₪149');
  assert.equal(out[0].fromCache, true);
  /* Identity is the FRESH one: a cached row must never serve one user another
   * user's distance. */
  assert.equal(out[0].name, 'Green House');
  assert.ok(Number.isFinite(out[0].distanceKm));
});

test('a cache that throws costs a scrape, never a search', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      nationalUrls: [],
      readShopCache: async () => {
        throw new Error('supabase down');
      },
    })
  );
  assert.equal(out[0].outcome, 'found');
  assert.equal(out[0].fromCache, undefined);
});

/*
 * `not_found` is not a reading of a shop - it is a shop that was down,
 * rate-limited, or cut off behind the fan-out's tail. Storing it would turn one
 * bad minute into a day of telling every user we cannot check a shop that is by
 * then answering perfectly well.
 */
test('only a real reading of a shop is worth keeping', async () => {
  const written: { host: string; outcome?: string }[] = [];
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      nationalUrls: [],
      discover: async () => [
        { name: 'Good', website: 'https://good.example/', lat: 32.1, lng: 34.8, address: '' },
        { name: 'Down', website: 'https://down.example/', lat: 32.2, lng: 34.9, address: '' },
      ],
      search: async (website) => {
        if (website.includes('down')) throw new Error('ECONNREFUSED');
        return { md: '# מונסטרה\n₪175', platform: 'woo', picked: 'https://x/?s=y' };
      },
      writeShopCache: async (host, _q, row) => {
        written.push({ host, outcome: row.outcome });
      },
    })
  );
  await new Promise((r) => setImmediate(r)); // the write is fire-and-forget
  assert.deepEqual(written.map((w) => w.host), ['good.example']);
  assert.equal(written[0].outcome, 'found');
});

test('a row served from the cache is not written straight back to it', async () => {
  let writes = 0;
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      nationalUrls: [],
      readShopCache: async () => ({
        results: { plantPrice: '₪149', hasPlant: true, inStockKnown: true, outcome: 'found' as const },
        scrapedAt: Date.now(),
      }),
      writeShopCache: async () => {
        writes += 1;
      },
    })
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(writes, 0);
});

/* A price the cross-nursery check rejected must not be handed to tomorrow's
 * searches as though it had passed. */
test('what is cached is the verified row, not the one before the price check', async () => {
  let stored: { plantPrice: string } | undefined;
  await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      nationalUrls: [],
      extract: async () => ({
        plants: [{ name: 'Monstera', price: '₪0521234567', availability: 'in_stock' }],
        report: { is_valid: true, confidence_score: 100, feedback: '', corrected_output: [] },
        engines: { extractor: 'gpt-5.6-luna', verifier: 'gpt-5.6-luna' },
        funnel: funnel(),
      }),
      checkPrices: async () => [{ plausible: false, reason: 'that is a phone number' }],
      writeShopCache: async (_h, _q, row) => {
        stored = row as { plantPrice: string };
      },
    })
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(stored?.plantPrice, '-');
});
