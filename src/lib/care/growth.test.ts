import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GROWTH_ENTRIES,
  MAX_NOTE_LENGTH,
  addEntry,
  entryAgeDays,
  growthSpanDays,
  normalizeGrowth,
  normalizeNote,
  photoIds,
  removeEntry,
  repointPhoto,
  setNote,
  type GrowthEntry,
} from './growth.ts';

/*
 * The journal is the only per-plant record whose rows own a FILE, so the cases
 * that matter are the ones where the row and the file disagree: a photo that
 * never finished copying, a photo deleted while its copy was still running, a
 * note left on an entry whose picture is gone. Every one of those is asserted
 * to resolve toward keeping what the user wrote.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-01T09:00:00.000Z');

function entry(id: string, dayOffset: number, over: Partial<GrowthEntry> = {}): GrowthEntry {
  return {
    id,
    takenAt: new Date(T0 + dayOffset * DAY).toISOString(),
    photoUri: `file:///photos/${id}.jpg`,
    ...over,
  };
}

test('normalizeNote trims, bounds, and reports nothing as undefined', () => {
  assert.equal(normalizeNote('  first new leaf  '), 'first new leaf');
  assert.equal(normalizeNote('   '), undefined);
  assert.equal(normalizeNote(''), undefined);
  assert.equal(normalizeNote(undefined), undefined);
  assert.equal(normalizeNote(42), undefined);
  assert.equal(normalizeNote('x'.repeat(MAX_NOTE_LENGTH + 50))?.length, MAX_NOTE_LENGTH);
});

test('normalizeNote keeps inner line breaks - a note is prose, not a name', () => {
  assert.equal(normalizeNote('\nrepotted\nnew leaf\n'), 'repotted\nnew leaf');
});

test('normalizeGrowth orders newest first whatever storage held', () => {
  const list = normalizeGrowth([entry('a', 0), entry('c', 10), entry('b', 5)]);
  assert.deepEqual(
    list.map((e) => e.id),
    ['c', 'b', 'a']
  );
});

test('normalizeGrowth drops rows that cannot be placed or drawn', () => {
  const list = normalizeGrowth([
    entry('ok', 0),
    { id: 'nostamp', photoUri: 'file:///x.jpg' },
    { id: 'badstamp', takenAt: 'yesterday', photoUri: 'file:///x.jpg' },
    { id: '', takenAt: new Date(T0).toISOString(), photoUri: 'file:///x.jpg' },
    /* Neither a picture nor a sentence: a date with nothing under it. */
    { id: 'empty', takenAt: new Date(T0).toISOString(), photoUri: '', note: '   ' },
    'not an object',
    null,
  ]);
  assert.deepEqual(
    list.map((e) => e.id),
    ['ok']
  );
});

test('normalizeGrowth keeps an entry whose photo is gone but whose note is not', () => {
  const list = normalizeGrowth([
    { id: 'lost', takenAt: new Date(T0).toISOString(), photoUri: 42, note: 'pushed a new leaf' },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].photoUri, '');
  assert.equal(list[0].note, 'pushed a new leaf');
});

test('normalizeGrowth keeps the first of two rows sharing an id', () => {
  const list = normalizeGrowth([entry('dup', 5), { ...entry('dup', 0), note: 'second' }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].note, undefined);
});

test('normalizeGrowth survives junk in place of a list', () => {
  assert.deepEqual(normalizeGrowth(undefined), []);
  assert.deepEqual(normalizeGrowth('[]'), []);
  assert.deepEqual(normalizeGrowth({ 0: entry('a', 0) }), []);
});

test('addEntry puts the new photo first and stamps it', () => {
  const at = T0 + 3 * DAY;
  const list = addEntry([entry('old', 0)], { id: 'new', photoUri: 'file:///cache/x.jpg' }, at);
  assert.deepEqual(
    list.map((e) => e.id),
    ['new', 'old']
  );
  assert.equal(list[0].takenAt, new Date(at).toISOString());
  assert.equal(list[0].note, undefined);
  assert.ok(!('note' in list[0]), 'an empty note is omitted, not written as undefined');
});

test('addEntry normalizes the note it is handed', () => {
  const list = addEntry([], { id: 'a', photoUri: 'file:///x.jpg', note: '  repotted  ' }, T0);
  assert.equal(list[0].note, 'repotted');
});

test('addEntry replaces rather than duplicates an id, because the id names a file', () => {
  const list = addEntry([entry('a', 0)], { id: 'a', photoUri: 'file:///new.jpg' }, T0 + DAY);
  assert.equal(list.length, 1);
  assert.equal(list[0].photoUri, 'file:///new.jpg');
});

test('addEntry bounds the journal, dropping the oldest', () => {
  let list: GrowthEntry[] = [];
  for (let i = 0; i < MAX_GROWTH_ENTRIES + 5; i++) {
    list = addEntry(list, { id: `e${i}`, photoUri: `file:///${i}.jpg` }, T0 + i * DAY);
  }
  assert.equal(list.length, MAX_GROWTH_ENTRIES);
  assert.equal(list[0].id, `e${MAX_GROWTH_ENTRIES + 4}`);
  assert.ok(!list.some((e) => e.id === 'e0'));
});

test('removeEntry takes only the entry named', () => {
  const list = removeEntry([entry('a', 1), entry('b', 0)], 'a');
  assert.deepEqual(
    list.map((e) => e.id),
    ['b']
  );
  assert.deepEqual(removeEntry(list, 'gone').map((e) => e.id), ['b']);
});

test('repointPhoto moves one entry to its persisted copy and leaves the rest', () => {
  const list = repointPhoto([entry('a', 1), entry('b', 0)], 'a', 'file:///docs/a.jpg');
  assert.equal(list[0].photoUri, 'file:///docs/a.jpg');
  assert.equal(list[1].photoUri, 'file:///photos/b.jpg');
});

test('repointPhoto on a deleted entry is a no-op, not a resurrection', () => {
  const list = repointPhoto([entry('b', 0)], 'a', 'file:///docs/a.jpg');
  assert.deepEqual(
    list.map((e) => e.id),
    ['b']
  );
});

test('setNote writes, rewrites and clears', () => {
  const written = setNote([entry('a', 0)], 'a', '  first flower  ');
  assert.equal(written[0].note, 'first flower');

  const cleared = setNote(written, 'a', '   ');
  assert.equal(cleared.length, 1);
  assert.ok(!('note' in cleared[0]), 'a cleared note leaves no key behind');
});

test('clearing the note of a photoless entry removes the row', () => {
  const orphan: GrowthEntry = { id: 'a', takenAt: new Date(T0).toISOString(), photoUri: '', note: 'x' };
  assert.deepEqual(setNote([orphan], 'a', ''), []);
});

test('growthSpanDays measures the ends, not the count', () => {
  assert.equal(growthSpanDays([]), undefined);
  assert.equal(growthSpanDays([entry('a', 0)]), undefined, 'one photo is a moment');
  assert.equal(growthSpanDays([entry('c', 30), entry('b', 12), entry('a', 0)]), 30);
  /* Three in one afternoon have spanned nothing, and should say so. */
  assert.equal(growthSpanDays([entry('a', 0), entry('b', 0), entry('c', 0)]), 0);
});

test('entryAgeDays floors, and never runs backwards', () => {
  assert.equal(entryAgeDays(entry('a', 0), T0 + 2 * DAY + 3600_000), 2);
  assert.equal(entryAgeDays(entry('a', 0), T0), 0);
  assert.equal(entryAgeDays(entry('a', 5), T0), 0, 'a clock that moved back is not a future photo');
  assert.equal(entryAgeDays({ id: 'x', takenAt: 'junk', photoUri: '' }, T0), 0);
});

test('photoIds names only the entries that own a file', () => {
  const list: GrowthEntry[] = [
    entry('a', 1),
    { id: 'b', takenAt: new Date(T0).toISOString(), photoUri: '', note: 'no picture' },
  ];
  assert.deepEqual(photoIds(list), ['a']);
});
