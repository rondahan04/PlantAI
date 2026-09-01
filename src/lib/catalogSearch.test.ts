import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_ENTRIES,
  browseSections,
  catalogDisplayName,
  catalogEntryById,
  fold,
  searchCatalog,
  type CatalogEntry,
} from './catalogSearch.ts';

test('every entry id is unique', () => {
  const ids = new Set(CATALOG_ENTRIES.map((e) => e.id));
  assert.equal(ids.size, CATALOG_ENTRIES.length);
});

test('an empty query returns the whole tree, grouped', () => {
  const sections = browseSections();
  assert.ok(sections.length > 0);
  const titles = sections.map((s) => s.title);
  assert.ok(titles.includes('Aroids - Alocasia - Rare Alocasias'));
  const rare = sections.find((s) => s.title === 'Aroids - Alocasia - Rare Alocasias')!;
  assert.ok(rare.data.some((e) => e.id === 'alocasia-dragon-scale-mint-variegated'));
});

test('searchCatalog with a blank query browses rather than returning nothing', () => {
  assert.deepEqual(
    searchCatalog('   ').map((s) => s.title),
    browseSections().map((s) => s.title)
  );
});

test('matches on the display name', () => {
  const hits = searchCatalog('dragon scale').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale'));
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale-mint-variegated'));
});

test('matches on the scientific name', () => {
  const hits = searchCatalog('baginda').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale'));
});

test('matches on a synonym', () => {
  const hits = searchCatalog('swiss cheese').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'monstera-deliciosa'));
});

test('matches on the genus, so typing "alocasia" lists the genus', () => {
  const hits = searchCatalog('alocasia').flatMap((s) => s.data);
  assert.ok(hits.length >= 8);
  assert.ok(hits.every((e) => e.genus === 'Alocasia'));
});

test('is case and diacritic insensitive', () => {
  const plain = searchCatalog('POLLY').flatMap((s) => s.data);
  assert.ok(plain.some((e) => e.id === 'alocasia-polly'));
  const accented = searchCatalog('álocasia zebrína').flatMap((s) => s.data);
  assert.ok(accented.some((e) => e.id === 'alocasia-zebrina'));
});

test('every term must match, so a two-word query narrows', () => {
  const hits = searchCatalog('alocasia mint').flatMap((s) => s.data);
  assert.deepEqual(hits.map((e) => e.id), ['alocasia-dragon-scale-mint-variegated']);
});

test('no match returns no sections rather than the whole tree', () => {
  assert.deepEqual(searchCatalog('qqzzxx'), []);
});

test('search results keep their family/genus/group section titles', () => {
  const sections = searchCatalog('dragon scale');

  // Every section names all three levels. Asserted as a shape rather than as
  // one expected title: 'Purple Dragon Scale' is a real Alocasia shelved with
  // the jewels, so a genuine two-word query legitimately spans groups, and a
  // test pinned to a single title would fail every time the catalog grows.
  assert.ok(sections.length > 0);
  for (const s of sections) {
    assert.equal(s.title, `${s.family} - ${s.genus} - ${s.group}`);
  }

  // Curated order, not alphabetical: the rare Alocasias come first because
  // that is where both plain Dragon Scales sit in the catalog.
  assert.equal(sections[0].title, 'Aroids - Alocasia - Rare Alocasias');
  assert.deepEqual(
    sections[0].data.map((e) => e.id),
    ['alocasia-dragon-scale', 'alocasia-dragon-scale-mint-variegated']
  );
});

test('catalogEntryById finds an entry and tolerates a stale id', () => {
  assert.equal(catalogEntryById('monstera-albo')?.name, 'Albo Variegata');
  assert.equal(catalogEntryById('removed-in-a-later-release'), undefined);
});

/*
 * Hebrew. `fold` used to strip everything outside [a-z0-9], so a Hebrew query
 * folded to an empty string and matched the entire catalog - the search box
 * would have looked broken rather than empty-handed.
 */

test('folding keeps Hebrew letters instead of erasing them', () => {
  assert.equal(fold('מונסטרה'), 'מונסטרה');
  assert.notEqual(fold('מונסטרה'), '');
  // Mixed queries are normal here: Israeli growers type "מונסטרה Thai".
  assert.equal(fold('מונסטרה  Thai'), 'מונסטרה thai');
});

test('a Hebrew genus name finds its entries', () => {
  const hits = searchCatalog('מונסטרה');
  assert.ok(hits.length > 0);
  assert.ok(hits.every((e) => e.genus === 'Monstera'));
});

test('the English name still finds the same entry, because growers type both', () => {
  assert.ok(searchCatalog('monstera').length > 0);
});

test('an entry with no Hebrew name shows its English one rather than nothing', () => {
  const entry = CATALOG_ENTRIES.find((e) => !e.nameHe)!;
  assert.equal(catalogDisplayName(entry, 'he'), entry.name);
  assert.equal(catalogDisplayName(entry, 'en'), entry.name);
});

test('an entry with a Hebrew name shows it only in Hebrew', () => {
  const entry: CatalogEntry = {
    id: 'x',
    name: 'Swiss Cheese Plant',
    nameHe: 'מונסטרה דליציוזה',
    scientificName: 'Monstera deliciosa',
    genus: 'Monstera',
    group: 'g',
    family: 'f',
  };
  assert.equal(catalogDisplayName(entry, 'he'), 'מונסטרה דליציוזה');
  assert.equal(catalogDisplayName(entry, 'en'), 'Swiss Cheese Plant');
});
