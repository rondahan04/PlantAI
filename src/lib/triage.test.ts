import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketFor, triageSections } from './triage.ts';
import type { StoredPlant } from '../services/plantStore.ts';

function plant(condition: string, savedAt: string, id = condition + savedAt): StoredPlant {
  return {
    id,
    savedAt,
    photoUri: 'x',
    addedVia: 'scan',
    diagnosis: {
      plantName: 'P',
      scientificName: 'S',
      condition: condition as NonNullable<StoredPlant['diagnosis']>['condition'],
      conditionLabel: condition,
      issues: [],
      treatments: [],
      canBeSaved: true,
      confidence: 50,
      description: '',
    },
  };
}

test('the five-step scale collapses into three actionable buckets', () => {
  assert.equal(bucketFor('critical'), 'attention');
  assert.equal(bucketFor('severe'), 'attention');
  assert.equal(bucketFor('moderate'), 'watching');
  assert.equal(bucketFor('mild'), 'healthy');
  assert.equal(bucketFor('healthy'), 'healthy');
});

test('an unrecognised condition surfaces rather than hiding in Healthy', () => {
  // A plant whose health we cannot read is not evidence that it is fine.
  assert.equal(bucketFor('exploded'), 'watching');
});

test('sections come back in triage order, most urgent first', () => {
  const out = triageSections([
    plant('healthy', '2026-01-01T00:00:00Z'),
    plant('critical', '2026-01-01T00:00:00Z'),
    plant('moderate', '2026-01-01T00:00:00Z'),
  ]);
  assert.deepEqual(out.map((s) => s.key), ['attention', 'watching', 'healthy']);
});

test('empty buckets are dropped, not rendered as bare headers', () => {
  const out = triageSections([plant('healthy', '2026-01-01T00:00:00Z')]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'healthy');
});

test('an empty library produces no sections at all', () => {
  assert.deepEqual(triageSections([]), []);
});

test('within a bucket, the more severe plant sorts first', () => {
  const out = triageSections([
    plant('severe', '2026-01-01T00:00:00Z', 'sev'),
    plant('critical', '2026-01-01T00:00:00Z', 'crit'),
  ]);
  assert.deepEqual(out[0].data.map((p) => p.id), ['crit', 'sev']);
});

test('at equal severity the newest plant sorts first', () => {
  const out = triageSections([
    plant('critical', '2026-01-01T00:00:00Z', 'older'),
    plant('critical', '2026-06-01T00:00:00Z', 'newer'),
  ]);
  assert.deepEqual(out[0].data.map((p) => p.id), ['newer', 'older']);
});

test('grouping never loses or duplicates a plant', () => {
  const plants = [
    plant('critical', '2026-01-01T00:00:00Z', 'a'),
    plant('mild', '2026-01-02T00:00:00Z', 'b'),
    plant('moderate', '2026-01-03T00:00:00Z', 'c'),
    plant('weird', '2026-01-04T00:00:00Z', 'd'),
  ];
  const ids = triageSections(plants).flatMap((s) => s.data.map((p) => p.id));
  assert.equal(ids.length, plants.length);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c', 'd']);
});
