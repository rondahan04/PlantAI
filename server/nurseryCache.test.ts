import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNurseryCache, searchKey, DEFAULT_TTL_MS } from './nurseryCache.ts';

const PARTS = { query: 'Confidor', lat: 32.08531, lng: 34.78177, radiusM: 10000 };

function cache(opts: {
  respond: (url: string, init: RequestInit) => Response | Promise<Response>;
  now?: () => number;
  ttlMs?: number;
  calls?: { url: string; init: RequestInit }[];
}) {
  return createNurseryCache<unknown[]>({
    url: 'https://p.supabase.co',
    serviceKey: 'service-key',
    ttlMs: opts.ttlMs,
    now: opts.now ?? (() => 1_000_000),
    onError: () => {},
    fetchImpl: (async (url: string, init: RequestInit) => {
      opts.calls?.push({ url: String(url), init });
      return opts.respond(String(url), init);
    }) as unknown as typeof fetch,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('the key ignores differences that are not a different search', () => {
  // ~100m of GPS jitter and a capitalised term must not buy a second scrape.
  assert.equal(
    searchKey({ query: 'Confidor', lat: 32.0853, lng: 34.7817, radiusM: 10000 }),
    searchKey({ query: '  confidor ', lat: 32.08534, lng: 34.78172, radiusM: 10000 })
  );
});

test('a different radius is a different search', () => {
  assert.notEqual(searchKey(PARTS), searchKey({ ...PARTS, radiusM: 5000 }));
});

test('with no service key the cache is off and never calls out', async () => {
  let called = false;
  const off = createNurseryCache<unknown[]>({
    url: 'https://p.supabase.co',
    fetchImpl: (async () => {
      called = true;
      return json([]);
    }) as unknown as typeof fetch,
  });
  assert.equal(off.enabled, false);
  assert.equal(await off.get(PARTS), null);
  await off.put(PARTS, []);
  assert.equal(called, false);
});

test('a fresh row is a hit, carrying the age of the scrape', async () => {
  const c = cache({
    respond: () => json([{ results: [{ id: 'a' }], scraped_at: new Date(900_000).toISOString() }]),
  });
  const hit = await c.get(PARTS);
  assert.deepEqual(hit?.results, [{ id: 'a' }]);
  assert.equal(hit?.scrapedAt, 900_000);
});

test('a row older than the TTL is a miss, not a stale answer', async () => {
  const c = cache({
    now: () => DEFAULT_TTL_MS + 2_000,
    respond: () => json([{ results: [{ id: 'a' }], scraped_at: new Date(1_000).toISOString() }]),
  });
  assert.equal(await c.get(PARTS), null);
});

test('an empty table is a miss', async () => {
  const c = cache({ respond: () => json([]) });
  assert.equal(await c.get(PARTS), null);
});

test('a row with an unreadable timestamp is a miss - unknown age is not fresh', async () => {
  const c = cache({ respond: () => json([{ results: [], scraped_at: 'not-a-date' }]) });
  assert.equal(await c.get(PARTS), null);
});

test('a cache outage is a miss, never a thrown error', async () => {
  const down = cache({
    respond: () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(await down.get(PARTS), null);
  await down.put(PARTS, []); // must not throw either

  const broken = cache({ respond: () => json({ message: 'boom' }, 500) });
  assert.equal(await broken.get(PARTS), null);
});

test('a write upserts the normalised row so a re-scrape replaces the stale one', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const c = cache({ calls, respond: () => new Response(null, { status: 201 }) });
  await c.put(PARTS, [{ id: 'a' }]);

  const [call] = calls;
  assert.match(call.url, /on_conflict=key/);
  assert.equal(call.init.method, 'POST');
  const headers = call.init.headers as Record<string, string>;
  assert.match(headers.Prefer, /merge-duplicates/);

  const row = JSON.parse(String(call.init.body));
  assert.equal(row.key, searchKey(PARTS));
  assert.equal(row.query, 'confidor');
  assert.equal(row.lat, 32.085);
  assert.equal(row.result_count, 1);
  assert.equal(row.scraped_at, new Date(1_000_000).toISOString());
});
