/**
 * Unit tests for translating an already-saved diagnosis.
 * Run: node --test server/translateDiagnosis.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  translateDiagnosis,
  translatePrompt,
  applyTranslation,
  tooLarge,
  TranslateError,
  MAX_FIELD_CHARS,
  MAX_LIST,
  type TranslatableFields,
} from './translateDiagnosis.ts';

const FIELDS: TranslatableFields = {
  description: 'The plant is alive but has substantial leaf chlorosis.',
  issues: ['Widespread yellowing.', 'Brown margins.'],
  treatments: [
    { title: 'Provide balanced nutrition', description: 'Feed lightly.', productLabel: 'Balanced aroid fertilizer' },
    { title: 'Check roots', description: 'Ensure the pot drains.', productLabel: '' },
  ],
};

const ask = (answer: string) => ({ askModel: async () => answer });

test('the Hebrew prompt asks for Hebrew and carries the text', () => {
  const prompt = translatePrompt(FIELDS, 'he');
  assert.match(prompt, /Hebrew/);
  assert.match(prompt, /substantial leaf chlorosis/);
});

/*
 * The whole point of translating rather than re-diagnosing: the finding is
 * settled, only the words change. A prompt that let the model reconsider
 * would hand the user a different verdict on a plant that has not changed.
 */
test('the prompt forbids re-diagnosing', () => {
  const prompt = translatePrompt(FIELDS, 'he');
  assert.match(prompt, /do NOT re-diagnose/);
  assert.match(prompt, /botanical names in Latin/);
});

test('a translation comes back in the same shape', async () => {
  const out = await translateDiagnosis(
    FIELDS,
    ask(
      JSON.stringify({
        description: 'הצמח חי אך יש כלורוזה נרחבת.',
        issues: ['הצהבה נרחבת.', 'שוליים חומים.'],
        treatments: [
          { title: 'לספק תזונה מאוזנת', description: 'דשנו קלות.', productLabel: 'דשן מאוזן לארואידים' },
          { title: 'לבדוק שורשים', description: 'ודאו ניקוז.', productLabel: '' },
        ],
      })
    ),
    'he'
  );

  assert.equal(out.description, 'הצמח חי אך יש כלורוזה נרחבת.');
  assert.equal(out.issues.length, 2);
  assert.equal(out.treatments[1].title, 'לבדוק שורשים');
  assert.equal(out.treatments[0].productLabel, 'דשן מאוזן לארואידים');
});

/*
 * The record is rebuilt from OUR structure, never from the model's. A model
 * that drops a treatment or invents a sixth issue must not be able to put a
 * hole in a saved diagnosis - the worst case is a line left untranslated.
 */
test('a short answer leaves the missing lines in the language they were in', () => {
  const out = applyTranslation(FIELDS, { description: 'תיאור', issues: ['הצהבה.'] });
  assert.equal(out.description, 'תיאור');
  assert.equal(out.issues[0], 'הצהבה.');
  assert.equal(out.issues[1], 'Brown margins.', 'the untranslated one survives');
  assert.equal(out.treatments.length, 2, 'no treatment is lost');
  assert.equal(out.treatments[0].title, 'Provide balanced nutrition');
});

test('extra items the model invented are discarded', () => {
  const out = applyTranslation(FIELDS, {
    issues: ['א', 'ב', 'ג', 'ד'],
    treatments: [{ title: 'x', description: 'y', productLabel: 'z' }, {}, {}, {}],
  });
  assert.equal(out.issues.length, 2);
  assert.equal(out.treatments.length, 2);
});

test('a blank or non-string field is not a translation', () => {
  const out = applyTranslation(FIELDS, { description: '   ', issues: [42] });
  assert.equal(out.description, FIELDS.description);
  assert.equal(out.issues[0], FIELDS.issues[0]);
});

test('a care plan round-trips, and an absent one is not invented', async () => {
  const withPlan: TranslatableFields = {
    ...FIELDS,
    carePlan: { light: 'Bright indirect', water: 'Every 7 days', humidity: '60%', soil: 'Airy mix', warnings: ['Do not overwater'] },
  };
  const out = applyTranslation(withPlan, {
    carePlan: { light: 'אור עקיף בהיר', warnings: ['לא להשקות יתר על המידה'] },
  });
  assert.equal(out.carePlan?.light, 'אור עקיף בהיר');
  assert.equal(out.carePlan?.water, 'Every 7 days');
  assert.equal(out.carePlan?.warnings[0], 'לא להשקות יתר על המידה');

  assert.equal(applyTranslation(FIELDS, { carePlan: { light: 'x' } }).carePlan, undefined);
});

test('a non-JSON answer is a TranslateError, not a crash', async () => {
  await assert.rejects(() => translateDiagnosis(FIELDS, ask('sorry, I cannot'), 'he'), TranslateError);
});

/*
 * The text goes straight into a prompt, so without a cap this endpoint is an
 * open text-completion proxy on someone else's key.
 */
test('an oversized request is rejected before it reaches the model', () => {
  assert.equal(tooLarge(FIELDS), null);
  assert.match(
    tooLarge({ ...FIELDS, description: 'x'.repeat(MAX_FIELD_CHARS + 1) }) ?? '',
    /too long/
  );
  assert.match(
    tooLarge({ ...FIELDS, issues: Array(MAX_LIST + 1).fill('x') }) ?? '',
    /too many issues/
  );
  assert.match(
    tooLarge({ ...FIELDS, issues: Array(MAX_LIST).fill('x'.repeat(1900)) }) ?? '',
    /text is too long/
  );
});

/*
 * A 200 carrying the text we sent is not a translation.
 *
 * `applyTranslation` falls back to the ORIGINAL for every field the model did
 * not return cleanly - deliberately, so a bad answer cannot put a hole in a
 * record. But when EVERY field falls back there is nothing left to hand over,
 * and answering 200 with the input is how the client came to file untouched
 * Hebrew as the English copy and stamp the record as translated. That record
 * then claimed to be English forever and was never queued again.
 *
 * So: nothing changed is a failure, and says so.
 */
test('a model answer that changes nothing is a failure, not a 200', async () => {
  const fields = {
    description: 'הצמח חי אך יש כלורוזה נרחבת.',
    issues: ['הצהבה נרחבת.'],
    treatments: [{ title: 'לספק תזונה מאוזנת', description: 'דשנו קלות.', productLabel: 'דשן מאוזן' }],
  };
  await assert.rejects(
    () => translateDiagnosis(fields, { askModel: async () => '{}' }, 'en'),
    (err: any) => err.name === 'TranslateError' && /nothing/i.test(err.detail),
    'an empty answer falls back to every original, which is no translation at all'
  );
});

test('a partial answer still counts - one real line is a translation', async () => {
  const fields = {
    description: 'הצמח חי אך יש כלורוזה נרחבת.',
    issues: ['הצהבה נרחבת.'],
    treatments: [],
  };
  const out = await translateDiagnosis(
    fields,
    { askModel: async () => JSON.stringify({ description: 'The plant is alive.' }) },
    'en'
  );
  assert.equal(out.description, 'The plant is alive.');
  assert.equal(out.issues[0], fields.issues[0], 'the line it skipped keeps its own words');
});
