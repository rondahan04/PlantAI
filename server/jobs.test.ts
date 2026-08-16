import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from './jobs.ts';

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/* Deterministic ids so assertions can name them. */
function ids() {
  let n = 0;
  return () => `job-${++n}`;
}

/* A promise the test resolves by hand, so "still running" is a real state and
 * not a race against a timer. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setImmediate(r));

test('start returns immediately with a running job — it does not await the work', async () => {
  const store = createJobStore<string[]>(clock().now, ids());
  const d = deferred<string[]>();

  const job = store.start('key', () => d.promise);

  assert.equal(job.state, 'running');
  assert.equal(job.id, 'job-1');
  assert.equal(job.result, undefined);
});

test('a finished job exposes its result', async () => {
  const store = createJobStore<string[]>(clock().now, ids());
  const d = deferred<string[]>();
  const job = store.start('key', () => d.promise);

  d.resolve(['nursery-a']);
  await tick();

  assert.equal(job.state, 'done');
  assert.deepEqual(job.result, ['nursery-a']);
  assert.deepEqual(store.get('job-1')?.result, ['nursery-a']);
});

test('a failed job records a stable code and never the provider text', async () => {
  const store = createJobStore<string[]>(clock().now, ids());
  const d = deferred<string[]>();
  const job = store.start('key', () => d.promise);

  d.reject(new Error('Firecrawl 429: you have no credits remaining'));
  await tick();

  assert.equal(job.state, 'error');
  assert.equal(job.errorCode, 'scrape_failed');
  // The whole point: a user waiting on their plant must never be shown a
  // sentence about our unpaid invoice.
  assert.equal(JSON.stringify(job).includes('credits'), false);
});

test('a rejected job does not crash the process', async () => {
  // The run() promise is deliberately not awaited by start(). An unhandled
  // rejection here would take the server down and every other job with it.
  const store = createJobStore<string[]>(clock().now, ids());
  store.start('key', () => Promise.reject(new Error('boom')));
  await tick();
  assert.equal(store.get('job-1')?.state, 'error');
});

test('an identical request while one is in flight joins it instead of buying a second scrape', async () => {
  const store = createJobStore<string[]>(clock().now, ids());
  let runs = 0;
  const d = deferred<string[]>();
  const run = () => {
    runs++;
    return d.promise;
  };

  const first = store.start('monstera|32.085|34.782', run);
  const second = store.start('monstera|32.085|34.782', run);

  assert.equal(first.id, second.id);
  assert.equal(runs, 1, 'the scrape must run exactly once');
});

test('a recently finished job is reused as a result cache', async () => {
  const c = clock();
  const store = createJobStore<string[]>(c.now, ids());
  let runs = 0;
  const run = () => {
    runs++;
    return Promise.resolve(['a']);
  };

  store.start('k', run);
  await tick();
  c.advance(60_000);
  const again = store.start('k', run);

  assert.equal(runs, 1);
  assert.equal(again.state, 'done');
});

test('a FAILED job is retried rather than cached — a retry must be able to work', async () => {
  const store = createJobStore<string[]>(clock().now, ids());
  let runs = 0;
  const run = () => {
    runs++;
    return runs === 1 ? Promise.reject(new Error('transient')) : Promise.resolve(['a']);
  };

  store.start('k', run);
  await tick();
  const retry = store.start('k', run);
  await tick();

  assert.equal(runs, 2, 'the failure must not be cached');
  assert.equal(retry.state, 'done');
});

test('finished jobs are swept after the retention window, in-flight ones never are', async () => {
  const c = clock();
  const store = createJobStore<string[]>(c.now, ids());

  store.start('done-key', () => Promise.resolve(['a']));
  await tick();
  const slow = deferred<string[]>();
  store.start('slow-key', () => slow.promise);

  c.advance(11 * 60_000);

  assert.equal(store.get('job-1'), undefined, 'finished job should be swept');
  assert.equal(store.get('job-2')?.state, 'running', 'a running job must survive');
  assert.equal(store.size(), 1);

  // And once it finishes it becomes collectable, not lost.
  slow.resolve(['b']);
  await tick();
  assert.deepEqual(store.get('job-2')?.result, ['b']);
});

test('a swept job stops deduping, so the next request starts fresh work', async () => {
  const c = clock();
  const store = createJobStore<string[]>(c.now, ids());
  let runs = 0;
  const run = () => {
    runs++;
    return Promise.resolve(['a']);
  };

  store.start('k', run);
  await tick();
  c.advance(11 * 60_000);
  store.start('k', run);
  await tick();

  assert.equal(runs, 2);
});

test('get on an unknown id returns undefined rather than throwing', () => {
  const store = createJobStore<string[]>(clock().now, ids());
  assert.equal(store.get('nope'), undefined);
});
