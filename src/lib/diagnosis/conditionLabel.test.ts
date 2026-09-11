/**
 * Unit tests for the health badge's words.
 * Run: node --test src/lib/conditionLabel.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionLabel, isCondition, EN_CONDITION_COPY } from './conditionLabel.ts';

const HE = {
  healthy: 'בריא',
  mild: 'בעיה קלה',
  moderate: 'הידרדרות בינונית',
  severe: 'הידרדרות חמורה',
  critical: 'מצב קריטי',
};

/*
 * The bug this exists for: a library diagnosed in English, then switched to
 * Hebrew, showed "Moderate decline" on a Hebrew screen forever. Nothing
 * re-runs a diagnosis because a setting changed, so the badge has to be
 * derived from the enum rather than read off the record.
 */
test('the badge ignores the stored English label and speaks the current language', () => {
  assert.equal(conditionLabel('moderate', 'Moderate decline', HE), 'הידרדרות בינונית');
  assert.equal(conditionLabel('mild', 'Mild concern', HE), 'בעיה קלה');
});

test('English is unchanged, so nothing moves for an English user', () => {
  for (const key of Object.keys(EN_CONDITION_COPY) as (keyof typeof EN_CONDITION_COPY)[]) {
    assert.equal(conditionLabel(key, 'whatever'), EN_CONDITION_COPY[key]);
  }
});

/*
 * The enum is something the model is ASKED to honour, not something it is
 * prevented from breaking. A condition we do not recognise still had a
 * readable sentence next to it, and showing that beats showing nothing.
 */
test('an unrecognised condition falls back to what the model wrote', () => {
  assert.equal(conditionLabel('declining', 'Slowly declining', HE), 'Slowly declining');
  assert.equal(conditionLabel(undefined, 'Unknown', HE), 'Unknown');
});

test('no condition and no fallback is undefined, not an empty badge', () => {
  assert.equal(conditionLabel(undefined, undefined, HE), undefined);
  assert.equal(conditionLabel('nonsense', undefined, HE), undefined);
});

test('isCondition guards the five the client branches on', () => {
  assert.ok(isCondition('critical'));
  assert.ok(!isCondition('Critical'));
  assert.ok(!isCondition(undefined));
});
