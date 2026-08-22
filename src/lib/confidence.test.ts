import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  confidenceTier,
  identityConfidence,
  CONFIDENT_AT_OR_ABOVE,
  UNSURE_BELOW,
} from './confidence.ts';

/*
 * E9 exists because a real run rendered a 48%-confidence species match with
 * the same visual authority as a 92% one. These tests are about the boundary
 * behavior and the caveat that must accompany anything below full confidence.
 */

// ─── Tier boundaries ───────────────────────────────────────────────────────

test('at or above the high threshold is high confidence', () => {
  assert.equal(confidenceTier(CONFIDENT_AT_OR_ABOVE), 'high');
  assert.equal(confidenceTier(100), 'high');
});

test('just below the high threshold is moderate, not high', () => {
  assert.equal(confidenceTier(CONFIDENT_AT_OR_ABOVE - 1), 'moderate');
});

test('at the low threshold is moderate, not low', () => {
  assert.equal(confidenceTier(UNSURE_BELOW), 'moderate');
});

test('just below the low threshold is low', () => {
  assert.equal(confidenceTier(UNSURE_BELOW - 1), 'low');
});

test('0 is low confidence', () => {
  assert.equal(confidenceTier(0), 'low');
});

// ─── High tier: no hedging ─────────────────────────────────────────────────

test('a high-confidence identity is presented plainly, with no caveat', () => {
  const identity = identityConfidence(92, 'Monstera deliciosa');
  assert.equal(identity.tier, 'high');
  assert.equal(identity.namePrefix, '');
  assert.equal(identity.needsCaveat, false);
  assert.equal(identity.noteTitle, '');
  assert.equal(identity.noteBody, '');
  assert.equal(identity.label, '92% species match');
});

// ─── Moderate tier: hedge, caveat, still shown ─────────────────────────────

test('a moderate-confidence identity hedges the name and shows a caveat', () => {
  const identity = identityConfidence(55, 'Mini monstera');
  assert.equal(identity.tier, 'moderate');
  assert.equal(identity.namePrefix, 'Probably');
  assert.equal(identity.needsCaveat, true);
  assert.ok(identity.noteTitle.length > 0);
  assert.ok(identity.noteBody.includes('Mini monstera'));
});

// ─── Low tier: strongest hedge, strongest caveat ───────────────────────────

test('a low-confidence identity uses a stronger hedge than moderate', () => {
  const identity = identityConfidence(20, 'Mini monstera');
  assert.equal(identity.tier, 'low');
  assert.equal(identity.namePrefix, 'Possibly');
  assert.equal(identity.needsCaveat, true);
  assert.ok(identity.noteBody.includes('Mini monstera'));
});

test('the real 48% run that motivated E9 gets a caveat, not plain presentation', () => {
  const identity = identityConfidence(48, 'Mini monstera');
  assert.equal(identity.needsCaveat, true, '48% must not render like a confident match');
  assert.notEqual(identity.tier, 'high');
});

// ─── Label always reflects the raw number ──────────────────────────────────

test('the label always states the percent, regardless of tier', () => {
  assert.equal(identityConfidence(0, 'x').label, '0% species match');
  assert.equal(identityConfidence(70, 'x').label, '70% species match');
  assert.equal(identityConfidence(100, 'x').label, '100% species match');
});
