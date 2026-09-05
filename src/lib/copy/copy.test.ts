import test from 'node:test';
import assert from 'node:assert/strict';
import { TREES } from './index.ts';
import { SOIL_MEDIUM_IDS } from '../soilMedia.ts';
import { EN_IDENTITY_COPY } from '../confidence.ts';

test('every language names itself in its own script', () => {
  // A picker that offers "Hebrew" to someone who only reads Hebrew is a picker
  // they cannot use. Both rows are labelled in the language they select.
  assert.equal(TREES.en.language.english, 'English');
  assert.equal(TREES.en.language.hebrew, 'עברית');
  assert.equal(TREES.he.language.english, 'English');
  assert.equal(TREES.he.language.hebrew, 'עברית');
});

test('the relaunch notice is actually translated, not left in English', () => {
  assert.notEqual(TREES.he.language.relaunchNotice, TREES.en.language.relaunchNotice);
  assert.match(TREES.he.language.relaunchNotice, /[א-ת]/);
});

test('a count reads naturally in both languages', () => {
  // Hebrew does not say "1 plants", and it drops the numeral entirely in the
  // singular. The tree holds functions precisely so agreement is written as
  // logic rather than squeezed into a format string.
  assert.equal(TREES.en.importBanner.title(1), 'Import your 1 saved plant?');
  assert.equal(TREES.en.importBanner.title(3), 'Import your 3 saved plants?');
  assert.equal(TREES.he.importBanner.title(1), 'לייבא את הצמח השמור שלך?');
  assert.equal(TREES.he.importBanner.title(3), 'לייבא את 3 הצמחים השמורים שלך?');
});

test('no Hebrew string was left as its English original', () => {
  // Catches the copy-paste-and-forget failure that tsc cannot see: a key that
  // exists, typechecks, and still says the English words.
  const shared = new Set(['English', 'עברית', 'PlantAI', 'OK']);
  const walk = (en: unknown, he: unknown, path: string) => {
    if (typeof en === 'string' && typeof he === 'string') {
      if (shared.has(en)) return;
      assert.notEqual(he, en, `${path} is still English`);
      return;
    }
    if (typeof en === 'object' && en !== null && typeof he === 'object' && he !== null) {
      for (const key of Object.keys(en as Record<string, unknown>)) {
        walk((en as Record<string, unknown>)[key], (he as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
  };
  walk(TREES.en, TREES.he, 'copy');
});

test('every growing medium has copy in both languages', () => {
  // The overlay is keyed by soilMedia.ts's ids, and this is what stops a ninth
  // medium being added there and silently rendering English - or undefined.
  for (const id of SOIL_MEDIUM_IDS) {
    for (const lang of ['en', 'he'] as const) {
      assert.ok(TREES[lang].soilMedia[id]?.label, `${lang}.${id} label`);
      assert.ok(TREES[lang].soilMedia[id]?.description, `${lang}.${id} description`);
    }
  }
});

test('the English identity copy matches the default inside lib/confidence', () => {
  // Two copies of these sentences exist on purpose: confidence.ts needs a
  // default so its own tests and every pre-Hebrew caller keep working, and the
  // copy tree needs them so Hebrew has something to sit beside. This asserts
  // they have not drifted apart.
  const en = TREES.en.identity;
  assert.equal(en.speciesMatch(42), EN_IDENTITY_COPY.speciesMatch(42));
  assert.equal(en.genusMatch(42), EN_IDENTITY_COPY.genusMatch(42));
  assert.equal(en.probably, EN_IDENTITY_COPY.probably);
  assert.equal(en.possibly, EN_IDENTITY_COPY.possibly);
  assert.equal(en.genusLedTitle, EN_IDENTITY_COPY.genusLedTitle);
  const genusArgs = { genus: 'Alocasia', genusPercent: 90, plantName: 'X', percent: 30 };
  assert.equal(en.genusLedBody(genusArgs), EN_IDENTITY_COPY.genusLedBody(genusArgs));
  assert.equal(en.moderateTitle, EN_IDENTITY_COPY.moderateTitle);
  assert.equal(en.moderateBody('X'), EN_IDENTITY_COPY.moderateBody('X'));
  assert.equal(en.lowTitle, EN_IDENTITY_COPY.lowTitle);
  assert.equal(en.lowBody('X'), EN_IDENTITY_COPY.lowBody('X'));
});

/*
 * The water-all confirmation is the one sentence that tells a user what a bulk
 * action is about to do to their whole library, and it now assembles itself
 * from two counts. Both grammar bugs below were real and were caught by
 * printing the sentences rather than by reading the code.
 */
test('the water-all confirmation never uses a plural verb for one plant', () => {
  for (const lang of ['en', 'he'] as const) {
    const body = TREES[lang].bulkCare.waterConfirmBody;
    // "Only those 1 of your 9 plants are marked" / "1 צריכים"
    assert.doesNotMatch(body(1, 9, 1), /those 1|1 צריכים|1 עוד לא הושקו/);
    assert.doesNotMatch(body(1, 9, 0), /those 1|1 צריכים|1 עוד לא הושקו/);
  }
});

test('the water-all confirmation names both reasons when the batch has both', () => {
  const en = TREES.en.bulkCare.waterConfirmBody(6, 9, 2);
  // 4 due + 2 first-water: the user is agreeing to 6, and to why.
  assert.match(en, /4 are due or overdue/);
  assert.match(en, /2 have never been watered/);
  assert.match(en, /6 of your 9/);

  const he = TREES.he.bulkCare.waterConfirmBody(6, 9, 2);
  assert.match(he, /4/);
  assert.match(he, /2/);
  assert.match(he, /[א-ת]/);
});

test('the water-all confirmation says nothing about due dates when nothing is due', () => {
  // A library of brand new plants: calling them "overdue" would be a lie, and
  // it is the first thing a new user would see.
  const en = TREES.en.bulkCare.waterConfirmBody(3, 3, 3);
  assert.doesNotMatch(en, /due|overdue/);
  assert.match(en, /never been watered/);

  const he = TREES.he.bulkCare.waterConfirmBody(3, 3, 3);
  assert.doesNotMatch(he, /מאחר|צריכים השקיה/);
});

test('the water-all confirmation joins Hebrew clauses with the right conjunction', () => {
  // "ו-2" before a numeral, "וצמח" before a word.
  assert.match(TREES.he.bulkCare.waterConfirmBody(6, 9, 2), /ו-2/);
  assert.doesNotMatch(TREES.he.bulkCare.waterConfirmBody(3, 3, 1), /ו-צמח/);
});
