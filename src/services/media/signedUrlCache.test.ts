import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedUrlCache, DEFAULT_TTL_MS } from './signedUrlCache.ts';

/*
 * The bug this exists to stop: one signing round trip per plant, on every read,
 * with nothing remembering the answer. Thirty plants meant thirty HTTPS
 * requests before a single photo could paint, and thirty more a minute later.
 */

test('a freshly signed URL is reused rather than re-requested', () => {
  let clock = 1_000;
  const c = createSignedUrlCache({ now: () => clock });
  c.put('u1/a.jpg', 'https://signed/a');

  assert.equal(c.get('u1/a.jpg'), 'https://signed/a');
  assert.deepEqual(c.missing(['u1/a.jpg']), [], 'nothing to ask for');
});

test('missing() asks only for what is not already held', () => {
  const c = createSignedUrlCache({ now: () => 1_000 });
  c.put('a.jpg', 'https://signed/a');

  // The realistic shape: one new plant among many already-signed ones.
  assert.deepEqual(c.missing(['a.jpg', 'b.jpg', 'c.jpg']), ['b.jpg', 'c.jpg']);
});

test('one path is never asked for twice in the same batch', () => {
  // Two plants sharing a photo path would otherwise put the same signature
  // request in the batch twice.
  const c = createSignedUrlCache({ now: () => 1_000 });
  assert.deepEqual(c.missing(['same.jpg', 'same.jpg', 'other.jpg']), ['same.jpg', 'other.jpg']);
});

test('nulls and empty paths are not requests', () => {
  const c = createSignedUrlCache({ now: () => 1_000 });
  assert.deepEqual(c.missing(['', 'real.jpg']), ['real.jpg']);
});

test('a URL is re-signed BEFORE it expires, not after', () => {
  // A URL that dies mid-scroll renders as a broken image with no way back
  // until the next refresh. Re-signing early costs nothing - it rides along in
  // a batch we were already sending.
  let clock = 0;
  const c = createSignedUrlCache({ ttlMs: 60 * 60_000, skewMs: 5 * 60_000, now: () => clock });
  c.put('a.jpg', 'https://signed/a');

  clock = 50 * 60_000; // 10 minutes of life left - still fine
  assert.equal(c.get('a.jpg'), 'https://signed/a');

  clock = 56 * 60_000; // inside the 5-minute skew
  assert.equal(c.get('a.jpg'), null);
  assert.deepEqual(c.missing(['a.jpg']), ['a.jpg']);
});

test('an expired entry is dropped, not left to be re-checked forever', () => {
  let clock = 0;
  const c = createSignedUrlCache({ now: () => clock });
  c.put('a.jpg', 'https://signed/a');
  assert.equal(c.size(), 1);

  clock = DEFAULT_TTL_MS + 1;
  c.get('a.jpg');
  assert.equal(c.size(), 0);
});

test('clear() drops everything - sign-out must not leave a live bucket reader', () => {
  // A signed URL is a capability to read a private object. Surviving sign-out
  // means a reader for an account nobody is signed into any more.
  const c = createSignedUrlCache({ now: () => 1_000 });
  c.put('a.jpg', 'https://signed/a');
  c.put('b.jpg', 'https://signed/b');

  c.clear();

  assert.equal(c.size(), 0);
  assert.equal(c.get('a.jpg'), null);
  assert.deepEqual(c.missing(['a.jpg', 'b.jpg']), ['a.jpg', 'b.jpg']);
});

test('a second read of the same library asks for nothing', () => {
  // The whole point, stated as the scenario: open Portfolio, leave, come back.
  const c = createSignedUrlCache({ now: () => 1_000 });
  const paths = Array.from({ length: 30 }, (_, i) => `u1/p${i}.jpg`);

  const firstAsk = c.missing(paths);
  assert.equal(firstAsk.length, 30, 'cold cache asks once for all of them');
  for (const p of firstAsk) c.put(p, `https://signed/${p}`);

  assert.deepEqual(c.missing(paths), [], 'warm cache asks for nothing');
});
