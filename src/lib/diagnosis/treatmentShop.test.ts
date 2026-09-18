/**
 * Unit tests for routing a treatment product to a known supplier.
 * Run: node --test src/lib/diagnosis/treatmentShop.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FUNGICIDE_SHOP_URL,
  NEEM_SHOP_URL,
  NUTRIENT_SHOP_URL,
  shopFor,
} from './treatmentShop.ts';

/*
 * The products the nursery scrape is useless for. Almost no Israeli garden
 * centre stocks chelated iron or a micronutrient supplement, so searching for
 * one burns a 30-60s job to come back with nothing. These go straight to a
 * shop we know carries them.
 */
test('nutrients and feeds are routed to the supplier', () => {
  for (const p of [
    'Balanced aroid fertilizer',
    'balanced fertiliser',
    'Chelated iron',
    'iron chelate',
    'Micronutrient supplement',
    'trace elements',
    'Cal-Mag supplement',
    'calmag',
    'NPK 20-20-20',
    'plant food',
    'Epsom salt',
    'magnesium sulfate',
  ]) {
    assert.deepEqual(shopFor(p), { id: 'nutrient', url: NUTRIENT_SHOP_URL }, p);
  }
});

/*
 * What a garden centre DOES stock keeps the nursery search. Sending these to a
 * hydroponics nutrient page would be a worse answer than the scrape.
 */
/* Named suppliers of their own, so they do not fall back to the scrape. */
test('neem goes to its own product page', () => {
  for (const p of ['Neem oil', 'neem oil spray', 'Neem']) {
    assert.deepEqual(shopFor(p), { id: 'neem', url: NEEM_SHOP_URL }, p);
  }
});

test('fungicides go to their own product page', () => {
  for (const p of ['copper fungicide', 'Fungicide', 'systemic fungicide']) {
    assert.deepEqual(shopFor(p), { id: 'fungicide', url: FUNGICIDE_SHOP_URL }, p);
  }
});

/*
 * What a garden centre DOES stock, and that we have no link for, keeps the
 * nursery search. Sending these to a page of nutrients or neem would be a
 * worse answer than the scrape.
 */
test('everything without a named supplier keeps the nursery search', () => {
  for (const p of [
    'insecticidal soap',
    'systemic insecticide',
    'Confidor',
    'sphagnum moss',
    'potting mix',
    'perlite',
    'rooting hormone',
    'hydrogen peroxide',
    'miticide',
  ]) {
    assert.equal(shopFor(p), null, `${p} should keep the scrape`);
  }
});

/*
 * An insecticide is not a fungicide. They share six letters and nothing else,
 * and whole-word matching is what keeps them apart.
 */
test('insecticide is not read as fungicide', () => {
  assert.equal(shopFor('systemic insecticide'), null);
});

/* Every link is a real https URL - a typo here ships a dead button. */
test('the supplier links are https', () => {
  assert.match(NUTRIENT_SHOP_URL, /^https:\/\/hydroshop\.co\.il\//);
  assert.match(NEEM_SHOP_URL, /^https:\/\/hydroshop\.co\.il\//);
  assert.match(FUNGICIDE_SHOP_URL, /^https:\/\/www\.gadot-garden\.com\//);
});

/*
 * No ad-click tracking in a shipped link. These URLs were copied out of a
 * browser after a Google ad click, and carrying `gclid`/`utm_*` into the app
 * would attribute every user's tap to that one stale click.
 */
test('no tracking parameters are shipped', () => {
  for (const url of [NUTRIENT_SHOP_URL, NEEM_SHOP_URL, FUNGICIDE_SHOP_URL]) {
    assert.doesNotMatch(url, /gclid|gbraid|utm_|gad_source/, url);
  }
});

/*
 * `iron` has to match as a word. Substring matching turns "environment" into a
 * fertilizer order, which is the kind of thing that only shows up in front of
 * a user.
 */
test('a term embedded in a longer word does not match', () => {
  assert.equal(shopFor('environment'), null, 'env-IRON-ment');
  assert.equal(shopFor('ironwood bark'), null, 'ironwood is not iron');
  assert.equal(shopFor('Iron supplement')?.id, 'nutrient', 'but iron as its own word does');
});

test('nothing to buy is nothing to route', () => {
  assert.equal(shopFor(''), null);
  assert.equal(shopFor('   '), null);
});

