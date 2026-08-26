import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHealthAssessment, normalizeAssessment, aggregateIdentification } from './diagnose.ts';
import { NotAPlantError } from './diagnose.ts';

/*
 * These cover the OpenAI response-shape contract, which is the one part of the
 * diagnosis path that no amount of correct code can pin down: the model decides
 * the shape at runtime and periodically changes its mind.
 *
 * The object-shaped `issues` case below is not hypothetical - it is the payload
 * that 502'd a live request on 2026-08-18 (r68) while the identical photo had
 * succeeded locally minutes earlier.
 */

const valid = {
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: ['Brown necrotic leaf margins'],
  treatments: [{ title: 'Adjust watering', description: 'Water when dry.', urgent: true }],
  description: 'Some leaf scorch.',
  canBeSaved: true,
};

test('a well-formed assessment passes untouched', () => {
  assert.equal(isHealthAssessment(valid), true);
  assert.equal(normalizeAssessment(valid), valid, 'nothing to fix → same object back');
});

test('object-shaped issues are flattened to strings - the r68 production failure', () => {
  const drifted = {
    ...valid,
    issues: [
      {
        name: 'Brown necrotic leaf margins',
        evidence: 'Several leaves show dry brown edges and tips with yellow halos.',
        likelyCause: 'Water stress or low humidity.',
      },
    ],
  };

  assert.equal(isHealthAssessment(drifted), false, 'guard must still reject the raw shape');

  const fixed = normalizeAssessment(drifted);
  assert.equal(isHealthAssessment(fixed), true, 'normalized shape must validate');
  assert.deepEqual((fixed as typeof valid).issues, [
    'Brown necrotic leaf margins - Several leaves show dry brown edges and tips with yellow halos.',
  ]);
});

test('label and detail are joined, not one at the expense of the other', () => {
  // `name` alone loses the evidence justifying the claim; `evidence` alone
  // loses what the problem is called. A user deserves both.
  const out = normalizeAssessment({ ...valid, issues: [{ name: 'Root rot', evidence: 'Mushy stem base.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Root rot - Mushy stem base.']);
});

test('alternative key spellings the model reaches for are understood', () => {
  const out = normalizeAssessment({
    ...valid,
    issues: [{ issue: 'Spider mites', description: 'Fine webbing under leaves.' }],
  });
  assert.deepEqual((out as typeof valid).issues, ['Spider mites - Fine webbing under leaves.']);
});

test('a lone descriptive field is kept as-is', () => {
  const out = normalizeAssessment({ ...valid, issues: [{ description: 'Yellowing lower leaves.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Yellowing lower leaves.']);
});

test('trailing punctuation on a label does not produce a double separator', () => {
  const out = normalizeAssessment({ ...valid, issues: [{ name: 'Leaf scorch:', evidence: 'Crispy tips.' }] });
  assert.deepEqual((out as typeof valid).issues, ['Leaf scorch - Crispy tips.']);
});

test('unusable issue entries are dropped rather than rendered as junk', () => {
  // A user seeing "[object Object]" or an empty bullet is worse than seeing
  // one fewer issue.
  const out = normalizeAssessment({ ...valid, issues: [null, {}, 42, { name: 'Aphids' }, '  '] });
  assert.deepEqual((out as typeof valid).issues, ['Aphids']);
});

test('an empty issues array survives - healthy plants have no issues', () => {
  const healthy = { ...valid, condition: 'healthy', conditionLabel: 'Healthy', issues: [] };
  assert.equal(isHealthAssessment(normalizeAssessment(healthy)), true);
});

test('normalize repairs shape only - it never invents missing fields', () => {
  // Fabricating a `condition` would put a diagnosis in a pathologist's mouth
  // that the model never made. Missing fields must still fail the guard.
  const noCondition = { conditionLabel: 'X', issues: [{ name: 'Y' }], treatments: [], description: '', canBeSaved: true };
  assert.equal(isHealthAssessment(normalizeAssessment(noCondition)), false);
});

test('a bogus condition value is still rejected after normalizing', () => {
  const bad = { ...valid, condition: 'dying', issues: [{ name: 'Z' }] };
  assert.equal(isHealthAssessment(normalizeAssessment(bad)), false);
});

test('malformed treatments are not rescued - only issues are repaired', () => {
  const bad = { ...valid, treatments: [{ title: 'X' }] };
  assert.equal(isHealthAssessment(normalizeAssessment(bad)), false);
});

test('non-objects pass through without throwing', () => {
  for (const v of [null, undefined, 'string', 42, []]) {
    assert.doesNotThrow(() => normalizeAssessment(v));
    assert.equal(isHealthAssessment(normalizeAssessment(v)), false);
  }
});

// ─── carePlan ────────────────────────────────────────────────────────────────
//
// The care plan is the one advisory field in the assessment. Every test here
// exists to pin down the same rule from a different side: a bad care plan costs
// the user a section, never the diagnosis they paid for.

const carePlan = {
  soil: 'Well-draining aroid mix, peat and perlite',
  light: 'Bright indirect - no direct midday sun',
  water: 'Every 7-10 days, when the top 2cm is dry',
};

test('a complete care plan validates and survives normalizing', () => {
  const withCare = { ...valid, carePlan };
  assert.equal(isHealthAssessment(withCare), true);
  assert.deepEqual((normalizeAssessment(withCare) as typeof withCare).carePlan, carePlan);
});

test('an assessment with no care plan is still valid', () => {
  assert.equal(isHealthAssessment(valid), true);
  assert.equal(normalizeAssessment(valid), valid, 'absent carePlan is not a repair');
});

test('a malformed care plan is dropped, never fatal', () => {
  // The diagnosis is a paid call on a plant that may be dying. Losing it
  // because the model skipped a watering tip would be the wrong trade.
  const cases: unknown[] = [
    { light: 'Bright indirect' }, // missing soil and water
    { soil: 'Loam', light: 'Bright', water: '' }, // empty string renders a blank row
    { soil: 'Loam', light: 'Bright', water: ['weekly'] }, // wrong type
    'water it sometimes', // not an object at all
    null,
  ];

  for (const bad of cases) {
    const out = normalizeAssessment({ ...valid, carePlan: bad }) as Record<string, unknown>;
    assert.equal('carePlan' in out, false, `carePlan should be dropped: ${JSON.stringify(bad)}`);
    assert.equal(isHealthAssessment(out), true, 'the diagnosis itself must still pass');
  }
});

test('a malformed care plan alone does not fail the guard directly', () => {
  // isHealthAssessment is also called on un-normalized input in tests and by
  // any future caller, so it rejects the malformed shape rather than ignoring
  // it - normalize is what turns that rejection into a dropped field.
  assert.equal(isHealthAssessment({ ...valid, carePlan: { soil: 'Loam' } }), false);
});

test('issue flattening and care-plan dropping compose in one pass', () => {
  const drifted = {
    ...valid,
    issues: [{ name: 'Aphids', evidence: 'Clusters on new growth.' }],
    carePlan: { soil: 'Loam' },
  };

  const out = normalizeAssessment(drifted) as Record<string, unknown>;
  assert.equal(isHealthAssessment(out), true);
  assert.deepEqual(out.issues, ['Aphids - Clusters on new growth.']);
  assert.equal('carePlan' in out, false);
});

test('normalizing does not mutate the parsed response', () => {
  const input = { ...valid, carePlan: { soil: 'Loam' } };
  normalizeAssessment(input);
  assert.deepEqual(input.carePlan, { soil: 'Loam' }, 'the caller still holds what it parsed');
});

// ─── watering interval ───────────────────────────────────────────────────────
//
// The interval is what a reminder is scheduled from, so a wrong number is worse
// than no number: it tells the user their plant is fine on the day it dries out.
// These tests pin the rule that bad numbers are stripped while the prose stays.

const withDays = (extra: Record<string, unknown>) => ({
  ...valid,
  carePlan: { ...carePlan, ...extra },
});

test('a numeric watering interval survives normalizing', () => {
  const out = normalizeAssessment(withDays({ waterEveryDays: 7, waterEveryDaysMax: 10 })) as any;
  assert.equal(isHealthAssessment(out), true);
  assert.equal(out.carePlan.waterEveryDays, 7);
  assert.equal(out.carePlan.waterEveryDaysMax, 10);
});

test('a single figure needs no maximum', () => {
  const out = normalizeAssessment(withDays({ waterEveryDays: 14 })) as any;
  assert.equal(isHealthAssessment(out), true);
  assert.equal(out.carePlan.waterEveryDays, 14);
  assert.equal('waterEveryDaysMax' in out.carePlan, false);
});

test('a bad interval loses the number, never the prose', () => {
  // Three correct sentences are worth more than one wrong integer.
  const cases: Record<string, unknown>[] = [
    { waterEveryDays: 0 }, // below the floor
    { waterEveryDays: 400 }, // a year is not a watering interval
    { waterEveryDays: 7.5 }, // days are whole
    { waterEveryDays: '7' }, // string, not number
    { waterEveryDays: NaN },
    { waterEveryDaysMax: 10 }, // a range with no floor cannot be scheduled
  ];

  for (const bad of cases) {
    const out = normalizeAssessment(withDays(bad)) as any;
    assert.equal(isHealthAssessment(out), true, `still a valid assessment: ${JSON.stringify(bad)}`);
    assert.equal(out.carePlan.water, carePlan.water, 'the prose survives');
    assert.equal('waterEveryDays' in out.carePlan, false, JSON.stringify(bad));
    assert.equal('waterEveryDaysMax' in out.carePlan, false, JSON.stringify(bad));
  }
});

test('a maximum below the minimum is dropped, the minimum is kept', () => {
  const out = normalizeAssessment(withDays({ waterEveryDays: 10, waterEveryDaysMax: 3 })) as any;
  assert.equal(isHealthAssessment(out), true);
  assert.equal(out.carePlan.waterEveryDays, 10);
  assert.equal('waterEveryDaysMax' in out.carePlan, false);
});

test('a maximum equal to the minimum is not a range', () => {
  const out = normalizeAssessment(withDays({ waterEveryDays: 7, waterEveryDaysMax: 7 })) as any;
  assert.equal(out.carePlan.waterEveryDays, 7);
  assert.equal('waterEveryDaysMax' in out.carePlan, false, 'nothing to show as "7-7 days"');
});

test('the guard rejects a contradictory interval outright', () => {
  // normalize is what turns these into a dropped field; called directly, the
  // guard must not wave them through.
  assert.equal(isHealthAssessment(withDays({ waterEveryDays: 0 })), false);
  assert.equal(isHealthAssessment(withDays({ waterEveryDays: 10, waterEveryDaysMax: 3 })), false);
  assert.equal(isHealthAssessment(withDays({ waterEveryDaysMax: 10 })), false);
});

test('bad prose with a good number is still dropped entirely', () => {
  // The number alone is unusable: a reminder with no watering advice behind it
  // is a notification the user cannot act on.
  const out = normalizeAssessment({
    ...valid,
    carePlan: { soil: 'Loam', waterEveryDays: 7 },
  }) as Record<string, unknown>;
  assert.equal('carePlan' in out, false);
  assert.equal(isHealthAssessment(out), true);
});

test('a named variety passes untouched', () => {
  const withVariety = { ...valid, variety: 'Thai Constellation' };
  assert.equal(isHealthAssessment(withVariety), true);
  assert.equal(normalizeAssessment(withVariety), withVariety, 'nothing to fix → same object back');
});

test('an empty-string variety is dropped, not fatal', () => {
  const out = normalizeAssessment({ ...valid, variety: '' }) as Record<string, unknown>;
  assert.equal('variety' in out, false);
  assert.equal(isHealthAssessment(out), true);
});

test('a non-string variety is dropped, not fatal', () => {
  const out = normalizeAssessment({ ...valid, variety: 42 }) as Record<string, unknown>;
  assert.equal('variety' in out, false);
  assert.equal(isHealthAssessment(out), true);
});

test('the guard rejects a non-string variety directly', () => {
  assert.equal(isHealthAssessment({ ...valid, variety: 42 }), false);
  assert.equal(isHealthAssessment({ ...valid, variety: '' }), false);
});

/*
 * Genus aggregation. The bug being fixed: a photo the app correctly calls an
 * Anthurium reported "23%" because PlantNet splits its score across the genus's
 * species, and the client then told the user we could not identify their plant.
 */

const res = (score: number, sci: string, genus?: string | null, common?: string) => ({
  score,
  species: {
    scientificName: sci,
    scientificNameWithoutAuthor: sci,
    commonNames: common ? [common] : [],
    ...(genus === null ? {} : { genus: { scientificNameWithoutAuthor: genus ?? sci.split(' ')[0] } }),
  },
});

test('aggregateIdentification: sums the siblings of one genus', () => {
  // The Anthurium case, verbatim: no single species is convincing, the genus is.
  const id = aggregateIdentification([
    res(0.23, 'Anthurium andraeanum', 'Anthurium', 'Flamingo flower'),
    res(0.19, 'Anthurium scherzerianum', 'Anthurium'),
    res(0.14, 'Anthurium clarinervium', 'Anthurium'),
    res(0.09, 'Anthurium crystallinum', 'Anthurium'),
  ]);

  assert.equal(id.confidence, 23, 'the species score is reported unchanged');
  assert.equal(id.genus, 'Anthurium');
  assert.equal(id.genusConfidence, 65, '23 + 19 + 14 + 9');
  assert.equal(id.scientificName, 'Anthurium andraeanum');
  assert.equal(id.commonName, 'Flamingo flower');
});

test('aggregateIdentification: a cross-genus mistake is NOT dressed up as certainty', () => {
  /*
   * The Aug 2026 incident: a Monstera deliciosa came back as Rhaphidophora
   * tetrasperma at 48%. Different genera, so the sum stays low and the client's
   * caveat still fires. This is the test that proves the fix does not simply
   * silence the warning it was asked to remove.
   */
  const id = aggregateIdentification([
    res(0.48, 'Rhaphidophora tetrasperma', 'Rhaphidophora'),
    res(0.31, 'Monstera deliciosa', 'Monstera'),
    res(0.11, 'Epipremnum aureum', 'Epipremnum'),
  ]);

  assert.equal(id.genus, 'Rhaphidophora');
  assert.equal(id.genusConfidence, 48, 'no siblings to sum, so no confidence is invented');
});

test('aggregateIdentification: reports the TOP result genus, not the heaviest', () => {
  /*
   * A heaviest-genus rule would headline "Ficus 60%" over a best guess of
   * Monstera deliciosa - a title its own subtitle contradicts.
   */
  const id = aggregateIdentification([
    res(0.4, 'Monstera deliciosa', 'Monstera'),
    res(0.3, 'Ficus lyrata', 'Ficus'),
    res(0.3, 'Ficus elastica', 'Ficus'),
  ]);

  assert.equal(id.genus, 'Monstera');
  assert.equal(id.genusConfidence, 40);
});

test('aggregateIdentification: falls back to the first token when genus is absent', () => {
  const id = aggregateIdentification([
    { score: 0.5, species: { scientificName: 'Alocasia regal shield', commonName: [] } as any },
    { score: 0.2, species: { scientificName: 'Alocasia amazonica' } as any },
  ]);

  assert.equal(id.genus, 'Alocasia');
  assert.equal(id.genusConfidence, 70);
});

test('aggregateIdentification: a name that does not look like a genus yields none', () => {
  // '×Fatshedera' and friends must not become their own bucket.
  const id = aggregateIdentification([
    { score: 0.6, species: { scientificName: '×Fatshedera lizei' } as any },
  ]);

  assert.equal(id.confidence, 60);
  assert.equal(id.genus, undefined);
  assert.equal(id.genusConfidence, undefined);
});

test('aggregateIdentification: genusConfidence is never below confidence, and is clamped', () => {
  const id = aggregateIdentification([
    res(0.7, 'Ficus lyrata', 'Ficus'),
    res(0.6, 'Ficus elastica', 'Ficus'),
  ]);
  assert.ok(id.genusConfidence! >= id.confidence, 'aggregation may only strengthen');
  assert.equal(id.genusConfidence, 100, 'clamped rather than 130');
});

test('aggregateIdentification: unsorted input still picks the true top', () => {
  const id = aggregateIdentification([
    res(0.1, 'Ficus elastica', 'Ficus'),
    res(0.8, 'Monstera deliciosa', 'Monstera'),
  ]);
  assert.equal(id.scientificName, 'Monstera deliciosa');
});

test('aggregateIdentification: no usable results still throws NotAPlantError', () => {
  // The 422 not_a_plant contract must survive the rewrite.
  assert.throws(() => aggregateIdentification([]), NotAPlantError);
  assert.throws(() => aggregateIdentification([res(0, 'Ficus lyrata', 'Ficus')]), NotAPlantError);
});
