import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud.ts';
import type { PlantDiagnosis } from '../types/index.ts';
import type { StoredPlant } from './plantStore.ts';

const species = {
  name: 'Monstera Deliciosa',
  scientificName: 'Monstera deliciosa',
  genus: 'Monstera',
  family: 'Araceae',
};

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


/*
 * A CloudRow with the Portfolio columns filled in as absent.
 *
 * Written once rather than repeated at every fixture: `CloudRow` gained nine
 * fields when the Portfolio tab's data was carried into the cloud, and spelling
 * them out per literal is how a tenth field turns into eight separate edits.
 */
function row(over: Partial<CloudRow> & Pick<CloudRow, 'id' | 'user_id' | 'saved_at'>): CloudRow {
  return {
    photo_path: null,
    diagnosis,
    added_via: 'scan',
    catalog_id: null,
    species: null,
    soil_medium: null,
    nickname: null,
    last_watered_at: null,
    watering_log: [],
    last_repotted_at: null,
    repot_log: [],
    last_fertilized_at: null,
    fertilizer_log: [],
    reminder_id: null,
    ...over,
  };
}

function fakeDeps(seed: { rows?: CloudRow[]; uploadFails?: Set<string>; insertFails?: Set<string> } = {}) {
  const rows = new Map((seed.rows ?? []).map((r) => [r.id, r]));
  const uploads: string[] = [];
  /* Rows exactly as written, in order - `rows` is keyed and merged, so it
   * cannot show what a single insert actually carried. */
  const inserted: CloudRow[] = [];

  const deps: CloudDeps = {
    fetchPlants: async () => [...rows.values()],
    uploadPhoto: async (path, sourceUri) => {
      uploads.push(path);
      if (seed.uploadFails?.has(sourceUri)) return null;
      return path;
    },
    insertPlant: async (row) => {
      if (seed.insertFails?.has(row.id)) return false;
      inserted.push(row);
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
  return { deps, rows, uploads, inserted };
}

test('fetchAll() maps cloud rows back to StoredPlant shape', async () => {
  const { deps } = fakeDeps({
    rows: [
      row({
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      }),
      row({
        id: 'p2',
        user_id: 'u1',
        saved_at: '2026-08-02T00:00:00.000Z',
        photo_path: 'u1/p2.jpg',
        diagnosis,
        last_watered_at: '2026-08-10T00:00:00.000Z',
        watering_log: ['2026-08-05T00:00:00.000Z', '2026-08-10T00:00:00.000Z'],
        reminder_id: 'rem-1',
      }),
    ],
  });
  const cloud = createCloudPlantLibrary(deps);
  const plants = await cloud.fetchAll();
  assert.equal(plants.length, 2);
  assert.equal(plants[0].id, 'p1');
  assert.equal(plants[0].photoUri, 'u1/p1.jpg');
  assert.equal(plants[0].diagnosis?.plantName, 'Mini monstera');
  assert.equal(plants[0].lastWateredAt, undefined);

  const p2 = plants[1];
  assert.equal(p2.id, 'p2');
  assert.equal(p2.lastWateredAt, '2026-08-10T00:00:00.000Z');
  assert.deepEqual(p2.wateringLog, ['2026-08-05T00:00:00.000Z', '2026-08-10T00:00:00.000Z']);
  assert.equal(p2.reminderId, 'rem-1');
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

test('savePlant() normalises the photo extension the same way photoStore does', async () => {
  const cases: Array<[string, string]> = [
    ['file:///x/a.JPEG', 'jpeg'],
    ['file:///x/no-dot', 'jpg'],
    ['file:///x/a.verylongextension', 'jpg'],
    ['file:///x.dir/name', 'jpg'],
  ];

  for (const [photoUri, expectedExt] of cases) {
    const { deps, uploads } = fakeDeps();
    const cloud = createCloudPlantLibrary(deps, { newId: () => 'fixed-id' });
    const result = await cloud.savePlant('u1', { photoUri, diagnosis });

    assert.equal(result.ok, true);
    assert.equal(uploads[0], `u1/fixed-id.${expectedExt}`);
    if (result.ok) assert.equal(result.plant.photoUri, `u1/fixed-id.${expectedExt}`);
  }
});

test('a plant with no photo is inserted without uploading one', async () => {
  const { deps, uploads } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps, { newId: () => 'fixed-id' });

  // The Portfolio tab's hand-added plant: no picture is a real answer, and
  // pushing a zero-byte object for it would leave an object the sweep has to
  // reason about and a path the reader cannot render.
  const result = await cloud.saveManualPlant('u1', { photoUri: '', species });

  assert.equal(result.ok, true);
  assert.deepEqual(uploads, []);
  if (result.ok) {
    assert.equal(result.plant.photoUri, '');
    assert.equal(result.plant.addedVia, 'manual');
    assert.deepEqual(result.plant.species, species);
    assert.equal(result.plant.diagnosis, undefined);
  }
});

test('saveManualPlant() carries the whole hand-added record to the row', async () => {
  const { deps, inserted } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps, { newId: () => 'fixed-id' });

  const result = await cloud.saveManualPlant('u1', {
    photoUri: 'file:///cache/a.png',
    species,
    catalogId: 'cat-1',
    soilMedium: 'leca',
    nickname: 'Steve',
  });

  assert.equal(result.ok, true);
  const row = inserted[0];
  assert.equal(row.added_via, 'manual');
  assert.equal(row.catalog_id, 'cat-1');
  assert.equal(row.soil_medium, 'leca');
  assert.equal(row.nickname, 'Steve');
  assert.equal(row.diagnosis, null);
  assert.equal(row.photo_path, 'u1/fixed-id.png');
  // Round-trips back to exactly what was asked for - the mirror is written
  // from this, so a field dropped here is a field the user loses.
  if (result.ok) {
    assert.equal(result.plant.nickname, 'Steve');
    assert.equal(result.plant.soilMedium, 'leca');
    assert.equal(result.plant.catalogId, 'cat-1');
  }
});

test('an imported plant keeps its portfolio fields', async () => {
  const { deps, inserted } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps, {});

  await cloud.importBatch('u1', [
    {
      id: 'p1',
      savedAt: '2026-08-01T00:00:00.000Z',
      photoUri: 'file:///cache/a.jpg',
      addedVia: 'manual',
      species,
      soilMedium: 'leca',
      nickname: 'Steve',
      lastRepottedAt: '2026-08-02T00:00:00.000Z',
      repotLog: ['2026-08-02T00:00:00.000Z'],
    },
  ]);

  const row = inserted[0];
  assert.equal(row.added_via, 'manual');
  assert.equal(row.nickname, 'Steve');
  assert.equal(row.soil_medium, 'leca');
  assert.equal(row.last_repotted_at, '2026-08-02T00:00:00.000Z');
  assert.deepEqual(row.repot_log, ['2026-08-02T00:00:00.000Z']);
});

test('updatePlant() patches an existing row', async () => {
  const { deps } = fakeDeps({
    rows: [
      row({
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      }),
    ],
  });
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.updatePlant('p1', { lastWateredAt: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(result, { ok: true });

  const plants = await cloud.fetchAll();
  assert.equal(plants[0].lastWateredAt, '2026-08-15T00:00:00.000Z');
});

test('updatePlant() reports network failure when the underlying dep call fails', async () => {
  const { deps } = fakeDeps({
    rows: [
      row({
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      }),
    ],
  });
  (deps.updatePlant as any) = async () => false;
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.updatePlant('p1', { lastWateredAt: '2026-08-15T00:00:00.000Z' });
  assert.deepEqual(result, { ok: false, reason: 'network' });
});

test('removePlant() deletes an existing row', async () => {
  const { deps } = fakeDeps({
    rows: [
      row({
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      }),
    ],
  });
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.removePlant('p1');
  assert.deepEqual(result, { ok: true });

  const plants = await cloud.fetchAll();
  assert.equal(plants.length, 0);
});

test('removePlant() reports network failure when the underlying dep call fails', async () => {
  const { deps } = fakeDeps({
    rows: [
      row({
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      }),
    ],
  });
  (deps.deletePlant as any) = async () => false;
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.removePlant('p1');
  assert.deepEqual(result, { ok: false, reason: 'network' });
});

test('importBatch() reports per-plant success/failure and does not stop on one failure', async () => {
  const local: StoredPlant[] = [
    { id: 'l1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'file:///a.jpg', addedVia: 'scan', diagnosis },
    { id: 'l2', savedAt: '2026-08-02T00:00:00.000Z', photoUri: 'file:///b.jpg', addedVia: 'scan', diagnosis },
  ];
  const { deps } = fakeDeps({ insertFails: new Set(['l2']) });
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.importBatch('u1', local);
  assert.deepEqual(result.imported.sort(), ['l1']);
  assert.deepEqual(result.failed.sort(), ['l2']);
});
