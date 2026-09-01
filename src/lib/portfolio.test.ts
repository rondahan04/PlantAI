import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './watering.ts';
import { SOIL_MEDIUM_IDS } from './soilMedia.ts';
import {
  dueSoon,
  filterPortfolio,
  isBehindOnCare,
  plantSchedule,
  offersGuestImport,
  plantDisplayName,
  plantSecondaryName,
  showsLibraryLayout,
} from './portfolio.ts';
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

/*
 * The import-offer predicates. Both of these were bugs on a real device: guest
 * plants survived a signup on disk but became invisible and un-importable, and
 * an empty Portfolio is indistinguishable from a deletion the user never asked
 * for.
 */

test('the import offer is not made while logged out - there is nowhere to import to', () => {
  assert.equal(offersGuestImport({ loggedIn: false, guestCount: 3 }), false);
});

test('the import offer is made to a logged-in user holding guest plants', () => {
  assert.equal(offersGuestImport({ loggedIn: true, guestCount: 3 }), true);
});

test('no guest plants, no offer', () => {
  assert.equal(offersGuestImport({ loggedIn: true, guestCount: 0 }), false);
});

test('a fresh account with an empty mirror still gets the library layout when plants await import', () => {
  // The bug: `hasPlants` reads the cloud mirror, which is empty for a brand new
  // account, so the screen fell through to the first-run layout - the one
  // layout that does NOT render the import banner. The plants were on disk the
  // whole time with no way to reach them.
  assert.equal(
    showsLibraryLayout({ plantCount: 0, libraryReadable: true, offeringImport: true }),
    true
  );
});

test('a genuinely empty library with nothing to import gets the first-run layout', () => {
  assert.equal(
    showsLibraryLayout({ plantCount: 0, libraryReadable: true, offeringImport: false }),
    false
  );
});

test('a library that failed to load never shows first-run copy', () => {
  // "You have no plants" over a library that merely failed to parse is the same
  // false deletion story from the other direction.
  assert.equal(
    showsLibraryLayout({ plantCount: 0, libraryReadable: false, offeringImport: false }),
    true
  );
});

test('any saved plant gets the library layout', () => {
  assert.equal(
    showsLibraryLayout({ plantCount: 1, libraryReadable: true, offeringImport: false }),
    true
  );
});

test('a card shows all three care kinds, in a fixed order, whatever is scheduled', () => {
  const slots = plantSchedule(scanned('s1', 1), NOW, null);
  assert.deepEqual(slots.map((s) => s.kind), ['water', 'repot', 'fertilizer']);
});

test('a kind with a schedule nobody has started shows the interval, not a date', () => {
  // A diagnosed plant gets house feeding and repotting intervals even though
  // the diagnosis only spoke about water - so the slot has something true to
  // say, and says the interval rather than inventing a due date from a care
  // event that never happened.
  const slots = plantSchedule(scanned('s1', 1), NOW, null);
  const byKind = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.equal(byKind.water.label, 'In 6 days');
  assert.equal(byKind.fertilizer.status, 'never_watered');
  assert.equal(byKind.fertilizer.label, 'Every 3 weeks');
});

test('a kind with no schedule anywhere says so rather than disappearing', () => {
  /*
   * A hand-added plant with no diagnosis and no genus plan has no watering
   * interval - nothing in the app knows how often this species drinks. Feeding
   * and repotting run on house intervals that apply to any potted plant, so
   * only the water slot is genuinely empty, and it says so rather than
   * rendering a blank column that reads as a broken card.
   */
  const slots = plantSchedule(manual('m1'), NOW, null);
  const byKind = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.equal(byKind.water.status, 'unscheduled');
  assert.equal(byKind.water.label, 'Not set');
  assert.equal(byKind.repot.status, 'never_watered');
});

test('the genus plan fills the slots the plant itself has no schedule for', () => {
  const perMedium: SoilCarePlan = {
    water: 'Weekly',
    waterEveryDays: 7,
    fertilizer: 'Feed monthly in growth',
    fertilizeEveryDays: 21,
    light: 'Bright indirect',
    humidity: '60%',
  };
  const genus: GenusCarePlan = {
    genus: 'Monstera',
    family: 'Aroids',
    fetchedAt: new Date(NOW).toISOString(),
    bySoil: Object.fromEntries(SOIL_MEDIUM_IDS.map((id) => [id, perMedium])) as GenusCarePlan['bySoil'],
  };
  // The plant has to be in a medium for the genus plan to apply - `bySoil` is
  // keyed by medium, and a plant with none has nothing to look up.
  const plant = { ...scanned('s1', 1), soilMedium: 'leca' as const };
  const slots = plantSchedule(plant, NOW, genus);
  const byKind = Object.fromEntries(slots.map((s) => [s.kind, s]));
  assert.notEqual(byKind.fertilizer.status, 'unscheduled');
  assert.notEqual(byKind.fertilizer.label, 'Not set');
  assert.notEqual(byKind.repot.label, 'Not set');
});

test('a slot reads short: today, tomorrow, or a day count', () => {
  assert.equal(plantSchedule(scanned('due', 7), NOW, null)[0].label, 'Today');
  assert.equal(plantSchedule(scanned('tomorrow', 6), NOW, null)[0].label, 'Tomorrow');
  assert.equal(plantSchedule(scanned('later', 2), NOW, null)[0].label, 'In 5 days');
  assert.equal(plantSchedule(scanned('late', 12), NOW, null)[0].label, 'Overdue');
});

test('behind on care means due today or late, never merely upcoming', () => {
  assert.equal(isBehindOnCare(plantSchedule(scanned('late', 12), NOW, null)), true);
  assert.equal(isBehindOnCare(plantSchedule(scanned('due', 7), NOW, null)), true);
  assert.equal(isBehindOnCare(plantSchedule(scanned('fine', 1), NOW, null)), false);
});

test('the Needs care filter keeps the plants the caller says are behind', () => {
  const late = scanned('late', 12);
  const fine = scanned('fine', 1);
  const behind = (p: StoredPlant) => isBehindOnCare(plantSchedule(p, NOW, null));
  assert.deepEqual(
    filterPortfolio([late, fine], 'needsCare', behind).map((p) => p.id),
    ['late']
  );
});

test('Needs care with no predicate hides nothing rather than claiming all is well', () => {
  const plants = [scanned('late', 12), manual('m1')];
  assert.equal(filterPortfolio(plants, 'needsCare').length, 2);
});
