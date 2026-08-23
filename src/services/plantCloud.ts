import type { PlantDiagnosis } from '../types';
import type { StoredPlant } from './plantStore';
import { photoExtension } from './photoStore.ts';

/*
 * Row shape as it lives in `public.plants` (see the Epic 3a migration).
 * `photo_path` is a Storage object path ("<user_id>/<id>.<ext>"), not a URL -
 * the bucket is private, so callers resolve it to a signed URL separately
 * (the real binding, `supabasePlantCloud.ts`, does this; tests here treat the
 * path as opaque).
 */
export interface CloudRow {
  id: string;
  user_id: string;
  saved_at: string;
  photo_path: string | null;
  diagnosis: PlantDiagnosis;
  last_watered_at: string | null;
  watering_log: string[] | null;
  reminder_id: string | null;
}

/*
 * The seam that keeps this module testable without a network - mirrors
 * `StorageDeps` (plantStore.ts) and `PhotoDeps` (photoStore.ts). Each method
 * is one round trip; `plantCloud.ts` owns orchestration (upload-then-insert,
 * batch-with-partial-failure), never raw Supabase calls.
 */
export interface CloudDeps {
  fetchPlants(): Promise<CloudRow[]>;
  /* Returns the stored path on success, null if the upload did not land -
   * never throws, mirroring photoStore's `adopt()`. */
  uploadPhoto(path: string, sourceUri: string): Promise<string | null>;
  insertPlant(row: CloudRow): Promise<boolean>;
  updatePlant(id: string, patch: Partial<CloudRow>): Promise<boolean>;
  deletePlant(id: string): Promise<boolean>;
}

export interface CloudOptions {
  now?: () => number;
  newId?: () => string;
}

export type CloudSaveResult =
  | { ok: true; plant: StoredPlant }
  | { ok: false; reason: 'network' };

export type CloudMutateResult = { ok: true } | { ok: false; reason: 'network' | 'not_found' };

export interface ImportBatchResult {
  imported: string[];
  failed: string[];
}

function toStoredPlant(row: CloudRow): StoredPlant {
  const plant: StoredPlant = {
    id: row.id,
    savedAt: row.saved_at,
    photoUri: row.photo_path ?? '',
    diagnosis: row.diagnosis,
  };
  if (row.last_watered_at) plant.lastWateredAt = row.last_watered_at;
  if (row.watering_log && row.watering_log.length > 0) plant.wateringLog = row.watering_log;
  if (row.reminder_id) plant.reminderId = row.reminder_id;
  return plant;
}

export function createCloudPlantLibrary(deps: CloudDeps, opts: CloudOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId =
    opts.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  async function fetchAll(): Promise<StoredPlant[]> {
    const rows = await deps.fetchPlants();
    return rows.map(toStoredPlant);
  }

  /*
   * Upload then insert, in that order and NOT awaited-together: a photo that
   * fails to upload still leaves a real, findable plant - the same tolerance
   * `photoStore.adopt()` has for a dead source URI. A row that fails to
   * insert is the one failure mode this reports, since an unfindable plant is
   * the one thing 3a promises never happens silently.
   */
  async function savePlant(
    userId: string,
    input: { photoUri: string; diagnosis: PlantDiagnosis }
  ): Promise<CloudSaveResult> {
    const id = newId();
    const path = `${userId}/${id}.${photoExtension(input.photoUri)}`;
    const uploaded = await deps.uploadPhoto(path, input.photoUri);

    const row: CloudRow = {
      id,
      user_id: userId,
      saved_at: new Date(now()).toISOString(),
      photo_path: uploaded,
      diagnosis: input.diagnosis,
      last_watered_at: null,
      watering_log: [],
      reminder_id: null,
    };

    if (!(await deps.insertPlant(row))) return { ok: false, reason: 'network' };
    return { ok: true, plant: toStoredPlant(row) };
  }

  async function updatePlant(
    id: string,
    patch: Partial<{ lastWateredAt: string | null; reminderId: string | null; wateringLog: string[] }>
  ): Promise<CloudMutateResult> {
    const rowPatch: Partial<CloudRow> = {};
    if ('lastWateredAt' in patch) rowPatch.last_watered_at = patch.lastWateredAt ?? null;
    if ('reminderId' in patch) rowPatch.reminder_id = patch.reminderId ?? null;
    if ('wateringLog' in patch) rowPatch.watering_log = patch.wateringLog ?? [];

    return (await deps.updatePlant(id, rowPatch)) ? { ok: true } : { ok: false, reason: 'network' };
  }

  async function removePlant(id: string): Promise<CloudMutateResult> {
    return (await deps.deletePlant(id)) ? { ok: true } : { ok: false, reason: 'network' };
  }

  /*
   * One-shot import (a later task wires this to the import banner). Every
   * plant is attempted independently - one failure must not stop the rest,
   * and the caller decides what "not fully imported" means for the guest key.
   */
  async function importBatch(userId: string, plants: StoredPlant[]): Promise<ImportBatchResult> {
    const imported: string[] = [];
    const failed: string[] = [];

    for (const plant of plants) {
      const path = `${userId}/${plant.id}.${photoExtension(plant.photoUri)}`;
      const uploaded = plant.photoUri ? await deps.uploadPhoto(path, plant.photoUri) : null;

      const row: CloudRow = {
        id: plant.id,
        user_id: userId,
        saved_at: plant.savedAt,
        photo_path: uploaded,
        diagnosis: plant.diagnosis,
        last_watered_at: plant.lastWateredAt ?? null,
        watering_log: plant.wateringLog ?? [],
        reminder_id: null, // device-local notification handles never travel to another device
      };

      if (await deps.insertPlant(row)) imported.push(plant.id);
      else failed.push(plant.id);
    }

    return { imported, failed };
  }

  return { fetchAll, savePlant, updatePlant, removePlant, importBatch };
}

export type CloudPlantLibrary = ReturnType<typeof createCloudPlantLibrary>;
