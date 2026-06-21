/**
 * Unit tests for runNurserySearch. No network — every dependency is injected.
 * Run: node --test scraper/pipeline.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNurserySearch, type PipelineDeps } from './pipeline.ts';

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
      engines: { extractor: 'gpt-5.5', verifier: 'gpt-5.5' },
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

test('0 scraped products → estimate card (hasPlant false, availabilityNote set)', async () => {
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      extract: async () => ({
        plants: [],
        report: { is_valid: false, confidence_score: 0, feedback: '', corrected_output: [] },
        engines: { extractor: 'none', verifier: 'none' },
      }),
      infer: async () => ({ confidence: 72, reasoning: 'general nursery, likely stocks it' }),
    })
  );
  assert.equal(out[0].hasPlant, false);
  assert.equal(out[0].inStockKnown, false);
  assert.equal(out[0].plantPrice, '—');
  assert.match(out[0].availabilityNote ?? '', /72%/);
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
            }
          : {
              plants: [{ name: 'Monstera', price: '₪150', availability: 'in_stock' }],
              report: { is_valid: true, confidence_score: 90, feedback: '', corrected_output: [] },
              engines: { extractor: 'gpt-5.5', verifier: 'gpt-5.5' },
            };
      },
    })
  );
  assert.equal(out[0].hasPlant, true); // HasStock first regardless of distance
});
