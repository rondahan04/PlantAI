import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHealthAssessment, normalizeAssessment } from './diagnose.ts';

/*
 * These cover the OpenAI response-shape contract, which is the one part of the
 * diagnosis path that no amount of correct code can pin down: the model decides
 * the shape at runtime and periodically changes its mind.
 *
 * The object-shaped `issues` case below is not hypothetical — it is the payload
 * that 502'd a live request on 2026-08-18 (r68) while the identical photo had
 * succeeded locally minutes earlier.
 */

const valid = {
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: ['Brown necrotic leaf margins'],
  treatments: [{ title: 'Adjust watering', description: 'Water when dry.', urgent: true }],
  description: 'Some leaf scorch.',
  canBeSaved: true,
};

test('a well-formed assessment passes untouched', () => {
  assert.equal(isHealthAssessment(valid), true);
  assert.equal(normalizeAssessment(valid), valid, 'nothing to fix → same object back');
});

test('object-shaped issues are flattened to strings — the r68 production failure', () => {
  const drifted = {
    ...valid,
    issues: [
      {
        name: 'Brown necrotic leaf margins',
        evidence: 'Several leaves show dry brown edges and tips with yellow halos.',
        likelyCause: 'Water stress or low humidity.',
      },
    ],
  };

  assert.equal(isHealthAssessment(drifted), false, 'guard must still reject the raw shape');

  const fixed = normalizeAssessment(drifted);
  assert.equal(isHealthAssessment(fixed), true, 'normalized shape must validate');
  assert.deepEqual((fixed as typeof valid).issues, [
    'Brown necrotic leaf margins — Several leaves show dry brown edges and tips with yellow halos.',
  ]);
});

test('label and detail are joined, not one at the expense of the other', () => {
  // `name` alone loses the evidence justifying the claim; `evidence` alone
  // loses what the problem is called. A user deserves both.
  const out = normalizeAssessment({ ...valid, issues: [{ name: 'Root rot', evidence: 'Mushy stem base.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Root rot — Mushy stem base.']);
});

test('alternative key spellings the model reaches for are understood', () => {
  const out = normalizeAssessment({
    ...valid,
    issues: [{ issue: 'Spider mites', description: 'Fine webbing under leaves.' }],
  });
  assert.deepEqual((out as typeof valid).issues, ['Spider mites — Fine webbing under leaves.']);
});

test('a lone descriptive field is kept as-is', () => {
  const out = normalizeAssessment({ ...valid, issues: [{ description: 'Yellowing lower leaves.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Yellowing lower leaves.']);
});

test('trailing punctuation on a label does not produce a double separator', () => {
  const out = normalizeAssessment({ ...valid, issues: [{ name: 'Leaf scorch:', evidence: 'Crispy tips.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Leaf scorch — Crispy tips.']);
});

test('unusable issue entries are dropped rather than rendered as junk', () => {
  // A user seeing "[object Object]" or an empty bullet is worse than seeing
  // one fewer issue.
  const out = normalizeAssessment({ ...valid, issues: [null, {}, 42, { name: 'Aphids' }, '  '] });
  assert.deepEqual((out as typeof valid).issues, ['Aphids']);
});

test('an empty issues array survives — healthy plants have no issues', () => {
  const healthy = { ...valid, condition: 'healthy', conditionLabel: 'Healthy', issues: [] };
  assert.equal(isHealthAssessment(normalizeAssessment(healthy)), true);
});

test('normalize repairs shape only — it never invents missing fields', () => {
  // Fabricating a `condition` would put a diagnosis in a pathologist's mouth
  // that the model never made. Missing fields must still fail the guard.
  const noCondition = { conditionLabel: 'X', issues: [{ name: 'Y' }], treatments: [], description: '', canBeSaved: true };
  assert.equal(isHealthAssessment(normalizeAssessment(noCondition)), false);
});

test('a bogus condition value is still rejected after normalizing', () => {
  const bad = { ...valid, condition: 'dying', issues: [{ name: 'Z' }] };
  assert.equal(isHealthAssessment(normalizeAssessment(bad)), false);
});

test('malformed treatments are not rescued — only issues are repaired', () => {
  const bad = { ...valid, treatments: [{ title: 'X' }] };
  assert.equal(isHealthAssessment(normalizeAssessment(bad)), false);
});

test('non-objects pass through without throwing', () => {
  for (const v of [null, undefined, 'string', 42, []]) {
    assert.doesNotThrow(() => normalizeAssessment(v));
    assert.equal(isHealthAssessment(normalizeAssessment(v)), false);
  }
});
