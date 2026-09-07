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

/*
 * The same check, for the keys the walk above cannot see.
 *
 * The tree deliberately holds FUNCTIONS wherever agreement has to be written as
 * logic rather than squeezed into a format string - plurals, gender, dropping
 * the numeral in the Hebrew singular. There are 92 of them, and every one was
 * invisible to the string walk: a function matches neither of its two branches,
 * so it fell through and was silently skipped. Every one could have returned
 * word-for-word English and the suite would have stayed green (Trello #93).
 *
 * This calls each one in both trees with the same arguments and compares the
 * results, which is the only way to see what a user would actually read.
 *
 * ARGUMENTS. Most take a string or a number, so the tuple is discovered by
 * trying the candidates below and keeping the first that returns a non-empty
 * string from BOTH trees. Anything with a shape of its own needs an entry in
 * ARGS. A function that neither route can call is a FAILURE, not a skip - that
 * silent skip is the whole bug this test exists to remove.
 */
const ARGS: Record<string, unknown[]> = {
  'copy.identity.genusLedBody': [
    { genus: 'Alocasia', genusPercent: 90, plantName: 'Alocasia zebrina', percent: 30 },
  ],
  'copy.diagnosis.identityA11y': [
    {
      prefix: 'Probably',
      headline: 'Alocasia zebrina',
      genusLabel: 'Alocasia',
      species: 'zebrina',
      label: '30% match',
      caveat: 'Check the leaves',
    },
  ],
  'copy.plantCard.a11y': [
    {
      name: 'Steve',
      secondary: 'Alocasia zebrina',
      conditionLabel: 'Healthy',
      when: 'Saved today',
      watering: 'Next water in 5 days',
    },
  ],
};

/*
 * Outputs that are legitimately identical in both languages, with the reason.
 * Keep this list short and justified: every entry is a key nobody is checking
 * any more.
 */
const SHARED_OUTPUT = new Set<string>([
  /*
   * PURE FORMATTERS. Every one of these is `${a}<separator>${b}` with no words
   * of its own, and its inputs reach it already translated - so identical
   * output in both trees is the design, not a missed translation. Each was
   * read and confirmed as such rather than allowlisted to silence a failure.
   *
   * Most are accessibility labels, which is why so many are pure joins: they
   * exist to say several already-translated facts in one utterance.
   *
   * If you add to this list, read the two definitions first. An entry here is
   * a key nobody checks any more.
   */
  'copy.availability.estimate', //      `${bandLabel} · ${confidence}%`
  'copy.speciesPicker.rowA11y', //      `${name}, ${scientific}`
  'copy.statusView.a11y', //            `${title}. ${body}`
  'copy.nurseries.pillA11y', //         `${text}. ${detail}`
  'copy.careHistory.dayA11y', //        `${date}${done}${due}`
  'copy.carePlan.rowA11y', //           `${label}: ${text}`
  'copy.soilCard.optionA11y', //        `${label}. ${description}`
  'copy.portfolio.filterCount', //      `${label} (${n})`
  'copy.home.greetingWithName', //      `${greeting}, ${name}`
  'copy.home.a11yTask', //              `${kind}, ${plants}, ${when}`
  'copy.scheduleCard.settledA11y', //   `${done}. ${label}`
  'copy.scheduleCard.actionA11y', //    `${title}: ${action}.${label}`
]);

test('no Hebrew FUNCTION was left returning its English original', () => {
  const candidates: unknown[] = ['Watering', 3];

  /* Every tuple of the given length drawn from `candidates`, shortest first.
   * Arities here are 1-3, so this is at most 8 attempts. */
  const tuples = (n: number): unknown[][] =>
    n === 0 ? [[]] : tuples(n - 1).flatMap((rest) => candidates.map((c) => [...rest, c]));

  /*
   * A function taking an object does NOT throw when handed a string - it
   * quietly renders "undefined. undefined." and looks like a working call. So a
   * result carrying `undefined` or `NaN` counts as not-callable: those are the
   * fingerprints of the wrong argument shape, and treating them as success is
   * how a key gets "checked" without ever being read.
   */
  const callable = (fn: Function, args: unknown[]): string | null => {
    try {
      const out = fn(...args);
      if (typeof out !== 'string' || out.trim() === '') return null;
      return /undefined|NaN/.test(out) ? null : out;
    } catch {
      return null;
    }
  };

  const checked: string[] = [];
  const walk = (en: unknown, he: unknown, path: string) => {
    if (typeof en === 'function' && typeof he === 'function') {
      const explicit = ARGS[path];
      const args =
        explicit ??
        tuples(en.length).find((t) => callable(en as Function, t) && callable(he as Function, t));

      assert.ok(
        args,
        `${path} could not be called with a string or a number. Add its arguments to ARGS in this file - a function nothing can call is a function nothing is checking.`
      );

      const enOut = callable(en as Function, args);
      const heOut = callable(he as Function, args);
      assert.ok(enOut, `${path} returned nothing from the English tree`);
      assert.ok(heOut, `${path} returned nothing from the Hebrew tree`);

      checked.push(path);
      if (SHARED_OUTPUT.has(path)) return;
      assert.notEqual(heOut, enOut, `${path} still returns the English words: ${JSON.stringify(enOut)}`);
      return;
    }
    if (typeof en === 'object' && en !== null && typeof he === 'object' && he !== null) {
      for (const key of Object.keys(en as Record<string, unknown>)) {
        walk((en as Record<string, unknown>)[key], (he as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
  };
  walk(TREES.en, TREES.he, 'copy');

  /* A floor, not an exact count, so adding copy does not fail the suite - but
   * deleting the walk, or breaking it so it silently matches nothing, does. */
  assert.ok(
    checked.length >= 90,
    `only ${checked.length} function-valued keys were checked; the walk has stopped seeing most of the tree`
  );
});

/*
 * The walk above only compares STRINGS. A function-valued key falls through
 * both branches and is never checked, which is how an untranslated sentence can
 * live in the tree unnoticed - and the schedule card's footer was worse than
 * that, hardcoded in the component where the tree could not see it at all
 * (Trello #77). These assert the two keys that footer now reads.
 */
test('the schedule card footer is translated, not left in English', () => {
  const en = TREES.en.scheduleCard.earlyNote('Watered', 'Watering');
  const he = TREES.he.scheduleCard.earlyNote('הושקה', 'השקיה');
  assert.match(en, /hold/i);
  assert.match(he, /[א-ת]/);
  assert.doesNotMatch(he, /hold|log an early/i, 'the Hebrew footer still contains English');
  assert.notEqual(he, en);
});

test('the reminder confirmation is translated', () => {
  assert.match(TREES.he.scheduleCard.reminderSet, /[א-ת]/);
  assert.notEqual(TREES.he.scheduleCard.reminderSet, TREES.en.scheduleCard.reminderSet);
});

/* The collapsed repot row's only label for a screen reader, and function-valued
 * so the walk above cannot see it. */
test('the expand hint is translated', () => {
  const en = TREES.en.scheduleCard.expandHint('Repotting');
  const he = TREES.he.scheduleCard.expandHint('החלפת עציץ');
  assert.match(he, /[א-ת]/);
  assert.doesNotMatch(he, /show|schedule/i, 'the Hebrew hint still contains English');
  assert.notEqual(he, en);
});

/*
 * The Hebrew footer names the ACTION, the English one names the BUTTON. That is
 * deliberate (see the note in he.ts), and this pins it: threading the button's
 * past-tense label through the Hebrew sentence is exactly the bug that shipped.
 */
test('the Hebrew footer names the action rather than the button label', () => {
  const he = TREES.he.scheduleCard.earlyNote('הושקה', 'השקיה');
  assert.match(he, /השקיה/);
  assert.doesNotMatch(he, /הושקה/);
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
 * The water-all confirmation is the one sentence standing between a tap and
 * every plant's schedule being reset. Since the button stopped protecting
 * against an early mark, this sentence IS the protection.
 */
test('the water-all confirmation warns that not-yet-due plants are included', () => {
  const en = TREES.en.bulkCare.waterConfirmBody(9);
  assert.match(en, /9/);
  assert.match(en, /not due yet/i, 'the consequence must be stated, not implied');
  assert.match(en, /restarts their schedules/i);

  const he = TREES.he.bulkCare.waterConfirmBody(9);
  assert.match(he, /9/);
  assert.match(he, /[א-ת]/);
});

test('the water-all confirmation reads naturally for a single plant', () => {
  for (const lang of ['en', 'he'] as const) {
    const body = TREES[lang].bulkCare.waterConfirmBody(1);
    // No "all 1 plants", and no plural agreement with one.
    assert.doesNotMatch(body, /all 1|1 plants|1 הצמחים/);
  }
});

test('the empty-state copy does not claim nothing is due', () => {
  // It is only reachable with an empty portfolio now, and telling someone with
  // no plants that "nothing is due" is a puzzle rather than an answer.
  for (const lang of ['en', 'he'] as const) {
    assert.doesNotMatch(TREES[lang].bulkCare.waterNothingTitle, /due|מה להשקות/i);
  }
});
