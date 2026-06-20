/**
 * Unit tests for Places nursery discovery. No network — fetch is injected.
 * Run: node --test scraper/places.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverNurseries } from './places.ts';

// Build a fake fetch returning a fixed status + JSON body, capturing the request.
const fakeFetch = (
  status: number,
  body: unknown,
  capture?: (url: string, init: any) => void
): typeof fetch =>
  (async (url: string, init: any) => {
    capture?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;

const place = (over: Record<string, unknown> = {}) => ({
  displayName: { text: 'משתלת ורד' },
  location: { latitude: 32.07, longitude: 34.78 },
  websiteUri: 'https://vered.co.il',
  formattedAddress: 'רחוב הפרחים 1, תל אביב',
  ...over,
});

test('discoverNurseries: parses displayName/location/website/address', async () => {
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places: [place()] }));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    name: 'משתלת ורד',
    website: 'https://vered.co.il',
    lat: 32.07,
    lng: 34.78,
    address: 'רחוב הפרחים 1, תל אביב',
  });
});

test('discoverNurseries: drops places with no website (unscrapable)', async () => {
  const places = [place(), place({ websiteUri: undefined }), place({ websiteUri: '' })];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places }));
  assert.equal(out.length, 1);
});

test('discoverNurseries: sends textQuery + circle bias + auth/mask headers', async () => {
  let url = '';
  let init: any = null;
  await discoverNurseries(
    32.08,
    34.78,
    'KEY',
    { textQuery: 'plant nursery', radiusM: 3000 },
    fakeFetch(200, { places: [] }, (u, i) => {
      url = u;
      init = i;
    })
  );
  assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(init.headers['X-Goog-Api-Key'], 'KEY');
  assert.match(init.headers['X-Goog-FieldMask'], /places\.websiteUri/);
  const sent = JSON.parse(init.body);
  assert.equal(sent.textQuery, 'plant nursery');
  assert.deepEqual(sent.locationBias.circle.center, { latitude: 32.08, longitude: 34.78 });
  assert.equal(sent.locationBias.circle.radius, 3000);
});

test('discoverNurseries: dedups chains by website host (www / branch variants)', async () => {
  const places = [
    place({ websiteUri: 'http://mashtela-urbanit.co.il/', formattedAddress: 'branch A' }),
    place({ websiteUri: 'https://www.mashtela-urbanit.co.il/', formattedAddress: 'branch B' }),
    place({ websiteUri: 'https://other.co.il' }),
  ];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places }));
  assert.equal(out.length, 2);
  assert.equal(out[0].address, 'branch A'); // first branch wins
});

test('discoverNurseries: caps results at maxResults', async () => {
  const places = Array.from({ length: 15 }, (_, i) => place({ websiteUri: `https://n${i}.co.il` }));
  const out = await discoverNurseries(32.08, 34.78, 'KEY', { maxResults: 5 }, fakeFetch(200, { places }));
  assert.equal(out.length, 5);
});

test('discoverNurseries: empty / missing places → []', async () => {
  assert.deepEqual(await discoverNurseries(32, 34, 'KEY', {}, fakeFetch(200, {})), []);
  assert.deepEqual(await discoverNurseries(32, 34, 'KEY', {}, fakeFetch(200, { places: [] })), []);
});

test('discoverNurseries: non-2xx → throws', async () => {
  await assert.rejects(
    () => discoverNurseries(32, 34, 'KEY', {}, fakeFetch(403, { error: { message: 'SKU not enabled' } })),
    /Places 403/
  );
});
