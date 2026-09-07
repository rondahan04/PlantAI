/**
 * Unit tests for Places nursery discovery. No network - fetch is injected.
 * Run: node --test scraper/places.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverNurseries, resolvePhotoUrl, isNonStoreHost, PLACES_PAGE_SIZE } from './places.ts';

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

test('discoverNurseries: a place with no website comes back contact-only, not dropped', async () => {
  const places = [
    place(),
    place({ websiteUri: undefined, displayName: { text: 'משתלת רימון' }, formattedAddress: 'רימון 3' }),
    place({ websiteUri: '', displayName: { text: 'משתלת אלון' }, formattedAddress: 'אלון 4' }),
  ];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places }));
  assert.equal(out.length, 3);
  // Scrapable shops lead; the site-less ones carry '' so the pipeline knows not
  // to scrape them.
  assert.equal(out[0].website, 'https://vered.co.il');
  assert.deepEqual(out.slice(1).map((n) => n.website), ['', '']);
  assert.deepEqual(out.slice(1).map((n) => n.name), ['משתלת רימון', 'משתלת אלון']);
});

test('discoverNurseries: a social page is contact-only, never scraped', async () => {
  const places = [place({ websiteUri: 'https://www.facebook.com/somenursery' })];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places }));
  assert.equal(out.length, 1);
  assert.equal(out[0].website, '');
});

test('discoverNurseries: contact-only places dedup on name + address, not host', async () => {
  const places = [
    place({ websiteUri: undefined, formattedAddress: 'same place' }),
    place({ websiteUri: undefined, formattedAddress: 'same place' }),
    place({ websiteUri: undefined, formattedAddress: 'other branch' }),
  ];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', {}, fakeFetch(200, { places }));
  // Two branches of one chain are two places to drive to; one place listed
  // twice is a bug.
  assert.deepEqual(out.map((n) => n.address), ['same place', 'other branch']);
});

test('discoverNurseries: contactOnlyMax caps them, 0 restores the old drop', async () => {
  const places = Array.from({ length: 6 }, (_, i) =>
    place({ websiteUri: undefined, formattedAddress: `addr ${i}` })
  );
  const capped = await discoverNurseries(32.08, 34.78, 'KEY', { contactOnlyMax: 2 }, fakeFetch(200, { places }));
  assert.equal(capped.length, 2);
  const none = await discoverNurseries(32.08, 34.78, 'KEY', { contactOnlyMax: 0 }, fakeFetch(200, { places }));
  assert.deepEqual(none, []);
});

test('discoverNurseries: the scrapable cap does not stop contact-only rows being found', async () => {
  const places = [
    place({ websiteUri: 'https://a.co.il' }),
    place({ websiteUri: 'https://b.co.il' }),
    place({ websiteUri: undefined, formattedAddress: 'no site here' }),
  ];
  const out = await discoverNurseries(32.08, 34.78, 'KEY', { maxResults: 1 }, fakeFetch(200, { places }));
  // One paid scrape, and the site-less nursery still reaches the Pick Up tab.
  assert.deepEqual(out.map((n) => n.website), ['https://a.co.il', '']);
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

/*
 * Measured live: a 10km search around Tel Aviv returned seven usable shops
 * where the same single request contained eleven. `maxResults` caps how many
 * sites we SCRAPE; applying it to the request threw away candidates before the
 * website and social-page filters had run, and a page of Places results is
 * mostly places with no website.
 */
test('discoverNurseries: asks for a full page, then caps what it keeps', async () => {
  let sent: any;
  const fetchImpl = (async (_url: string, init: any) => {
    sent = JSON.parse(init.body);
    const places = [
      ...Array.from({ length: 8 }, (_, i) => place({ websiteUri: '' })),
      ...Array.from({ length: 6 }, (_, i) => place({ websiteUri: `https://n${i}.co.il` })),
    ];
    return { ok: true, status: 200, json: async () => ({ places }) } as any;
  }) as unknown as typeof fetch;

  const out = await discoverNurseries(32.08, 34.78, 'KEY', { maxResults: 5 }, fetchImpl);
  assert.equal(sent.pageSize, PLACES_PAGE_SIZE, 'a small cap must not shrink the request');
  /* `maxResults` caps the shops we SCRAPE. Contact-only rows ride along beyond
   * it - they cost no scrape - so the assertion is on the scrapable half. */
  const scrapable = out.filter((n) => n.website);
  assert.equal(scrapable.length, 5, 'the cap still applies, after the filtering');
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

test('richFields widens the field mask and parses rating/hours/phone/photo', async () => {
  let sentMask = '';
  const body = {
    places: [
      {
        displayName: { text: 'Green House' },
        location: { latitude: 32.1, longitude: 34.8 },
        websiteUri: 'https://greenhouse.example/',
        formattedAddress: '1 Sokolov St',
        rating: 4.7,
        userRatingCount: 143,
        regularOpeningHours: { weekdayDescriptions: ['Sunday: 9:00 AM – 7:00 PM'] },
        nationalPhoneNumber: '03-1234567',
        photos: [{ name: 'places/ABC/photos/XYZ' }],
      },
    ],
  };
  const out = await discoverNurseries(
    32.1,
    34.8,
    'KEY',
    { richFields: true },
    fakeFetch(200, body, (_u, init) => { sentMask = init.headers['X-Goog-FieldMask']; })
  );

  assert.ok(sentMask.includes('places.rating'));
  assert.ok(sentMask.includes('places.regularOpeningHours'));
  assert.ok(sentMask.includes('places.nationalPhoneNumber'));
  assert.ok(sentMask.includes('places.photos'));
  assert.equal(out[0].rating, 4.7);
  assert.equal(out[0].reviewCount, 143);
  assert.equal(out[0].phone, '03-1234567');
  assert.equal(out[0].hours, 'Sunday: 9:00 AM – 7:00 PM');
  assert.equal(out[0].photoName, 'places/ABC/photos/XYZ');
});

test('default (no richFields) keeps the base mask', async () => {
  let sentMask = '';
  await discoverNurseries(
    32, 34, 'KEY', {},
    fakeFetch(200, { places: [] }, (_u, init) => { sentMask = init.headers['X-Goog-FieldMask']; })
  );
  assert.ok(!sentMask.includes('places.rating'));
  assert.ok(sentMask.includes('places.websiteUri'));
});

test('resolvePhotoUrl returns the photoUri for a photo name', async () => {
  let calledUrl = '';
  const fake = (async (url: string) => {
    calledUrl = url;
    return { ok: true, status: 200, json: async () => ({ photoUri: 'https://lh3.googleusercontent.com/abc' }) };
  }) as unknown as typeof fetch;
  const url = await resolvePhotoUrl('places/ABC/photos/XYZ', 'KEY', fake);
  assert.ok(calledUrl.includes('places/ABC/photos/XYZ/media'));
  assert.ok(calledUrl.includes('skipHttpRedirect=true'));
  assert.equal(url, 'https://lh3.googleusercontent.com/abc');
});

test('resolvePhotoUrl returns undefined on failure', async () => {
  const fake = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
  assert.equal(await resolvePhotoUrl('places/ABC/photos/XYZ', 'KEY', fake), undefined);
});

test('isNonStoreHost: social pages are not storefronts', () => {
  for (const u of [
    'https://www.facebook.com/somenursery',
    'https://m.facebook.com/x',
    'https://www.instagram.com/almogim123/',
    'https://wa.me/972500000000',
    'https://linktr.ee/nursery',
  ]) {
    assert.equal(isNonStoreHost(u), true, `should be filtered: ${u}`);
  }
});

test('isNonStoreHost: real nursery sites pass through', () => {
  for (const u of [
    'https://decogarden.co.il/',
    'http://www.peer-nursery.co.il/',
    'https://notfacebook.co.il/', // substring, not the domain
    'https://facebook.co.il/', // different TLD
  ]) {
    assert.equal(isNonStoreHost(u), false, `should NOT be filtered: ${u}`);
  }
});
