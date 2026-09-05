import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiagnosisFailure } from './diagnosisFailure.ts';

test('the codes the server actually sends map to their own outcomes', () => {
  assert.equal(classifyDiagnosisFailure(422, 'not_a_plant'), 'not_a_plant');
  assert.equal(classifyDiagnosisFailure(415, 'unsupported_image'), 'unsupported_image');
  assert.equal(classifyDiagnosisFailure(413, 'payload_too_large'), 'photo_too_large');
});

test('a bare 413 with no code is still a too-large photo', () => {
  // A proxy or platform layer can answer 413 with an HTML body, and
  // readApiError then reports `http_413` with no machine code at all. The user
  // is in exactly the same situation either way.
  assert.equal(classifyDiagnosisFailure(413, 'http_413'), 'photo_too_large');
});

test('a too-large photo is never reported as a service failure', () => {
  // This is the regression under test. It used to fall through to the generic
  // branch, which renders "the plant service did not answer" - and upstream of
  // that, a torn-down request rendered as a lost network connection. Both told
  // the user to check their wifi about a file that fails on any connection.
  assert.notEqual(classifyDiagnosisFailure(413, 'payload_too_large'), 'service');
});

test('a genuine server failure stays ours to own', () => {
  assert.equal(classifyDiagnosisFailure(502, 'diagnosis_failed'), 'service');
  assert.equal(classifyDiagnosisFailure(503, 'daily_cap'), 'service');
  assert.equal(classifyDiagnosisFailure(401, 'unauthorized'), 'service');
});

test('an unknown code degrades to a service failure, never to a guess', () => {
  // A code added server-side later must not be silently classified as a
  // problem with the user's photo - blaming the photo for our outage is the
  // failure mode E9 exists to prevent.
  assert.equal(classifyDiagnosisFailure(500, 'some_future_code'), 'service');
  assert.equal(classifyDiagnosisFailure(400, ''), 'service');
});
