import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyName, speciesKey } from './commonNames.ts';

/*
 * The lookup exists to survive the several ways the two identifiers spell the
 * same species. Every case below is a spelling one of them actually produces -
 * a missed key here is silent, and shows up only as a botanical name on the
 * biggest text on the diagnosis screen.
 */

test('the Alocasia case: every spelling of the plant reaches one everyday name', () => {
  for (const name of [
    'Alocasia × amazonica',
    'Alocasia x amazonica',
    "Alocasia 'Polly'",
    'Alocasia amazonica',
    'Alocasia sanderiana',
    'Alocasia sanderiana W.Bull',
  ]) {
    assert.equal(friendlyName(name, 'whatever'), 'African mask plant', name);
  }
});

test('an unlisted species falls back to its genus', () => {
  // An Alocasia we have never listed still reads as something a person says,
  // rather than as a binomial.
  assert.equal(friendlyName('Alocasia cuprea', 'Alocasia cuprea'), 'African mask plant');
});

test('the species entry wins over the genus entry', () => {
  assert.equal(friendlyName('Alocasia zebrina', 'x'), 'Zebra plant');
  assert.equal(friendlyName('Alocasia macrorrhizos', 'x'), 'Giant taro');
});

test('a plant we have nothing to say about keeps the name it arrived with', () => {
  // The table growing must always be additive - never a behaviour change for a
  // plant already identified correctly.
  assert.equal(friendlyName('Quercus robur', 'English oak'), 'English oak');
  assert.equal(friendlyName('Nothing realis', "Sander's whatever"), "Sander's whatever");
});

test('an empty fallback never produces an empty headline', () => {
  // A diagnosis screen with no plant name on it reads as a broken app.
  assert.equal(friendlyName('Quercus robur', ''), 'Quercus robur');
  assert.equal(friendlyName('Quercus robur', '   '), 'Quercus robur');
});

test('the naming authority PlantNet appends is not part of the identity', () => {
  assert.equal(friendlyName('Ficus lyrata Warb.', 'x'), 'Fiddle leaf fig');
  assert.equal(friendlyName('Rhaphidophora tetrasperma Hook.f.', 'x'), 'Mini monstera');
  assert.equal(friendlyName('Monstera deliciosa Liebm.', 'x'), 'Swiss cheese plant');
});

test('both spellings of a renamed genus land on the same name', () => {
  // Sansevieria was folded into Dracaena, and Senecio into Curio; which name an
  // identifier uses depends on how current its taxonomy is, not on the plant.
  assert.equal(friendlyName('Sansevieria trifasciata', 'x'), 'Snake plant');
  assert.equal(friendlyName('Dracaena trifasciata', 'x'), 'Snake plant');
  assert.equal(friendlyName('Senecio rowleyanus', 'x'), 'String of pearls');
  assert.equal(friendlyName('Curio rowleyanus', 'x'), 'String of pearls');
});

test('speciesKey: rank markers and infraspecific names are dropped', () => {
  assert.equal(speciesKey('Alocasia macrorrhizos var. variegata'), 'alocasia macrorrhizos');
  assert.equal(speciesKey('Epipremnum aureum subsp. something'), 'epipremnum aureum');
});

test('speciesKey: a bare genus stays a bare genus', () => {
  assert.equal(speciesKey('Alocasia'), 'alocasia');
  assert.equal(friendlyName('Alocasia', 'Alocasia'), 'African mask plant');
});

test('speciesKey: junk input does not throw or match anything', () => {
  for (const junk of ['', '   ', '???', 42 as unknown as string, null as unknown as string]) {
    assert.doesNotThrow(() => speciesKey(junk));
  }
  assert.equal(friendlyName('', 'Some plant'), 'Some plant');
});

test('a cultivar in quotes never becomes part of the key', () => {
  // "Thai Constellation" must not split Monstera deliciosa into its own bucket.
  assert.equal(speciesKey("Monstera deliciosa 'Thai Constellation'"), 'monstera deliciosa');
  assert.equal(friendlyName("Monstera deliciosa 'Thai Constellation'", 'x'), 'Swiss cheese plant');
});
