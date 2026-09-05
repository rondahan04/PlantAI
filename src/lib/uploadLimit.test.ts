import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exceedsUploadLimit,
  megabytes,
  MAX_PHOTO_BYTES,
  SERVER_MAX_BODY_BYTES,
} from './uploadLimit.ts';

/*
 * The bug being fixed: a full-resolution gallery photo exceeded the server's
 * 12 MB cap, React Native tore the request down mid-body so the 413 was never
 * read, and the user was told "the network connection was lost" - advice about
 * their wifi for a file that fails identically on every connection.
 */

test('a normal camera photo is nowhere near the limit', () => {
  // ~2 MB encoded, which is what quality: 0.7 capture produces.
  assert.equal(exceedsUploadLimit(2 * 1024 * 1024), false);
});

test('the gallery photo that actually broke production is refused', () => {
  // A 12 MB file encodes to ~16 MB of base64 - the case from 2026-08-22.
  assert.equal(exceedsUploadLimit(16 * 1024 * 1024), true);
});

test('the client limit never exceeds the server cap', () => {
  // The one invariant that matters: over it, the original bug is back, because
  // the client would happily start an upload the server will refuse.
  assert.equal(exceedsUploadLimit(SERVER_MAX_BODY_BYTES), true);
  assert.ok(MAX_PHOTO_BYTES < SERVER_MAX_BODY_BYTES);
});

test('the envelope counts - a body just under the cap still exceeds it', () => {
  // The image is not the whole request. Comparing the image alone against the
  // cap passes a payload that is over it once the JSON is wrapped around it.
  assert.equal(exceedsUploadLimit(SERVER_MAX_BODY_BYTES - 1), true);
  assert.equal(exceedsUploadLimit(SERVER_MAX_BODY_BYTES - 1024), false);
});

test('an empty read is not a size failure', () => {
  // A zero-byte read is a broken file, and it must reach the service error
  // rather than being reported to the user as a too-large photo.
  assert.equal(exceedsUploadLimit(0), false);
});

test('sizes render for humans', () => {
  assert.equal(megabytes(2 * 1024 * 1024), '2.0 MB');
  assert.equal(megabytes(SERVER_MAX_BODY_BYTES), '12.0 MB');
});

test('a size just over the limit never renders as equal to the limit', () => {
  // Caught by this test, not by review: at one decimal ROUNDED, 40 KB over
  // 12 MB still prints "12.0 MB", so the copy read "that image is 12.0 MB and
  // the limit is 12.0 MB" - which describes a broken app, not an oversized
  // photo. Rounding up is what makes the sentence impossible.
  assert.notEqual(megabytes(SERVER_MAX_BODY_BYTES + 40_000), '12.0 MB');
  assert.equal(megabytes(SERVER_MAX_BODY_BYTES + 40_000), '12.1 MB');
});
