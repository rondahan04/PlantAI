import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasInlineResults } from './jobResponse.ts';

/*
 * The bug this exists to stop, measured in the simulator 2026-09-13.
 *
 * POST /api/nurseries dedupes: an identical search that already finished
 * returns the EXISTING job, and the response is `{ jobId, state: 'done' }` with
 * no results in it. The client tested `state === 'done'` first, took that as
 * "the server handed me the results inline", found none, and rendered
 * "No nurseries found nearby" - having been told about 23 nurseries.
 *
 * It is not a rare path. Any repeat of the same search inside the job retention
 * window lands on it: tapping Search again, reopening the screen, or a second
 * device asking the same question.
 *
 * A `done` with no results array is a job to COLLECT, never an empty area.
 */

test('inline results are only inline when they are actually there', () => {
  assert.equal(hasInlineResults({ state: 'done', results: [{ id: 'a' }] }), true);
  assert.equal(
    hasInlineResults({ state: 'done', results: [] }),
    true,
    'a genuinely empty area is a real answer and must stay distinguishable from a lost one'
  );
});

test('a deduped done job is a job to collect, not an empty area', () => {
  assert.equal(
    hasInlineResults({ jobId: 'abc', state: 'done' }),
    false,
    'this is the exact server response that emptied the screen'
  );
  assert.equal(hasInlineResults({ state: 'done' }), false);
  assert.equal(hasInlineResults({ state: 'done', results: null }), false);
  assert.equal(hasInlineResults({ state: 'done', results: 'nope' }), false);
});

test('a running job is never inline results', () => {
  assert.equal(hasInlineResults({ jobId: 'abc', state: 'running' }), false);
  assert.equal(hasInlineResults({}), false);
  assert.equal(hasInlineResults(null), false);
  assert.equal(hasInlineResults(undefined), false);
});
