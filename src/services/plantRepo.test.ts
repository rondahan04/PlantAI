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

function fakeCloudDeps(fail: { insert?: boolean; upload?: boolean; insertIds?: Set<string> } = {}) {
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
      const existing = rows.get(id);
      if (!existing) return false;
      rows.set(id, { ...existing, ...patch });
      return true;
    },
    deletePlant: async (id) => rows.delete(id),
  };
  return { deps, rows };
}

function makeRepo(
  opts: { hint?: boolean; cloudFail?: { insert?: boolean; upload?: boolean; insertIds?: Set<string> } } = {}
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

test('loadLocal() reads the guest key when logged out, the mirror when logged in', () => {
  const { repo, guest, mirror, setHint } = makeRepo({ hint: false });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);

  setHint(true);
  assert.equal(repo.loadLocal().plants.length, 0);
  mirror.save({ photoUri: 'b.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);
});
