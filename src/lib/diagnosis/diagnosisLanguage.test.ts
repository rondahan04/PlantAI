/**
 * Unit tests for stale-language detection.
 * Run: node --test src/lib/diagnosisLanguage.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsTranslation, prose } from './diagnosisLanguage.ts';

const ENGLISH = {
  description: 'The plant is alive but has substantial leaf chlorosis.',
  issues: ['The main leaf shows widespread yellowing with greener veins.'],
  treatments: [{ title: 'Provide balanced nutrition', description: 'Feed lightly.' }],
};

const HEBREW = {
  description: 'הצמח חי אך יש כלורוזה נרחבת בעלים.',
  issues: ['העלה הראשי מצהיב עם עורקים ירוקים.'],
  treatments: [{ title: 'לספק תזונה מאוזנת', description: 'דשנו קלות.' }],
};

test('an English record read in Hebrew needs translating', () => {
  assert.ok(needsTranslation(ENGLISH, 'he'));
});

test('a Hebrew record read in Hebrew does not', () => {
  assert.ok(!needsTranslation(HEBREW, 'he'));
});

test('an English record read in English does not', () => {
  assert.ok(!needsTranslation(ENGLISH, 'en'));
});

/*
 * The expensive mistake. A false positive rewrites a record that was already
 * correct AND bills for it, so a Hebrew diagnosis that quotes a cultivar, a
 * product name or "pH" must not read as English.
 */
test('English fragments inside Hebrew prose do not make it an English record', () => {
  const mixed = {
    description: 'הצמח סובל מכלורוזה. מומלץ דשן עם pH נמוך.',
    issues: ['עלים מצהיבים על Monstera deliciosa.'],
    treatments: [{ title: 'ברזל כלאטי', description: 'השתמשו ב-Chelated iron מדולל.' }],
  };
  assert.ok(!needsTranslation(mixed, 'he'));
});

test('a Hebrew record quoting Latin still reads as Hebrew to an English user', () => {
  assert.ok(!needsTranslation({ description: 'עלים מצהיבים על Monstera.' }, 'en'));
  assert.ok(needsTranslation({ description: 'עלים מצהיבים.' }, 'en'));
});

/*
 * An empty diagnosis is not evidence of a language. Sending it to be
 * translated would bill for turning nothing into nothing.
 */
test('no prose is left alone in either language', () => {
  assert.ok(!needsTranslation({}, 'he'));
  assert.ok(!needsTranslation({ description: '   ', issues: [] }, 'he'));
});

/*
 * Botanical names are Latin in every language, so including them in the test
 * would report a perfectly good Hebrew record as English the moment it named
 * a Monstera.
 */
test('names are not prose - they never vote on the language', () => {
  const withNames = {
    ...HEBREW,
    plantName: 'Monstera',
    scientificName: 'Monstera deliciosa',
    variety: 'Thai Constellation',
  } as any;
  assert.ok(!prose(withNames).some((line) => line.includes('Thai Constellation')));
  assert.ok(!needsTranslation(withNames, 'he'));
});

test('the care plan counts as prose, so a half-translated record is caught', () => {
  const planOnly = {
    carePlan: { light: 'Bright indirect light', water: 'Every 7 days', humidity: '', soil: '' },
  };
  assert.ok(needsTranslation(planOnly, 'he'));
});
