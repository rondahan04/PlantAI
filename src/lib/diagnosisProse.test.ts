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
  assert.equal(languageOf({ ...EN, lang: 'he' }), 'he', 'the tag wins when present');
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
