import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './watering.ts';
import { SOIL_MEDIUM_IDS } from './soilMedia.ts';
import { dueSoon, filterPortfolio, plantDisplayName, plantSecondaryName } from './portfolio.ts';
import type { GenusCarePlan, SoilCarePlan } from './genusCarePlan.ts';
import type { StoredPlant } from '../services/plantStore.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

function scanned(id: string, lastWateredDaysAgo: number, everyDays = 7): StoredPlant {
  return {
    id,
    savedAt: new Date(NOW - 30 * DAY_MS).toISOString(),
    photoUri: `file://${id}.jpg`,
    addedVia: 'scan',
    lastWateredAt: new Date(NOW - lastWateredDaysAgo * DAY_MS).toISOString(),
    diagnosis: {
      plantName: 'Monstera',
      scientificName: 'Monstera deliciosa',
      condition: 'healthy',
      conditionLabel: 'Healthy',
      issues: [],
      treatments: [],
      canBeSaved: true,
      confidence: 90,
      description: '',
      carePlan: { soil: '', light: '', water: '', waterEveryDays: everyDays },
    },
  };
}

function manual(id: string, nickname?: string): StoredPlant {
  return {
    id,
    savedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
    photoUri: `file://${id}.jpg`,
    addedVia: 'manual',
    soilMedium: 'leca',
    ...(nickname ? { nickname } : {}),
    species: {
      name: 'Dragon Scale Mint Variegated',
      scientificName: 'Alocasia baginda',
      genus: 'Alocasia',
      family: 'Aroids',
    },
  };
}

test('the All filter keeps every plant, in order', () => {
  const plants = [manual('m1'), scanned('s1', 1)];
  assert.deepEqual(filterPortfolio(plants, 'all').map((p) => p.id), ['m1', 's1']);
});

test('the Diagnosed filter keeps only plants that carry a diagnosis', () => {
  const plants = [manual('m1'), scanned('s1', 1)];
  assert.deepEqual(filterPortfolio(plants, 'diagnosed').map((p) => p.id), ['s1']);
});

test('a manual plant that was later scanned counts as diagnosed', () => {
  const both = { ...manual('m1'), diagnosis: scanned('s1', 1).diagnosis };
  assert.deepEqual(filterPortfolio([both], 'diagnosed').map((p) => p.id), ['m1']);
});

test('dueSoon lists plants due or overdue within the window', () => {
  const plants = [
    scanned('overdue', 20, 7),
    scanned('due-today', 7, 7),
    scanned('due-in-two-days', 5, 7),
    scanned('due-next-month', 0, 30),
  ];
  const due = dueSoon(plants, NOW, null);
  assert.deepEqual(due.map((d) => d.plant.id), ['overdue', 'due-today', 'due-in-two-days']);
  assert.equal(due[0].kind, 'water');
});

test('dueSoon puts the most overdue first', () => {
  const plants = [scanned('slightly', 8, 7), scanned('badly', 30, 7)];
  assert.deepEqual(dueSoon(plants, NOW, null).map((d) => d.plant.id), ['badly', 'slightly']);
});

test('a plant with no schedule is not due, rather than being due forever', () => {
  assert.deepEqual(dueSoon([manual('m1')], NOW, null), []);
});

test('plantDisplayName prefers the nickname, then the species, then the diagnosis', () => {
  assert.equal(plantDisplayName(manual('m1', 'Ziggy')), 'Ziggy');
  assert.equal(plantDisplayName(manual('m1')), 'Dragon Scale Mint Variegated');
  assert.equal(plantDisplayName(scanned('s1', 1)), 'Monstera');
  assert.equal(
    plantDisplayName({ ...manual('m1'), species: undefined, diagnosis: undefined } as StoredPlant),
    'Unnamed plant'
  );
});

/*
 * The three below are ours. The strip's whole justification is that a user does
 * not open nine plants to find out what needs doing, so "reports every kind",
 * "prefers the real interval over the guessed one" and "does not print the same
 * name twice" are the three ways it can quietly stop being worth the space.
 */

test('dueSoon reports feeding as well as watering', () => {
  /* Fed 25 days ago against the 21-28 day fallback window: due, not overdue,
   * and invisible unless dueSoon walks kinds other than water. */
  const hungry: StoredPlant = {
    ...scanned('hungry', 0, 30),
    lastFertilizedAt: new Date(NOW - 25 * DAY_MS).toISOString(),
  };
  const due = dueSoon([hungry], NOW, null);
  assert.deepEqual(due.map((d) => d.kind), ['fertilizer']);
  assert.equal(due[0].plant.id, 'hungry');
  assert.equal(due[0].daysUntilDue, -4);
  assert.equal(due[0].label, 'Due now');
});

test('a cached genus plan sets the due date, not the diagnosis interval', () => {
  /* The diagnosis says every 30 days and the plant was watered 5 days ago, so
   * on the diagnosis alone it is 25 days out and nowhere near the strip. The
   * genus plan says LECA wants water every 3 days, which makes it overdue. */
  const plant: StoredPlant = { ...scanned('leca-fern', 5, 30), soilMedium: 'leca' };

  assert.deepEqual(dueSoon([plant], NOW, null), []);

  const soil = (days: number): SoilCarePlan => ({
    water: 'Water when the reservoir empties',
    waterEveryDays: days,
    fertilizer: 'Feed every water',
    fertilizeEveryDays: 7,
    light: 'Bright indirect',
    humidity: '60%',
  });
  const genusPlan: GenusCarePlan = {
    genus: 'Monstera',
    family: 'Aroids',
    fetchedAt: new Date(NOW).toISOString(),
    bySoil: Object.fromEntries(
      SOIL_MEDIUM_IDS.map((id) => [id, soil(id === 'leca' ? 3 : 30)])
    ) as GenusCarePlan['bySoil'],
  };

  const due = dueSoon([plant], NOW, () => genusPlan);
  assert.deepEqual(due.map((d) => d.kind), ['water']);
  assert.equal(due[0].daysUntilDue, -2);
});

test('plantSecondaryName does not repeat the primary name back at the user', () => {
  assert.equal(plantSecondaryName(manual('m1')), 'Alocasia baginda');
  assert.equal(plantSecondaryName(manual('m1', 'Ziggy')), 'Dragon Scale Mint Variegated');
  assert.equal(plantSecondaryName(scanned('s1', 1)), 'Monstera deliciosa');
  /* The camera named it by its botanical name, so the botanical line under it
   * would be the same string a second time. */
  const same = scanned('s2', 1);
  same.diagnosis!.plantName = 'Monstera deliciosa';
  assert.equal(plantSecondaryName(same), '');
});
