import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { SOIL_MEDIUM_IDS, buildCarePlan, carePlanPrompt, parseCarePlanBody } from './carePlan.ts';

function soil(days: number) {
  return {
    water: 'Water when the top third dries.',
    waterEveryDays: days,
    waterEveryDaysMax: days + 3,
    fertilizer: 'Balanced feed at half strength.',
    fertilizeEveryDays: 21,
    light: 'Bright indirect.',
    humidity: '60% and up.',
    warnings: [],
  };
}

function everyMedium() {
  const out: Record<string, unknown> = {};
  SOIL_MEDIUM_IDS.forEach((id, i) => (out[id] = soil(5 + i)));
  return out;
}

test('the prompt names every medium the client knows about', () => {
  const prompt = carePlanPrompt('Alocasia', 'Aroids');
  for (const id of SOIL_MEDIUM_IDS) assert.ok(prompt.includes(id), `prompt omits ${id}`);
  assert.ok(prompt.includes('Alocasia'));
});

test('parseCarePlanBody accepts a complete response', () => {
  const parsed = parseCarePlanBody({ bySoil: everyMedium() });
  assert.equal(Object.keys(parsed.bySoil).length, SOIL_MEDIUM_IDS.length);
});

test('parseCarePlanBody rejects a response missing a medium', () => {
  const bySoil = everyMedium();
  delete bySoil.pon;
  assert.throws(() => parseCarePlanBody({ bySoil }), /pon/);
});

test('parseCarePlanBody rejects a non-numeric interval', () => {
  const bySoil = everyMedium();
  (bySoil.leca as Record<string, unknown>).waterEveryDays = 'weekly';
  assert.throws(() => parseCarePlanBody({ bySoil }), /leca/);
});

test('parseCarePlanBody drops keys it does not know, rather than passing them through', () => {
  const bySoil = everyMedium();
  bySoil.martian_regolith = soil(9);
  const parsed = parseCarePlanBody({ bySoil });
  assert.equal('martian_regolith' in parsed.bySoil, false);
});

test('buildCarePlan calls the model once and returns the parsed body', async () => {
  let calls = 0;
  const plan = await buildCarePlan('Alocasia', 'Aroids', {
    askModel: async () => {
      calls++;
      return JSON.stringify({ bySoil: everyMedium() });
    },
  });
  assert.equal(calls, 1);
  assert.equal(plan.bySoil.leca.waterEveryDays > 0, true);
});

test('buildCarePlan surfaces a model answer that is not JSON', async () => {
  await assert.rejects(
    buildCarePlan('Alocasia', 'Aroids', { askModel: async () => 'here you go!' }),
    /not JSON/
  );
});

/*
 * The drift guard, and the most valuable test in this file.
 *
 * The server cannot import from src/ - the app's modules drag React Native
 * globals into the tsconfig.node.json program and break server/diagnose.ts (see
 * the note on RootStackParamList in src/types/index.ts) - so the eight medium
 * ids are physically duplicated. Duplication with no check is drift waiting to
 * happen, and the failure it produces is invisible: the client asks for a
 * medium, the server writes no plan for it, the response fails the client's
 * all-or-nothing validator, and every genus care plan silently stops caching.
 * Reading the client list off disk keeps the two honest without an import.
 */
test('the server medium ids are exactly the client medium ids', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, '..', 'src', 'lib', 'soilMedia.ts'), 'utf8');

  // The SOIL_MEDIA array literal is the client's source of truth; the union
  // type above it is a restatement of the same list, so parsing the entries is
  // what proves the shipped table matches.
  const table = source.slice(source.indexOf('export const SOIL_MEDIA'));
  const clientIds = [...table.matchAll(/^\s*id:\s*'([a-z_]+)'/gm)].map((m) => m[1]);

  assert.ok(clientIds.length > 0, 'could not read the client medium list');
  assert.deepEqual([...SOIL_MEDIUM_IDS], clientIds);
});

/*
 * "Due at day 10, late at day 4" is not a slow watering window, it is a
 * backwards one, and the client renders the range straight onto the schedule.
 * Dropping the max leaves a single honest figure; carrying it through would put
 * a plant into a state that is both due and overdue at once.
 */
test('parseCarePlanBody drops a maximum interval that sits below the minimum', () => {
  const bySoil = everyMedium();
  const sphagnum = bySoil.sphagnum as Record<string, unknown>;
  sphagnum.waterEveryDays = 10;
  sphagnum.waterEveryDaysMax = 4;

  const parsed = parseCarePlanBody({ bySoil });
  assert.equal(parsed.bySoil.sphagnum.waterEveryDays, 10);
  assert.equal(parsed.bySoil.sphagnum.waterEveryDaysMax, undefined);
});
