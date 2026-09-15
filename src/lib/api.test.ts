/**
 * Unit tests for the API client's failure classification.
 * Run: node --test src/lib/api.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiHttpError, isPermanentStatus } from './api.ts';

/*
 * The distinction that matters: a caller may remember a PERMANENT failure and
 * stop retrying it, and must not remember a transient one. Getting this wrong
 * in the direction of "permanent" is how a sleeping server's cold start turned
 * into a plant that never translated again until the app was force-quit.
 */
test('a rejection the server will repeat is permanent', () => {
  assert.ok(isPermanentStatus(400), 'malformed request will be malformed next time');
  assert.ok(isPermanentStatus(401), 'the key is wrong and will stay wrong');
  assert.ok(isPermanentStatus(413), 'the payload is too big and will not shrink');
});

test('a rejection that is about right now is NOT permanent', () => {
  assert.ok(!isPermanentStatus(429), 'over the rate limit this minute, not forever');
  assert.ok(!isPermanentStatus(408), 'the request timed out, which is a moment not a verdict');
});

test('a server-side failure is never permanent', () => {
  assert.ok(!isPermanentStatus(500));
  assert.ok(!isPermanentStatus(502), 'the provider did not answer - it may next time');
  assert.ok(!isPermanentStatus(503), 'a service waking up says nothing about the request');
});

/* An aborted fetch and a dropped connection arrive as a plain Error with no
 * status at all. Those are the cold-start case, and must never be remembered. */
test('a failure with no status is not permanent', () => {
  assert.ok(!isPermanentStatus(undefined));
  assert.ok(!isPermanentStatus(0));
});

test('ApiHttpError carries the status so a caller can classify it', () => {
  const err = new ApiHttpError(429, 'rate_limited', 'Slow down.');
  assert.equal(err.status, 429);
  assert.equal(err.code, 'rate_limited');
  assert.ok(err.message.includes('429'));
  assert.ok(err.message.includes('rate_limited'));
  assert.ok(!isPermanentStatus(err.status));
});
