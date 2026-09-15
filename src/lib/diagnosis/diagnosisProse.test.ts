/**
 * Unit tests for the two-language diagnosis cache.
 * Run: node --test src/lib/diagnosisProse.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  proseOf,
  withProse,
  languageOf,
  cachedProse,
  rememberProse,
  resolveForLanguage,
  needsCallFor,
  staleIdsFor,
} from './diagnosisProse.ts';

const EN: any = {
  plantName: 'Anthurium',
  scientificName: 'Anthurium clarinervium',
  condition: 'moderate',
  conditionLabel: 'Moderate decline',
  confidence: 0.23,
  canBeSaved: true,
  description: 'The plant is alive but has substantial leaf chlorosis.',
  issues: ['Widespread yellowing.', 'Brown margins.'],
  treatments: [
    {
      title: 'Provide balanced nutrition',
      description: 'Feed lightly.',
      urgent: false,
      product: 'Balanced aroid fertilizer',
    },
  ],
  carePlan: {
    soil: 'Airy aroid mix',
    light: 'Bright indirect',
    water: 'When the top 2cm is dry',
    waterEveryDays: 7,
    waterEveryDaysMax: 10,
  },
};

const HE_PROSE = {
  description: 'הצמח חי אך יש כלורוזה נרחבת.',
  issues: ['הצהבה נרחבת.', 'שוליים חומים.'],
  treatments: [{ title: 'לספק תזונה מאוזנת', description: 'דשנו קלות.', productLabel: 'דשן מאוזן' }],
  carePlan: { soil: 'תערובת מאווררת', light: 'אור עקיף בהיר', water: 'כששני ס"מ עליונים יבשים' },
};

/*
 * The bug the whole cache exists for: translating used to REPLACE the prose,
 * so switching back cost exactly as much as switching out.
 */
test('switching back is free - the original is kept, not overwritten', () => {
  const he = rememberProse(EN, 'he', HE_PROSE);
  assert.equal(he.lang, 'he');
  assert.equal(he.description, HE_PROSE.description);

  const back = resolveForLanguage(he, 'en');
  assert.ok(back.hit, 'English must come from the cache, not the network');
  assert.equal(back.diagnosis.description, EN.description);
  assert.equal(back.diagnosis.treatments[0].title, 'Provide balanced nutrition');

  // ...and forward again, still free.
  assert.ok(resolveForLanguage(back.diagnosis, 'he').hit);
  assert.equal(resolveForLanguage(back.diagnosis, 'he').diagnosis.description, HE_PROSE.description);
});

/*
 * The watering reminder is scheduled from `waterEveryDays`. A translation that
 * dropped it would silently unschedule the plant - the failure would show up
 * days later as a notification that never arrived.
 */
test('the watering interval survives a translation', () => {
  const plan = rememberProse(EN, 'he', HE_PROSE).carePlan;
  assert.ok(plan, 'the plan is still there at all');
  assert.equal(plan.waterEveryDays, 7);
  assert.equal(plan.waterEveryDaysMax, 10);
  assert.equal(plan.water, HE_PROSE.carePlan.water, 'the sentence still moved');
});

/*
 * `product` is typed into an Israeli shop's search box. Translating it is how
 * the buy button stops finding anything.
 */
test('the shop search term is never translated, only its label', () => {
  const he = rememberProse(EN, 'he', HE_PROSE);
  assert.equal(he.treatments[0].product, 'Balanced aroid fertilizer');
  assert.equal(he.treatments[0].productLabel, 'דשן מאוזן');
});

test('the enums and numbers the client branches on are untouched', () => {
  const he = rememberProse(EN, 'he', HE_PROSE);
  assert.equal(he.condition, 'moderate');
  assert.equal(he.confidence, 0.23);
  assert.equal(he.scientificName, 'Anthurium clarinervium');
  assert.equal(he.treatments[0].urgent, false);
});

/*
 * A cached copy is data on disk that may have been written by an older build.
 * It must not be able to add or drop a treatment.
 */
test('a cached copy with the wrong shape cannot lose a treatment', () => {
  const two = { ...EN, treatments: [EN.treatments[0], { ...EN.treatments[0], title: 'Check roots' }] };
  const short = withProse(two, { ...HE_PROSE, treatments: [HE_PROSE.treatments[0]] });
  assert.equal(short.treatments.length, 2);
  assert.equal(short.treatments[1].title, 'Check roots', 'untranslated, not missing');
});

test('a record with no care plan does not grow one', () => {
  const bare = { ...EN, carePlan: undefined };
  assert.equal(withProse(bare, HE_PROSE).carePlan, undefined);
});

/* Records written before `lang` existed are exactly the ones that need
 * sorting out, so they fall back to reading the script. */
test('an old record with no lang tag is read by its script', () => {
  assert.equal(languageOf(EN), 'en');
  assert.equal(languageOf({ ...EN, ...HE_PROSE, treatments: HE_PROSE.treatments } as any), 'he');
  // A Hebrew record naming a Latin binomial is still a Hebrew record - reading
  // it as English would re-translate something already correct, and bill for it.
  assert.equal(
    languageOf({ ...EN, description: 'כלורוזה על Monstera deliciosa.', issues: [], treatments: [] } as any),
    'he'
  );
  /* An honest tag is the answer, and saves re-running the script test. */
  assert.equal(languageOf({ ...EN, lang: 'en' }), 'en', 'the tag wins when the prose agrees');

  /*
   * The mirror of the poisoned record below: English prose wrongly tagged
   * Hebrew. It used to be believed, which meant a Hebrew reader was shown
   * English forever and the record was never queued to be fixed. The prose is
   * the evidence; the tag is only a note about it.
   */
  assert.equal(languageOf({ ...EN, lang: 'he' }), 'en', 'a tag the prose contradicts is not believed');
});

test('resolving to the language it is already in stamps the tag and spends nothing', () => {
  const out = resolveForLanguage(EN, 'en');
  assert.ok(out.hit);
  assert.equal(out.diagnosis.lang, 'en');
  assert.equal(out.diagnosis.description, EN.description);
});

test('a miss is a miss - nothing is invented', () => {
  const out = resolveForLanguage(EN, 'he');
  assert.ok(!out.hit);
  assert.equal(out.diagnosis, EN, 'unchanged, so the caller can leave it alone');
});

test('cachedProse answers for both directions once filed', () => {
  const he = rememberProse(EN, 'he', HE_PROSE);
  assert.equal(cachedProse(he, 'he')?.description, HE_PROSE.description);
  assert.equal(cachedProse(he, 'en')?.description, EN.description);
  assert.equal(cachedProse(EN, 'he'), undefined);
});

/* A batch must not bill for plants there is nothing to do to. */
test('the batch selects only what a call would actually change', () => {
  assert.ok(needsCallFor(EN, 'he'));
  assert.ok(!needsCallFor(EN, 'en'));
  assert.ok(!needsCallFor(rememberProse(EN, 'he', HE_PROSE), 'en'));
  assert.ok(!needsCallFor(undefined, 'he'));
  assert.ok(
    !needsCallFor({ ...EN, description: '  ', issues: [] }, 'he'),
    'an empty diagnosis is nothing to translate'
  );
});

test('proseOf leaves names and numbers behind', () => {
  const p = proseOf(EN) as any;
  assert.equal(p.scientificName, undefined);
  assert.equal(p.condition, undefined);
  assert.equal(p.carePlan.waterEveryDays, undefined);
  assert.equal(p.treatments[0].product, undefined);
  assert.equal(p.treatments[0].productLabel, 'Balanced aroid fertilizer', 'falls back to the term');
});

/*
 * The Portfolio screen re-reads its library every time a translation lands, so
 * the plant array gets a NEW IDENTITY several times a second during a run.
 * An effect keyed on that identity re-fired, started another pass, emitted,
 * and re-fired itself - "Maximum update depth exceeded". Keying on WHICH
 * plants are stale instead makes the answer stable across those reloads, so
 * the effect fires only when the work genuinely changes.
 */
test('the stale set is the ids only, so it is stable across library reloads', () => {
  const plants = [
    { id: 'a', diagnosis: EN },
    { id: 'b', diagnosis: undefined },
    { id: 'c', diagnosis: EN },
  ];
  assert.deepEqual(staleIdsFor(plants, 'he'), ['a', 'c']);
  assert.deepEqual(staleIdsFor(plants, 'en'), [], 'already in this language');

  /* A fresh array of fresh objects holding the same records answers the same,
   * which is the whole property the effect depends on. */
  const reloaded = plants.map((p) => ({ ...p, diagnosis: p.diagnosis && { ...p.diagnosis } }));
  assert.deepEqual(staleIdsFor(reloaded, 'he').join(','), staleIdsFor(plants, 'he').join(','));
});

test('a plant translated mid-run drops out of the stale set', () => {
  const plants = [
    { id: 'a', diagnosis: rememberProse(EN, 'he', HE_PROSE) },
    { id: 'b', diagnosis: EN },
  ];
  assert.deepEqual(staleIdsFor(plants, 'he'), ['b'], 'only the one still owing a call');
});

/*
 * THE POISONED RECORD.
 *
 * Both ends of the translate call fall back to the ORIGINAL text for any field
 * the model did not return cleanly, and neither used to check that anything
 * had changed. So one flaky answer produced a 200 carrying untouched Hebrew,
 * which was filed as the English copy and stamped `lang: 'en'`.
 *
 * After that the record answered "already English" to every reader, was never
 * queued again, and sat in Hebrew under English headings forever - no network
 * involved, which is why it survived every fix to the transport.
 *
 * The prose is the evidence; the tag is only a note about it. When they
 * plainly contradict each other, believe the prose.
 */
/* A record whose prose really is Hebrew, built the way a translated one is. */
const HE: any = withProse(EN, HE_PROSE);

const POISONED: any = {
  ...HE,
  lang: 'en',
  translations: { en: proseOf(HE) },
};

test('a lang tag the prose plainly contradicts is not believed', () => {
  assert.equal(languageOf(POISONED), 'he', 'the words are Hebrew, whatever the tag says');
});

test('a poisoned record is picked up for translation again', () => {
  assert.ok(needsCallFor(POISONED, 'en'), 'it owes a call it was wrongly credited with');
  assert.deepEqual(staleIdsFor([{ id: 'a', diagnosis: POISONED }], 'en'), ['a']);
});

test('the bogus cached copy is not handed back as a hit', () => {
  const out = resolveForLanguage(POISONED, 'en');
  assert.equal(out.hit, false, 'a cached copy in the wrong language is not a hit');
});

/*
 * The distrust is deliberately narrow, matching `needsTranslation`: a record
 * whose prose carries ANY Latin is left alone. A false positive costs a billed
 * call and rewrites a record that was fine; a false negative just leaves the
 * user reading what they are reading today.
 */
test('an honest tag is still authoritative', () => {
  assert.equal(languageOf({ ...EN, lang: 'en' }), 'en');
  assert.equal(languageOf({ ...HE, lang: 'he' }), 'he');
  assert.ok(!needsCallFor({ ...EN, lang: 'en' }, 'en'));
});

test('a mixed-script record keeps its tag - the test stays conservative', () => {
  const mixed: any = { ...HE, lang: 'en', description: `${HE.description} pH 6.5 Anthurium` };
  assert.equal(languageOf(mixed), 'en', 'Latin present, so the tag is not overruled');
});
