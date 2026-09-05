import test from 'node:test';
import assert from 'node:assert/strict';
import { createBulkDiagnose, SPACING_MS, type BulkProgress } from './bulkDiagnose.ts';
import type { StoredPlant } from './plantStore.ts';
import type { PlantDiagnosis } from '../types/index.ts';

const diagnosis = { plantName: 'Monstera', condition: 'healthy' } as unknown as PlantDiagnosis;

function plant(id: string): StoredPlant {
  return {
    id,
    savedAt: '2026-09-01T00:00:00.000Z',
    photoUri: `file://${id}.jpg`,
    addedVia: 'manual',
  } as StoredPlant;
}

/* Records waits instead of performing them, so a two-minute job runs instantly. */
function harness(
  over: {
    diagnose?: (photoUri: string) => Promise<PlantDiagnosis>;
    attach?: (id: string, d: PlantDiagnosis) => Promise<{ ok: boolean }>;
  } = {}
) {
  const waits: number[] = [];
  const attached: string[] = [];
  const bulk = createBulkDiagnose({
    diagnose: over.diagnose ?? (async () => diagnosis),
    attach:
      over.attach ??
      (async (id) => {
        attached.push(id);
        return { ok: true };
      }),
    wait: async (ms) => {
      waits.push(ms);
    },
    nameOf: (p) => `Plant ${p.id}`,
  });
  return { bulk, waits, attached };
}

test('run: diagnoses every target and attaches each finding', async () => {
  const { bulk, attached } = harness();
  const final = await bulk.run([plant('a'), plant('b'), plant('c')], 0);
  assert.equal(final.state, 'done');
  assert.equal(final.done, 3);
  assert.equal(final.failed, 0);
  assert.deepEqual(attached, ['a', 'b', 'c']);
});

test('run: paces requests under the per-minute gate, and does not wait after the last one', async () => {
  const { bulk, waits } = harness();
  await bulk.run([plant('a'), plant('b'), plant('c')], 0);
  // Two gaps for three plants: a trailing wait would leave the row looking
  // stuck for a minute after the final result landed.
  assert.deepEqual(waits, [SPACING_MS, SPACING_MS]);
});

test('run: a single plant needs no pacing at all', async () => {
  const { bulk, waits } = harness();
  await bulk.run([plant('a')], 0);
  assert.deepEqual(waits, []);
});

test('run: one failed plant is counted and the rest still run', async () => {
  const { bulk, attached } = harness({
    diagnose: async (uri) => {
      if (uri.includes('b')) throw new Error('429');
      return diagnosis;
    },
  });
  const final = await bulk.run([plant('a'), plant('b'), plant('c')], 0);
  assert.equal(final.done, 2);
  assert.equal(final.failed, 1);
  assert.deepEqual(attached, ['a', 'c']); // the batch was not abandoned
});

test('run: a diagnosis that cannot be SAVED counts as failed, not done', async () => {
  // The paid call worked but the card shows no change, so reporting success
  // would tell the user the button worked when it did not.
  const { bulk } = harness({ attach: async () => ({ ok: false }) });
  const final = await bulk.run([plant('a')], 0);
  assert.equal(final.done, 0);
  assert.equal(final.failed, 1);
});

test('run: carries the skipped-no-photo count through so the result can report it', async () => {
  const { bulk } = harness();
  const final = await bulk.run([plant('a')], 8);
  assert.equal(final.skippedNoPhoto, 8);
  assert.equal(final.done, 1);
});

test('run: a second start while running is ignored rather than double-spending', async () => {
  let inFlight!: (d: PlantDiagnosis) => void;
  const { bulk, attached } = harness({
    diagnose: () => new Promise<PlantDiagnosis>((resolve) => (inFlight = resolve)),
  });
  const first = bulk.run([plant('a')], 0);
  const second = await bulk.run([plant('b')], 0); // must not start
  assert.equal(second.state, 'running');
  inFlight(diagnosis);
  await first;
  assert.deepEqual(attached, ['a']); // 'b' was never charged for
});

test('cancel: stops the run, keeping the request already paid for', async () => {
  const { bulk, attached } = harness({
    diagnose: async (uri) => {
      if (uri.includes('a')) bulk.cancel(); // cancelled mid-flight
      return diagnosis;
    },
  });
  const final = await bulk.run([plant('a'), plant('b')], 0);
  assert.equal(final.state, 'done');
  assert.deepEqual(attached, ['a']); // the in-flight one still counted
  assert.equal(final.done, 1);
});

test('subscribe: a screen mounting mid-job is handed the job immediately', async () => {
  const { bulk } = harness();
  const seen: BulkProgress[] = [];
  const off = bulk.subscribe((p) => seen.push(p));
  assert.equal(seen[0].state, 'idle'); // called on subscribe, not only on change
  await bulk.run([plant('a')], 0);
  assert.equal(seen.at(-1)?.state, 'done');
  assert.ok(seen.some((p) => p.currentName === 'Plant a'));
  off();
});

test('subscribe: unsubscribing stops the updates', async () => {
  const { bulk } = harness();
  let count = 0;
  const off = bulk.subscribe(() => count++);
  const afterSubscribe = count;
  off();
  await bulk.run([plant('a')], 0);
  assert.equal(count, afterSubscribe);
});

test('dismiss: clears a finished run, and does nothing to a running one', async () => {
  const { bulk } = harness();
  await bulk.run([plant('a')], 3);
  assert.equal(bulk.get().state, 'done');
  bulk.dismiss();
  assert.equal(bulk.get().state, 'idle');
  assert.equal(bulk.get().skippedNoPhoto, 0);
});
