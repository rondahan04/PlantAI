import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud.ts';
import type { PlantDiagnosis } from '../types/index.ts';
import type { StoredPlant } from './plantStore.ts';

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

function fakeDeps(seed: { rows?: CloudRow[]; uploadFails?: Set<string>; insertFails?: Set<string> } = {}) {
  const rows = new Map((seed.rows ?? []).map((r) => [r.id, r]));
  const uploads: string[] = [];

  const deps: CloudDeps = {
    fetchPlants: async () => [...rows.values()],
    uploadPhoto: async (path, sourceUri) => {
      uploads.push(path);
      if (seed.uploadFails?.has(sourceUri)) return null;
      return path;
    },
    insertPlant: async (row) => {
      if (seed.insertFails?.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
    updatePlant: async (id, patch) => {
      const existing = rows.get(id);
      if (!existing) return false;
      rows.set(id, { ...existing, ...patch });
      return true;
    },
    deletePlant: async (id) => {
      rows.delete(id);
      return true;
    },
  };
  return { deps, rows, uploads };
}

test('fetchAll() maps cloud rows back to StoredPlant shape', async () => {
  const { deps } = fakeDeps({
    rows: [
      {
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      },
    ],
  });
  const cloud = createCloudPlantLibrary(deps);
  const plants = await cloud.fetchAll();
  assert.equal(plants.length, 1);
  assert.equal(plants[0].id, 'p1');
  assert.equal(plants[0].photoUri, 'u1/p1.jpg');
  assert.equal(plants[0].diagnosis.plantName, 'Mini monstera');
  assert.equal(plants[0].lastWateredAt, undefined);
});

test('savePlant() uploads the photo then inserts the row', async () => {
  const { deps, uploads } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps);
  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });

  assert.equal(result.ok, true);
  assert.equal(uploads.length, 1);
  if (result.ok) assert.match(result.plant.photoUri, /^u1\//);
});

test('savePlant() still inserts the row when the photo upload fails', async () => {
  const { deps } = fakeDeps({ uploadFails: new Set(['file:///cache/a.jpg']) });
  const cloud = createCloudPlantLibrary(deps);
  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plant.photoUri, '');
});

test('savePlant() reports failure when the insert itself fails', async () => {
  const { deps } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps, { newId: () => 'fixed-id' });
  (deps.insertPlant as any) = async () => false;

  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });
  assert.equal(result.ok, false);
});

test('importBatch() reports per-plant success/failure and does not stop on one failure', async () => {
  const local: StoredPlant[] = [
    { id: 'l1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'file:///a.jpg', diagnosis },
    { id: 'l2', savedAt: '2026-08-02T00:00:00.000Z', photoUri: 'file:///b.jpg', diagnosis },
  ];
  const { deps } = fakeDeps({ insertFails: new Set(['l2']) });
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.importBatch('u1', local);
  assert.deepEqual(result.imported.sort(), ['l1']);
  assert.deepEqual(result.failed.sort(), ['l2']);
});
