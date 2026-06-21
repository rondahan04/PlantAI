# Nursery Backend API — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a curl-testable `GET /api/nurseries?plant=&lat=&lng=` endpoint that discovers real nurseries near a point (Google Places, 10km), scrapes each for the plant's price + stock, enriches with Places identity, and returns a `NurseryResult[]` — with keys held server-side.

**Architecture:** A new `scraper/pipeline.ts` extracts the orchestration currently inline in `dashboard/server.ts` into a reusable, **dependency-injected** `runNurserySearch()` (so it unit-tests without network). `scraper/places.ts` gains a wide field mask + photo URL resolution. A new framework-free `server/index.ts` (Node `http`) exposes the endpoint and is containerized for later AWS migration. The existing dashboard is refactored to consume the same `runNurserySearch`, so logic lives in exactly one place.

**Tech Stack:** TypeScript, Node.js built-in `http` + `node:test`, existing `scraper/core.ts` (Firecrawl/Tavily + OpenAI GPT-5.5), Google Places API (New).

**Spec:** `docs/superpowers/specs/2026-06-21-real-nursery-data-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `scraper/places.ts` (modify) | Places discovery; add `richFields` wide mask + `resolvePhotoUrl()`; extend `DiscoveredNursery`. |
| `scraper/pipeline.ts` (create) | `runNurserySearch()` — discovery → scrape → enrich → assemble `NurseryResult[]`; DI seam; haversine; fallbacks. |
| `server/index.ts` (create) | Node `http` server: `GET /api/nurseries`, `GET /health`, CORS. Reads server-side keys. |
| `dashboard/server.ts` (modify) | Refactor `/api/scrape` to call `runNurserySearch` (no duplicated orchestration). |
| `scraper/places.test.ts` (modify) | Tests for wide mask request shape + rich-field parsing. |
| `scraper/pipeline.test.ts` (create) | Tests for `runNurserySearch` with injected deps: assembly, fallbacks, mode, dedup. |
| `Dockerfile` (create) | `node:22-slim`, `CMD ["node","server/index.ts"]` — AWS-portable. |
| `.env.example` (modify) | Document server-side key names. |
| `package.json` (modify) | Add `server` + `test` scripts. |

Test runner is Node's built-in: `node --test <file>` (already used by `scraper/core.test.ts`).

---

## Task 1: Extend `places.ts` with rich fields

**Files:**
- Modify: `scraper/places.ts`
- Test: `scraper/places.test.ts`

- [ ] **Step 1: Write the failing test** — append to `scraper/places.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverNurseries } from './places.ts';

test('richFields widens the field mask and parses rating/hours/phone/photo', async () => {
  let sentMask = '';
  const fakeFetch = (async (_url: string, init: any) => {
    sentMask = init.headers['X-Goog-FieldMask'];
    return {
      ok: true,
      status: 200,
      json: async () => ({
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
      }),
    };
  }) as unknown as typeof fetch;

  const out = await discoverNurseries(32.1, 34.8, 'KEY', { richFields: true }, fakeFetch);

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scraper/places.test.ts`
Expected: FAIL — `out[0].rating` is `undefined` (mask not widened, fields not parsed).

- [ ] **Step 3: Implement** — in `scraper/places.ts`, extend the interface and options, widen the mask, parse the fields.

Replace the `DiscoveredNursery` interface:

```ts
export interface DiscoveredNursery {
  name: string;
  website: string;
  lat: number;
  lng: number;
  address: string;
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  photoName?: string;
}
```

Add to `DiscoverOpts`:

```ts
  richFields?: boolean; // widen field mask: rating, reviews, hours, phone, photo
```

In `discoverNurseries`, after destructuring opts add `richFields = false`, build the mask, and parse:

```ts
  const baseMask =
    'places.displayName,places.location,places.websiteUri,places.formattedAddress';
  const richMask =
    ',places.rating,places.userRatingCount,places.regularOpeningHours,places.nationalPhoneNumber,places.photos';
  const fieldMask = richFields ? baseMask + richMask : baseMask;
```

Use `fieldMask` in the `'X-Goog-FieldMask'` header (replace the inline string). In the result-building loop, after `address`, add:

```ts
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : undefined,
      hours: p.regularOpeningHours?.weekdayDescriptions?.[0] ?? undefined,
      phone: typeof p.nationalPhoneNumber === 'string' ? p.nationalPhoneNumber : undefined,
      photoName: p.photos?.[0]?.name ?? undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scraper/places.test.ts`
Expected: PASS (all assertions, plus the existing places tests still green).

- [ ] **Step 5: Commit**

```bash
git add scraper/places.ts scraper/places.test.ts
git commit -m "feat(scraper): Places rich field mask (rating/hours/phone/photo)"
```

---

## Task 2: Add `resolvePhotoUrl()` to `places.ts`

**Files:**
- Modify: `scraper/places.ts`
- Test: `scraper/places.test.ts`

Resolves a Places photo resource name to a keyless `googleusercontent.com` CDN URL by reading the media endpoint's redirect `Location` header server-side (so no API key reaches the client).

- [ ] **Step 1: Write the failing test** — append to `scraper/places.test.ts`:

```ts
import { resolvePhotoUrl } from './places.ts';

test('resolvePhotoUrl returns the redirect Location for a photo name', async () => {
  const fakeFetch = (async (url: string, init: any) => {
    assert.ok(url.includes('places/ABC/photos/XYZ/media'));
    assert.ok(url.includes('skipHttpRedirect=true') || init?.redirect === 'manual');
    return {
      ok: true,
      status: 200,
      json: async () => ({ photoUri: 'https://lh3.googleusercontent.com/abc' }),
    };
  }) as unknown as typeof fetch;

  const url = await resolvePhotoUrl('places/ABC/photos/XYZ', 'KEY', fakeFetch);
  assert.equal(url, 'https://lh3.googleusercontent.com/abc');
});

test('resolvePhotoUrl returns undefined on failure', async () => {
  const fakeFetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
  const url = await resolvePhotoUrl('places/ABC/photos/XYZ', 'KEY', fakeFetch);
  assert.equal(url, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scraper/places.test.ts`
Expected: FAIL — `resolvePhotoUrl` is not exported.

- [ ] **Step 3: Implement** — add to `scraper/places.ts`. The Places media endpoint with `skipHttpRedirect=true` returns JSON `{ photoUri }` pointing at the keyless CDN URL:

```ts
const PLACES_PHOTO_BASE = 'https://places.googleapis.com/v1/';

/* Resolve a Places photo resource name to a keyless googleusercontent CDN URL.
 * Uses skipHttpRedirect=true so the endpoint returns { photoUri } as JSON
 * instead of a 302; that URI needs no API key and is safe to send to clients.
 * Never throws — returns undefined so the card falls back to a placeholder. */
export async function resolvePhotoUrl(
  photoName: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  maxWidthPx = 800
): Promise<string | undefined> {
  try {
    const url =
      `${PLACES_PHOTO_BASE}${photoName}/media` +
      `?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res.ok) return undefined;
    const data = await res.json();
    return typeof data.photoUri === 'string' ? data.photoUri : undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scraper/places.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scraper/places.ts scraper/places.test.ts
git commit -m "feat(scraper): resolvePhotoUrl — keyless Places photo CDN URL"
```

---

## Task 3: `pipeline.ts` — `NurseryResult` type, haversine, and `runNurserySearch` core

**Files:**
- Create: `scraper/pipeline.ts`
- Test: `scraper/pipeline.test.ts`

`runNurserySearch` takes an injectable `deps` object so tests run with no network. Defaults wire the real `core.ts` / `places.ts` functions.

- [ ] **Step 1: Write the failing test** — create `scraper/pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runNurserySearch, type PipelineDeps } from './pipeline.ts';

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    discover: async () => [
      { name: 'Green House', website: 'https://gh.example/', lat: 32.10, lng: 34.80,
        address: '1 Sokolov St', rating: 4.7, reviewCount: 143, hours: 'Sun 9-19',
        phone: '03-1', photoName: 'places/A/photos/B' },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scraper/pipeline.test.ts`
Expected: FAIL — cannot find module `./pipeline.ts`.

- [ ] **Step 3: Implement** — create `scraper/pipeline.ts`:

```ts
/*
 * Nursery search orchestration, extracted from dashboard/server.ts so the API
 * server and the dashboard share one implementation. Dependency-injected for
 * hermetic unit tests: real network functions are the defaults.
 */
import {
  createSearcher,
  extractAndVerifyPlants,
  inferAvailabilityLLM,
  scrapeUrl,
  type PipelineResult,
} from './core.ts';
import { discoverNurseries, resolvePhotoUrl, type DiscoveredNursery } from './places.ts';

export interface NurseryResult {
  id: string;
  name: string;
  website: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number; // Infinity when coordinates are unknown (fallback list)
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  image?: string;
  plantPrice: string; // '₪XX' or '—'
  hasPlant: boolean; // a real in-stock product was scraped
  inStockKnown: boolean; // we have an exact listing (vs an LLM estimate)
  availabilityNote?: string; // estimate text when inStockKnown is false
  shipsToHome: boolean; // national fallback (Deliver tab) vs local (Pick Up tab)
}

export interface SearchInput {
  plantName: string;
  lat: number;
  lng: number;
  radiusM?: number;
}

export interface PipelineDeps {
  discover: (lat: number, lng: number, radiusM: number) => Promise<DiscoveredNursery[]>;
  search: (website: string, query: string, host: string) =>
    Promise<{ md: string; platform: string; picked: string | null }>;
  extract: (opts: { markdown: string; query: string; site: string }) => Promise<PipelineResult>;
  scrapeHome: (origin: string) => Promise<string>;
  infer: (homeMd: string, query: string, site: string) =>
    Promise<{ confidence: number; reasoning: string }>;
  resolvePhoto: (photoName: string) => Promise<string | undefined>;
  readFallbackUrls: () => string[]; // nurseries_scraping_testing
  nationalUrls: string[]; // ship-to-home shippers
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

/* Scrape one nursery for the plant and fold the scraper output into the
 * identity we already have from Places (or the fallback list). */
async function scrapeOne(
  n: DiscoveredNursery,
  input: SearchInput,
  deps: PipelineDeps,
  shipsToHome: boolean
): Promise<NurseryResult> {
  const host = hostOf(n.website);
  const base: NurseryResult = {
    id: host,
    name: n.name || host,
    website: n.website,
    address: n.address,
    lat: n.lat,
    lng: n.lng,
    distanceKm: n.lat && n.lng ? haversineKm(input.lat, input.lng, n.lat, n.lng) : Infinity,
    rating: n.rating,
    reviewCount: n.reviewCount,
    hours: n.hours,
    phone: n.phone,
    image: n.photoName ? await deps.resolvePhoto(n.photoName) : undefined,
    plantPrice: '—',
    hasPlant: false,
    inStockKnown: false,
    shipsToHome,
  };

  try {
    const { md } = await deps.search(n.website, input.plantName, host);
    const { plants } = await deps.extract({ markdown: md, query: input.plantName, site: host });
    if (plants.length > 0) {
      const best = plants[0];
      return {
        ...base,
        plantPrice: best.price,
        hasPlant: best.availability !== 'out_of_stock',
        inStockKnown: true,
      };
    }
    // 0 structured items → estimate from the homepage.
    let homeMd = '';
    try {
      homeMd = await deps.scrapeHome(new URL(n.website).origin);
    } catch {
      /* unreachable → infer('') yields 0% */
    }
    const est = await deps.infer(homeMd, input.plantName, host);
    return { ...base, availabilityNote: `~${est.confidence}% · ${est.reasoning}` };
  } catch (err: any) {
    return { ...base, availabilityNote: `unavailable (${err.message})` };
  }
}

export async function runNurserySearch(
  input: SearchInput,
  deps: PipelineDeps
): Promise<NurseryResult[]> {
  const radiusM = input.radiusM ?? 10000;

  // 1. Discover local nurseries (Places). Empty → fallback URL list.
  let discovered = await deps.discover(input.lat, input.lng, radiusM);
  if (discovered.length === 0) {
    discovered = deps.readFallbackUrls().map((url) => ({
      name: hostOf(url),
      website: url,
      lat: 0,
      lng: 0,
      address: '',
    }));
  }

  // 2. Scrape each (local = pickup).
  const local = await Promise.all(discovered.map((n) => scrapeOne(n, input, deps, false)));

  // 3. National ship-to-home fallback when no local nursery has a real product.
  let national: NurseryResult[] = [];
  const localHosts = new Set(discovered.map((n) => hostOf(n.website)));
  if (!local.some((n) => n.hasPlant)) {
    const natUrls = deps.nationalUrls.filter((u) => !localHosts.has(hostOf(u)));
    national = await Promise.all(
      natUrls.map((url) =>
        scrapeOne({ name: hostOf(url), website: url, lat: 0, lng: 0, address: '' }, input, deps, true)
      )
    );
  }

  // 4. Dedup by id, sort: in-stock first, then by distance.
  const seen = new Set<string>();
  return [...local, ...national]
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => {
      if (a.hasPlant !== b.hasPlant) return a.hasPlant ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scraper/pipeline.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add scraper/pipeline.ts scraper/pipeline.test.ts
git commit -m "feat(scraper): runNurserySearch pipeline (DI seam, haversine, estimate fold)"
```

---

## Task 4: `pipeline.ts` — empty-discovery fallback + ship-to-home tests

**Files:**
- Test: `scraper/pipeline.test.ts` (the production code already implements these; this task locks them with tests)

- [ ] **Step 1: Write the failing tests** — append to `scraper/pipeline.test.ts`:

```ts
test('empty Places discovery falls back to the testing URL list', async () => {
  let usedFallback = false;
  const out = await runNurserySearch(
    { plantName: 'monstera', lat: 32.0853, lng: 34.7818 },
    makeDeps({
      discover: async () => [],
      readFallbackUrls: () => { usedFallback = true; return ['https://seed.example/']; },
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
```

- [ ] **Step 2: Run tests**

Run: `node --test scraper/pipeline.test.ts`
Expected: PASS — production code from Task 3 already satisfies these (this task proves the fallbacks).
If either fails, fix `runNurserySearch` per the Task 3 implementation (do not edit the tests to pass).

- [ ] **Step 3: Commit**

```bash
git add scraper/pipeline.test.ts
git commit -m "test(scraper): empty-discovery + ship-to-home fallbacks"
```

---

## Task 5: `server/index.ts` — the API server

**Files:**
- Create: `server/index.ts`
- Modify: `package.json` (scripts)

Wires the real `core.ts`/`places.ts` functions into `PipelineDeps`, reads keys from server env, serves JSON.

- [ ] **Step 1: Implement** — create `server/index.ts`:

```ts
#!/usr/bin/env node
/*
 * Nursery API server. GET /api/nurseries?plant=&lat=&lng=&radius= → NurseryResult[].
 * Keys are read from server env (plain names preferred, EXPO_PUBLIC_* fallback
 * for local dev). Framework-free (Node http) so it containerizes for AWS.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  loadEnv,
  createSearcher,
  extractAndVerifyPlants,
  inferAvailabilityLLM,
  scrapeUrl,
} from '../scraper/core.ts';
import { discoverNurseries, resolvePhotoUrl } from '../scraper/places.ts';
import { runNurserySearch, type PipelineDeps } from '../scraper/pipeline.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4000;

loadEnv(path.join(ROOT, '.env'));
const env = (k: string) => process.env[k] || process.env[`EXPO_PUBLIC_${k}`];
const FIRECRAWL_KEY = env('FIRECRAWL_API_KEY');
const OPENAI_KEY = env('OPENAI_API_KEY');
const TAVILY_KEY = env('TAVILY_API_KEY');
const GOOGLE_KEY = env('GOOGLE_MAPS_API_KEY');

if (!FIRECRAWL_KEY || !OPENAI_KEY || !GOOGLE_KEY) {
  console.error('Missing FIRECRAWL_API_KEY / OPENAI_API_KEY / GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

const NATIONAL_NURSERIES = [
  'https://al-haderech.co.il/',
  'https://rootine.co.il/',
  'https://www.peer-nursery.co.il/',
  'https://www.plantit.co.il/',
  'https://netaplants.co.il/',
  'https://decogarden.co.il/',
];

const searcher = createSearcher(FIRECRAWL_KEY, {
  openaiKey: OPENAI_KEY,
  learnedFile: path.join(ROOT, 'scraper', 'learned-platforms.json'),
  tavilyKey: TAVILY_KEY,
});

const deps: PipelineDeps = {
  discover: (lat, lng, radiusM) =>
    discoverNurseries(lat, lng, GOOGLE_KEY!, { radiusM, richFields: true }),
  search: (website, query, host) => searcher.fetchSearchMarkdown(website, query, host),
  extract: (o) => extractAndVerifyPlants({ ...o, openaiKey: OPENAI_KEY }),
  scrapeHome: (origin) => scrapeUrl(origin, FIRECRAWL_KEY!, { tavilyKey: TAVILY_KEY }),
  infer: (homeMd, query, site) => inferAvailabilityLLM(homeMd, query, site, OPENAI_KEY!),
  resolvePhoto: (photoName) => resolvePhotoUrl(photoName, GOOGLE_KEY!),
  readFallbackUrls: () =>
    fs
      .readFileSync(path.join(ROOT, 'nurseries_scraping_testing'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http')),
  nationalUrls: NATIONAL_NURSERIES,
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (u.pathname === '/api/nurseries') {
    const plant = u.searchParams.get('plant') ?? '';
    const lat = Number(u.searchParams.get('lat'));
    const lng = Number(u.searchParams.get('lng'));
    const radiusM = Number(u.searchParams.get('radius')) || 10000;
    if (!plant || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'plant, lat, lng are required' }));
      return;
    }
    try {
      const results = await runNurserySearch({ plantName: plant, lat, lng, radiusM }, deps);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Nursery API → http://localhost:${PORT}`));
```

- [ ] **Step 2: Add scripts** — in `package.json` `"scripts"`, add:

```json
    "server": "node server/index.ts",
    "test": "node --test scraper/*.test.ts"
```

- [ ] **Step 3: Smoke test (manual, needs network + keys)**

Run (terminal A): `npm run server`
Expected: `Nursery API → http://localhost:4000`

Run (terminal B): `curl 'http://localhost:4000/health'`
Expected: `ok`

Run (terminal B): `curl 'http://localhost:4000/api/nurseries?plant=monstera&lat=32.0853&lng=34.7818'`
Expected: JSON array of nursery objects with `name`, `plantPrice`, `distanceKm`, `shipsToHome`. (30–60s.)

Run: `curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:4000/api/nurseries?plant=monstera'`
Expected: `400` (missing lat/lng).

- [ ] **Step 4: Commit**

```bash
git add server/index.ts package.json
git commit -m "feat(server): nursery API (GET /api/nurseries, /health, CORS)"
```

---

## Task 6: Refactor `dashboard/server.ts` onto `runNurserySearch`

**Files:**
- Modify: `dashboard/server.ts`

Keep the dashboard working but delete its duplicated orchestration, delegating to the shared pipeline. The dashboard's HTML table can render `NurseryResult[]` (name, plantPrice, availabilityNote, site=host).

- [ ] **Step 1: Replace the `/api/scrape` handler body** — build the same `deps` object as `server/index.ts` (import `runNurserySearch`), and for the discovery path call `runNurserySearch({ plantName: query, lat, lng })`. Remove the now-unused `handleScrape`, `NATIONAL_NURSERIES`, and `Row` duplication from `dashboard/server.ts`; map `NurseryResult[]` to the existing table rows:

```ts
const rows = results.map((n) => ({
  site: n.id,
  name: n.hasPlant ? n.name : `${query} (estimate)`,
  price: n.plantPrice,
  availability: n.inStockKnown ? 'in stock' : (n.availabilityNote ?? '—'),
  estimate: !n.inStockKnown,
  shipsToHome: n.shipsToHome,
}));
```

(The non-discovery path — blank location — can keep reading `nurseries_scraping_testing` and pass those as a zero-coord discovery via a small local deps override, or simply require a location now. Choose the minimal change that keeps `node dashboard/server.ts` booting.)

- [ ] **Step 2: Verify the dashboard still boots**

Run: `node dashboard/server.ts`
Expected: `Scraper dashboard running -> http://localhost:4000` with no import/type errors. Ctrl-C.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/server.ts
git commit -m "refactor(dashboard): delegate scraping to shared runNurserySearch"
```

---

## Task 7: `Dockerfile` + env docs (AWS-portable)

**Files:**
- Create: `Dockerfile`
- Modify: `.env.example`

- [ ] **Step 1: Create `Dockerfile`:**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY scraper ./scraper
COPY server ./server
COPY nurseries_scraping_testing ./nurseries_scraping_testing
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.ts"]
```

- [ ] **Step 2: Document server keys** — append to `.env.example`:

```
# --- Server-side only (NOT bundled into the app) ---
# The API server reads these; falls back to the EXPO_PUBLIC_* equivalents in dev.
FIRECRAWL_API_KEY=
OPENAI_API_KEY=
GOOGLE_MAPS_API_KEY=
TAVILY_API_KEY=
```

- [ ] **Step 3: Build sanity check (optional, needs Docker):**

Run: `docker build -t plantai-api .`
Expected: builds clean. (Skip if Docker unavailable; note it in the commit.)

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .env.example
git commit -m "chore(server): Dockerfile + server-side env docs (AWS-portable)"
```

---

## Self-Review

**Spec coverage:**
- Backend API service, keys server-side → Tasks 5, 7. ✅
- Places wide field mask (rating/reviews/hours/phone/photo) → Task 1. ✅
- Photo resolved server-side, keyless → Task 2. ✅
- `runNurserySearch` nursery-grouped, shared by dashboard + server → Tasks 3, 6. ✅
- 10km radius default → Task 3 (`radiusM ?? 10000`), Task 5 (query default). ✅
- Empty-discovery fallback to `nurseries_scraping_testing` → Tasks 3, 4. ✅
- National ship-to-home fallback + mode classification (local=pickup, national=deliver via `shipsToHome`) → Tasks 3, 4. ✅
- In-memory cache (TTL ~15min) → **deferred to Plan 2 integration or a follow-up** (noted; not required for a working API). ⚠️
- App integration (types, service, screens) → **Plan 2** (out of scope here). ✅ by decomposition.

**Placeholder scan:** No TBD/TODO; all code blocks are complete. The dashboard non-discovery path (Task 6 Step 1) intentionally allows a minimal choice — flagged, not a silent gap.

**Type consistency:** `NurseryResult`, `PipelineDeps`, `SearchInput` defined in Task 3 and consumed unchanged in Tasks 4–6. `DiscoveredNursery` extended in Task 1 and used by `pipeline.ts`/`server`. `resolvePhotoUrl` signature consistent across Tasks 2, 3, 5.

**Note on the deferred cache:** added as an explicit follow-up rather than silently dropped — `runNurserySearch` is a pure function of its inputs, so a memoizing wrapper in `server/index.ts` can be added later without touching the pipeline.

---

## Next

Plan 2 (App Integration) covers: `Nursery` type changes, `fetchNearbyNurseries`, `NurseriesScreen` self-fetch + loading/empty/error states, `DiagnosisScreen` trim, and `EXPO_PUBLIC_API_BASE_URL`.
