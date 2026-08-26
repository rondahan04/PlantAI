/**
 * Unit tests for runNurserySearch. No network - every dependency is injected.
 * Run: node --test scraper/pipeline.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNurserySearch, type PipelineDeps } from './pipeline.ts';
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
