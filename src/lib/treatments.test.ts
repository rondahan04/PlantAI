import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treatmentProduct, shoppableTreatments } from './treatments.ts';

test('a branded product is searched for by its brand, not its method', () => {
  assert.equal(treatmentProduct('Confidor (imidacloprid) soil drench'), 'Confidor');
});

test('a leading verb is not mistaken for a brand', () => {
  assert.equal(treatmentProduct('Apply Confidor to the soil'), 'Confidor');
});

test('advice with no product to buy returns null rather than a junk search', () => {
  assert.equal(treatmentProduct('Wipe the scale off by hand first'), null);
  assert.equal(treatmentProduct('Increase airflow around the plant'), null);
  assert.equal(treatmentProduct('Repot into a smaller pot'), null);
});

test('a generic substance keeps its full name', () => {
  // "Neem" alone would scrape as a plant, not the oil the user needs.
  assert.equal(treatmentProduct('Spray with neem oil every 7 days'), 'neem oil');
  assert.equal(treatmentProduct('Insecticidal soap on the undersides'), 'insecticidal soap');
});

test('the more specific substance wins over the generic one', () => {
  assert.equal(treatmentProduct('Copper fungicide, two applications'), 'copper fungicide');
});

test('empty or whitespace titles are not shoppable', () => {
  assert.equal(treatmentProduct(''), null);
  assert.equal(treatmentProduct('   '), null);
});

test('only the shoppable treatments come back, each with its search term', () => {
  const out = shoppableTreatments([
    { title: 'Confidor (imidacloprid) soil drench', description: '', urgent: true },
    { title: 'Wipe the scale off by hand', description: '', urgent: false },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].product, 'Confidor');
  assert.equal(out[0].treatment.urgent, true);
});
