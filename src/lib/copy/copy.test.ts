import test from 'node:test';
import assert from 'node:assert/strict';
import { TREES } from './index.ts';

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
