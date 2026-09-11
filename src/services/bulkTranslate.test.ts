/**
 * Unit tests for the library translation pass.
 * Run: node --test src/services/bulkTranslate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBulkTranslate } from './bulkTranslate.ts';

const plant = (id: string): any => ({
  id,
  savedAt: '2026-09-01T00:00:00.000Z',
  photoUri: `file:///${id}.jpg`,
  diagnosis: { description: 'English prose', issues: [], treatments: [] },
});

const deps = (over: Partial<Parameters<typeof createBulkTranslate>[0]> = {}) => {
  const waits: number[] = [];
  const saved: string[] = [];
  return {
    waits,
    saved,
    d: {
      translate: async (_id: string, d: any) => ({ ...d, lang: 'he' }),
      attach: async (id: string) => {
        saved.push(id);
        return { ok: true };
      },
      wait: async (ms: number) => {
        waits.push(ms);
      },
      nameOf: (p: any) => p.id,
      ...over,
    },
  };
};

test('every plant is translated and saved, and the row counts them', async () => {
  const { d, saved } = deps();
  const job = createBulkTranslate(d);
  const out = await job.run([plant('a'), plant('b'), plant('c')]);

  assert.equal(out.state, 'done');
  assert.equal(out.total, 3);
  assert.equal(out.done, 3);
  assert.equal(out.failed, 0);
  assert.deepEqual(saved, ['a', 'b', 'c']);
});

/*
 * The gate allows a handful of billable requests a minute per device. Firing a
 * whole library at once earns 429s for most of it.
 */
test('paid calls are paced, and the last one is not followed by a wait', async () => {
  const { d, waits } = deps();
  await createBulkTranslate(d).run([plant('a'), plant('b'), plant('c')]);
  assert.equal(waits.length, 2, 'two gaps between three requests, none trailing');
});

/*
 * A cache hit costs nothing, so pacing behind it would make an already-paid-for
 * library crawl through gaps it never needed.
 */
test('a cached plant is counted done and is NOT paced', async () => {
  const { d, waits, saved } = deps({ translate: async () => null });
  const out = await createBulkTranslate(d).run([plant('a'), plant('b'), plant('c')]);

  assert.equal(out.done, 3);
  assert.equal(out.failed, 0);
  assert.equal(waits.length, 0, 'nothing was billed, so nothing to pace');
  assert.deepEqual(saved, [], 'and nothing needed rewriting');
});

/*
 * Aborting the batch over one plant would punish the ones behind it.
 */
test('one failure is counted and the run carries on', async () => {
  const { d, saved } = deps({
    translate: async (id: string, dg: any) => {
      if (id === 'b') throw new Error('429');
      return { ...dg, lang: 'he' };
    },
  });
  const out = await createBulkTranslate(d).run([plant('a'), plant('b'), plant('c')]);

  assert.equal(out.done, 2);
  assert.equal(out.failed, 1);
  assert.deepEqual(saved, ['a', 'c']);
});

/*
 * The paid call succeeded but the record on disk is unchanged - counting that
 * as done means paying for it again on the next launch.
 */
test('a translation that could not be saved is a failure, not a success', async () => {
  const { d } = deps({ attach: async () => ({ ok: false }) });
  const out = await createBulkTranslate(d).run([plant('a')]);
  assert.equal(out.done, 0);
  assert.equal(out.failed, 1);
});

/*
 * This fires from a screen that can mount more than once. A remount must not
 * double-spend the budget.
 */
test('a second run while one is going is ignored', async () => {
  let calls = 0;
  const { d } = deps({
    translate: async (_id: string, dg: any) => {
      calls++;
      return { ...dg, lang: 'he' };
    },
    wait: async () => {},
  });
  const job = createBulkTranslate(d);
  const first = job.run([plant('a'), plant('b')]);
  const second = await job.run([plant('c')]);
  await first;

  assert.equal(second.state, 'running', 'the second call saw the job and left it alone');
  assert.equal(calls, 2, "'c' was never started");
});

/*
 * The common case is nothing to do. A progress row that flashes and vanishes
 * on every launch would be worse than no row.
 */
test('an empty selection never enters running, so no row appears', async () => {
  const { d } = deps();
  const job = createBulkTranslate(d);
  const out = await job.run([]);
  assert.equal(out.state, 'idle');
});

test('cancel stops the run, and dismiss clears a finished one', async () => {
  const { d, saved } = deps({ wait: async () => {} });
  const job = createBulkTranslate(d);
  const unsub = job.subscribe((p) => {
    if (p.done === 1) job.cancel();
  });
  await job.run([plant('a'), plant('b'), plant('c')]);
  unsub();

  assert.deepEqual(saved, ['a'], 'stopped after the in-flight one landed');
  assert.equal(job.get().state, 'done');
  job.dismiss();
  assert.equal(job.get().state, 'idle');
});

test('a screen mounting mid-job is handed the job immediately', async () => {
  const { d } = deps({ wait: async () => {} });
  const job = createBulkTranslate(d);
  const seen: string[] = [];
  const run = job.run([plant('a'), plant('b')]);
  job.subscribe((p) => seen.push(p.state));
  await run;
  assert.equal(seen[0], 'running');
});
