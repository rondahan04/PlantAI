import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProductFromTitle, treatmentProduct, shoppableTreatments } from './treatments.ts';

test('a branded product is searched for by its brand, not its method', () => {
  assert.equal(parseProductFromTitle('Confidor (imidacloprid) soil drench'), 'Confidor');
});

test('a leading verb is not mistaken for a brand', () => {
  assert.equal(parseProductFromTitle('Apply Confidor to the soil'), 'Confidor');
});

test('advice with no product to buy returns null rather than a junk search', () => {
  assert.equal(parseProductFromTitle('Wipe the scale off by hand first'), null);
  assert.equal(parseProductFromTitle('Increase airflow around the plant'), null);
  assert.equal(parseProductFromTitle('Repot into a smaller pot'), null);
});

test('a generic substance keeps its full name', () => {
  // "Neem" alone would scrape as a plant, not the oil the user needs.
  assert.equal(parseProductFromTitle('Spray with neem oil every 7 days'), 'neem oil');
  assert.equal(parseProductFromTitle('Insecticidal soap on the undersides'), 'insecticidal soap');
});

test('the more specific substance wins over the generic one', () => {
  assert.equal(parseProductFromTitle('Copper fungicide, two applications'), 'copper fungicide');
});

test('empty or whitespace titles are not shoppable', () => {
  assert.equal(parseProductFromTitle(''), null);
  assert.equal(parseProductFromTitle('   '), null);
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

/*
 * The Hebrew problem. `parseProductFromTitle` reads English titles against
 * English substance names and English action words. Given a Hebrew title it
 * returns null for everything, so the "find it nearby" button - the whole
 * commerce path out of a diagnosis - silently stops rendering. The fix is that
 * the model states the product; the parser stays for records written before
 * that field existed.
 */

test('an explicit product from the model wins over parsing the title', () => {
  assert.equal(
    treatmentProduct({
      title: 'ריסוס בשמן נים אחת לשבוע',
      description: '',
      urgent: true,
      product: 'Neem oil',
    }),
    'Neem oil'
  );
});

test('an empty product means the model said there is nothing to buy', () => {
  // Distinct from the field being absent: '' is an answer, undefined is silence.
  assert.equal(
    treatmentProduct({ title: 'נגבו את הכנימות ביד', description: '', urgent: false, product: '' }),
    null
  );
});

test('a diagnosis saved before the field existed still parses its English title', () => {
  assert.equal(
    treatmentProduct({ title: 'Neem oil spray weekly', description: '', urgent: true }),
    'neem oil'
  );
});

test('a Hebrew treatment with no product field offers nothing rather than guessing', () => {
  // The honest outcome for an old record in a new language: no button, rather
  // than a button that searches nurseries for a Hebrew verb.
  assert.equal(
    treatmentProduct({ title: 'הגבירו את הלחות סביב הצמח', description: '', urgent: false }),
    null
  );
});

test('shoppableTreatments follows the same rule', () => {
  const result = shoppableTreatments([
    { title: 'ריסוס', description: '', urgent: true, product: 'Confidor' },
    { title: 'נגבו ביד', description: '', urgent: false, product: '' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'Confidor');
});
