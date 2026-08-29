import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlantRepo } from './plantRepo.ts';
import { createPlantStore, type StorageDeps } from './plantStore.ts';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud.ts';
import type { PlantDiagnosis } from '../types/index.ts';

const diagnosis: PlantDiagnosis = {
  plantName: 'Mini monstera',
  scientificName: 'Rhaphidophora tetrasperma',
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: [],
  treatments: [],
  canBeSaved: true,
  confidence: 50,
  description: '',
};

function memoryStorage(): StorageDeps {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function fakeCloudDeps(
  fail: { insert?: boolean; upload?: boolean; insertIds?: Set<string>; update?: boolean; delete?: boolean } = {}
) {
  const rows = new Map<string, CloudRow>();
  const deps: CloudDeps = {
    fetchPlants: async () => [...rows.values()],
    uploadPhoto: async (path) => (fail.upload ? null : path),
    insertPlant: async (row) => {
      if (fail.insert || fail.insertIds?.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
    updatePlant: async (id, patch) => {
      if (fail.update) return false;
      const existing = rows.get(id);
      if (!existing) return false;
      rows.set(id, { ...existing, ...patch });
      return true;
    },
    deletePlant: async (id) => {
      if (fail.delete) return false;
      return rows.delete(id);
    },
  };
  return { deps, rows };
}

function makeRepo(
  opts: {
    hint?: boolean;
    cloudFail?: { insert?: boolean; upload?: boolean; insertIds?: Set<string>; update?: boolean; delete?: boolean };
  } = {}
) {
  let hint = opts.hint ?? false;
  const guest = createPlantStore(memoryStorage());
  const mirror = createPlantStore(memoryStorage());
  const { deps, rows } = fakeCloudDeps(opts.cloudFail);
  const cloud = createCloudPlantLibrary(deps, { newId: () => `cloud-${rows.size + 1}` });

  const repo = createPlantRepo({
    guest,
    mirror,
    cloud,
    getSessionHint: () => hint,
    getUserId: () => (hint ? 'u1' : null),
  });
  return { repo, guest, mirror, rows, setHint: (v: boolean) => (hint = v) };
}

test('logged out: save() passes straight through to the guest store', async () => {
  const { repo, guest } = makeRepo({ hint: false });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, true);
  assert.equal(guest.load().plants.length, 1);
});

test('logged in: save() writes to cloud first, then mirrors locally', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, true);
  assert.equal(rows.size, 1);
  assert.equal(mirror.load().plants.length, 1);
});

test('logged in: a cloud write failure applies nowhere, not even the mirror', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true, cloudFail: { insert: true } });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, false);
  assert.equal(rows.size, 0);
  assert.equal(mirror.load().plants.length, 0);
});

test('hasUnimportedGuestPlants() is true only when the guest key has entries', async () => {
  const { repo, guest } = makeRepo({ hint: true });
  assert.equal(repo.hasUnimportedGuestPlants(), false);
  guest.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(repo.hasUnimportedGuestPlants(), true);
});

test('guestPlantCount() reports how many local plants are unimported', () => {
  const { repo, guest } = makeRepo({ hint: true });
  assert.equal(repo.guestPlantCount(), 0);
  guest.save({ photoUri: 'a.jpg', diagnosis });
  guest.save({ photoUri: 'b.jpg', diagnosis });
  assert.equal(repo.guestPlantCount(), 2);
});

test('importGuestPlants() clears the guest key only when every plant imports', async () => {
  const { repo, guest, mirror, rows } = makeRepo({ hint: true });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  guest.save({ photoUri: 'b.jpg', diagnosis });

  const result = await repo.importGuestPlants();
  assert.equal(result.failed.length, 0);
  assert.equal(rows.size, 2);
  assert.equal(guest.load().plants.length, 0);
  assert.equal(mirror.load().plants.length, 2);
});

test('importGuestPlants() leaves the guest key untouched on partial failure', async () => {
  const guest = createPlantStore(memoryStorage());
  const mirror = createPlantStore(memoryStorage());
  const first = guest.save({ photoUri: 'a.jpg', diagnosis });
  const second = guest.save({ photoUri: 'b.jpg', diagnosis });
  assert.ok(first.ok && second.ok);
  const secondId = second.ok ? second.plant.id : '';

  const { deps, rows } = fakeCloudDeps({ insertIds: new Set([secondId]) });
  const cloud = createCloudPlantLibrary(deps);
  const repo = createPlantRepo({
    guest,
    mirror,
    cloud,
    getSessionHint: () => true,
    getUserId: () => 'u1',
  });

  const result = await repo.importGuestPlants();
  assert.deepEqual(result.failed, [secondId]);
  assert.equal(rows.size, 1);
  assert.equal(guest.load().plants.length, 2);
  assert.equal(mirror.load().plants.length, 0);
});

test('wipeMirror() clears the mirror but never the guest key', async () => {
  const { repo, guest, mirror } = makeRepo({ hint: true });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  mirror.save({ photoUri: 'b.jpg', diagnosis });

  repo.wipeMirror();
  assert.equal(mirror.load().plants.length, 0);
  assert.equal(guest.load().plants.length, 1);
});

test('wipeAllLocal() clears the guest key as well - account deletion erases everything', async () => {
  const { repo, guest, mirror } = makeRepo({ hint: true });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  mirror.save({ photoUri: 'b.jpg', diagnosis });

  repo.wipeAllLocal();
  assert.equal(mirror.load().plants.length, 0);
  assert.equal(guest.load().plants.length, 0);
});

test('loadLocal() reads the guest key when logged out, the mirror when logged in', () => {
  const { repo, guest, mirror, setHint } = makeRepo({ hint: false });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);

  setHint(true);
  assert.equal(repo.loadLocal().plants.length, 0);
  mirror.save({ photoUri: 'b.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);
});

test('logged in: markWatered() updates the mirror and clears any pending reminder', async () => {
  const { repo, mirror } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';

  const at = Date.parse('2026-01-01T00:00:00.000Z');
  const result = await repo.markWatered(id, at);
  assert.equal(result.ok, true);

  const plant = mirror.load().plants.find((p) => p.id === id);
  assert.equal(plant?.lastWateredAt, new Date(at).toISOString());
  assert.deepEqual(plant?.wateringLog, [new Date(at).toISOString()]);
});

test('logged in: markWatered() leaves the mirror untouched on a cloud failure', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';
  const before = mirror.load().plants.find((p) => p.id === id);

  const { deps, rows: failRows } = fakeCloudDeps({ update: true });
  for (const [rowId, row] of rows) failRows.set(rowId, row);
  const cloud = createCloudPlantLibrary(deps);
  const failingRepo = createPlantRepo({
    guest: createPlantStore(memoryStorage()),
    mirror,
    cloud,
    getSessionHint: () => true,
    getUserId: () => 'u1',
  });

  const result = await failingRepo.markWatered(id, Date.now());
  assert.equal(result.ok, false);
  const after = mirror.load().plants.find((p) => p.id === id);
  assert.deepEqual(after, before);
});

test('logged in: markWatered() on an unknown id reports not_found', async () => {
  const { repo } = makeRepo({ hint: true });
  const result = await repo.markWatered('missing', Date.now());
  assert.deepEqual(result, { ok: false, reason: 'not_found' });
});

test('logged in: update() sets a reminderId in the mirror', async () => {
  const { repo, mirror } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';

  const result = await repo.update(id, { reminderId: 'rem-1' });
  assert.equal(result.ok, true);
  assert.equal(mirror.load().plants.find((p) => p.id === id)?.reminderId, 'rem-1');
});

test('logged in: update() explicitly clearing reminderId removes it from the mirror', async () => {
  const { repo, mirror } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';

  await repo.update(id, { reminderId: 'rem-1' });
  const result = await repo.update(id, { reminderId: undefined });
  assert.equal(result.ok, true);
  assert.equal(mirror.load().plants.find((p) => p.id === id)?.reminderId, undefined);
});

test('logged in: update() on an unknown id reports not_found', async () => {
  const { repo } = makeRepo({ hint: true });
  const result = await repo.update('missing', { reminderId: 'rem-1' });
  assert.deepEqual(result, { ok: false, reason: 'not_found' });
});

test('logged in: remove() deletes from cloud and the mirror on success', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';

  const result = await repo.remove(id);
  assert.equal(result.ok, true);
  assert.equal(mirror.load().plants.find((p) => p.id === id), undefined);
  assert.equal(rows.has(id), false);
});

test('logged in: remove() leaves the mirror untouched on a cloud failure', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.ok(saved.ok);
  const id = saved.ok ? saved.plant.id : '';

  const { deps, rows: failRows } = fakeCloudDeps({ delete: true });
  for (const [rowId, row] of rows) failRows.set(rowId, row);
  const cloud = createCloudPlantLibrary(deps);
  const failingRepo = createPlantRepo({
    guest: createPlantStore(memoryStorage()),
    mirror,
    cloud,
    getSessionHint: () => true,
    getUserId: () => 'u1',
  });

  const result = await failingRepo.remove(id);
  assert.equal(result.ok, false);
  assert.ok(mirror.load().plants.find((p) => p.id === id));
});

/*
 * The Portfolio tab's paths through the facade. Everything below exercises a
 * plant that was typed in rather than photographed, and the care kinds that
 * schedule nothing - the two doors added after Epic 3a was first written, and
 * the two that would have silently stayed guest-only.
 */

const species = {
  name: 'Monstera Deliciosa',
  scientificName: 'Monstera deliciosa',
  genus: 'Monstera',
  family: 'Araceae',
};

test('logged out: saveManual() passes straight through to the guest store', async () => {
  const { repo, guest } = makeRepo({ hint: false });
  const result = await repo.saveManual({ photoUri: '', species, nickname: 'Steve' });
  assert.equal(result.ok, true);
  assert.equal(guest.load().plants.length, 1);
  assert.equal(guest.load().plants[0].addedVia, 'manual');
});

test('logged in: saveManual() writes the whole record to the cloud', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const result = await repo.saveManual({
    photoUri: '',
    species,
    catalogId: 'cat-1',
    soilMedium: 'leca',
    nickname: 'Steve',
  });

  assert.equal(result.ok, true);
  const row = [...rows.values()][0];
  assert.equal(row.added_via, 'manual');
  assert.equal(row.nickname, 'Steve');
  assert.equal(row.soil_medium, 'leca');
  assert.equal(row.catalog_id, 'cat-1');
  assert.equal(row.diagnosis, null);
  // The mirror is the read path for every screen - a field that reached the
  // cloud but not the mirror looks like data loss until the next cold start.
  assert.equal(mirror.load().plants[0].nickname, 'Steve');
});

test('logged in: a failed manual save leaves nothing behind, not even locally', async () => {
  const { repo, guest, mirror, rows } = makeRepo({ hint: true, cloudFail: { insert: true } });
  const result = await repo.saveManual({ photoUri: '', species });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'network');
  assert.equal(rows.size, 0);
  assert.equal(mirror.load().plants.length, 0);
  // The guest key in particular: a plant stranded there is invisible to
  // wipeMirror() and to account deletion.
  assert.equal(guest.load().plants.length, 0);
});

test('logged in: markCare() logs a repot to the cloud and the mirror together', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const at = Date.parse('2026-08-20T09:00:00.000Z');
  const logged = await repo.markCare(saved.plant.id, 'repot', at);
  assert.equal(logged.ok, true);

  const row = rows.get(saved.plant.id);
  assert.equal(row?.last_repotted_at, '2026-08-20T09:00:00.000Z');
  assert.deepEqual(row?.repot_log, ['2026-08-20T09:00:00.000Z']);
  assert.equal(mirror.load().plants[0].lastRepottedAt, '2026-08-20T09:00:00.000Z');
});

test('logged in: two repots on the same day count once, exactly as the guest store folds them', async () => {
  const { repo, rows } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const morning = new Date(2026, 7, 20, 9, 0, 0);
  const evening = new Date(2026, 7, 20, 18, 0, 0);
  await repo.markCare(saved.plant.id, 'repot', morning.getTime());
  await repo.markCare(saved.plant.id, 'repot', evening.getTime());

  assert.deepEqual(rows.get(saved.plant.id)?.repot_log, [evening.toISOString()]);
});

test('logged in: a repot that fails in the cloud is not shown as recorded', async () => {
  const { repo, mirror } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const { repo: broken } = makeRepo({ hint: true, cloudFail: { update: true } });
  const loggedOnBroken = await broken.markCare('missing', 'fertilizer', Date.now());
  assert.equal(loggedOnBroken.ok, false);
  assert.equal(mirror.load().plants[0].lastFertilizedAt, undefined);
});

test('logged in: update() carries a growing-medium change to the cloud', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species, soilMedium: 'potting_mix' });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const updated = await repo.update(saved.plant.id, { soilMedium: 'leca' });
  assert.equal(updated.ok, true);
  assert.equal(rows.get(saved.plant.id)?.soil_medium, 'leca');
  assert.equal(mirror.load().plants[0].soilMedium, 'leca');
});

test('logged in: clearing a nickname clears it in the cloud, rather than leaving the old one', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species, nickname: 'Steve' });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const updated = await repo.update(saved.plant.id, { nickname: undefined });
  assert.equal(updated.ok, true);
  assert.equal(rows.get(saved.plant.id)?.nickname, null);
  assert.equal(mirror.load().plants[0].nickname, undefined);
});

test('logged in: a watered plant carries its full record back from the cloud', async () => {
  const { repo, rows } = makeRepo({ hint: true });
  const saved = await repo.saveManual({ photoUri: '', species, nickname: 'Steve' });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  await repo.markWatered(saved.plant.id, Date.parse('2026-08-20T09:00:00.000Z'));
  const refreshed = await repo.refreshFromCloud();

  // The round trip through `fetchAll` is where a column missing from `toRow`
  // or `toStoredPlant` shows up as a field the user silently loses.
  const plant = refreshed.plants.find((p) => p.id === saved.plant.id);
  assert.equal(plant?.nickname, 'Steve');
  assert.equal(plant?.addedVia, 'manual');
  assert.equal(plant?.lastWateredAt, '2026-08-20T09:00:00.000Z');
  assert.equal(rows.get(saved.plant.id)?.added_via, 'manual');
});
