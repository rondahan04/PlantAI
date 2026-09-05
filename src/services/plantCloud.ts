import type { PlantDiagnosis } from '../types';
import type { SoilMediumId } from '../lib/soilMedia';
import type { PlantSpecies, StoredPlant } from './plantStore';

/*
 * Cloud sync for the plant library (Epic 3a).
 *
 * This module owns the network orchestration - upload-then-insert, fetch,
 * update, delete, and one-shot import - behind the `CloudDeps` seam, the same
 * pattern `plantStore.ts` and `photoStore.ts` use to stay testable without a
 * live network or a real Supabase client. The real binding lives in
 * `supabasePlantCloud.ts`; everything here treats rows and paths as opaque
 * data it round-trips, not something it interprets.
 *
 * "Not found" is deliberately not a case this module reports: a plant that
 * doesn't exist is detected one layer up, by `plantRepo` checking its local
 * mirror before ever calling into `cloud`. By the time `updatePlant()` /
 * `removePlant()` are called here, the id is assumed findable, so the only
 * failure this layer can observe is the network call itself not landing.
 */

/*
 * Lowercased extension without the dot, or `jpg` when the source has none we
 * can trust. Duplicated from `photoStore.ts`'s identical helper rather than
 * imported from it - a cross-module runtime import from a `node --test`-run
 * file needs an explicit `.ts` extension in the specifier, and Metro (this
 * app's actual bundler, not tsc) does not correctly resolve an explicit `.ts`
 * extension in production source. Keeping this module self-contained avoids
 * the problem entirely rather than working around it.
 */
const MAX_EXT_LEN = 5;

function photoExtension(sourceUri: string): string {
  const path = sourceUri.split('?')[0].split('#')[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'jpg';

  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > MAX_EXT_LEN || !/^[a-z0-9]+$/.test(ext)) return 'jpg';
  return ext;
}

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
  /*
   * NULLABLE since the Portfolio tab: a plant added by hand has never been
   * diagnosed. Mirrors `StoredPlant.diagnosis`, and for the same reason - a
   * synthesized all-clear finding would be indistinguishable from a real one.
   */
  diagnosis: PlantDiagnosis | null;
  added_via: 'scan' | 'manual';
  catalog_id: string | null;
  species: PlantSpecies | null;
  soil_medium: SoilMediumId | null;
  nickname: string | null;
  last_watered_at: string | null;
  watering_log: string[] | null;
  last_repotted_at: string | null;
  repot_log: string[] | null;
  last_fertilized_at: string | null;
  fertilizer_log: string[] | null;
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

export type CloudMutateResult = { ok: true } | { ok: false; reason: 'network' };

/* What `saveManualPlant` needs to build a row: identity plus whatever the add
 * form collected. Everything else on a fresh plant is absent by definition. */
export interface ManualInput {
  photoUri: string;
  species: PlantSpecies;
  catalogId?: string;
  soilMedium?: SoilMediumId;
  nickname?: string;
}

/*
 * Every field a logged-in mutation can change after the insert. Deliberately
 * NOT `Partial<StoredPlant>`: identity (species, catalogId, addedVia, savedAt)
 * is written once and never patched, and letting it through here would make a
 * cloud row silently disagree with the record that created it.
 */
export type CloudPatch = Partial<{
  lastWateredAt: string | null;
  reminderId: string | null;
  wateringLog: string[];
  lastRepottedAt: string | null;
  repotLog: string[];
  lastFertilizedAt: string | null;
  fertilizerLog: string[];
  soilMedium: SoilMediumId | null;
  nickname: string | null;
  /* Storage OBJECT PATH, never a URL - see CloudRow.photo_path. */
  photoPath: string | null;
}>;

export interface ImportBatchResult {
  imported: string[];
  failed: string[];
}

/*
 * Every optional field is OMITTED rather than set to undefined when the column
 * is null. `plantStore.isStoredPlant` accepts either, but the mirror is
 * compared against locally-written records all over the app, and a record
 * carrying `nickname: undefined` is not the same object as one that never had
 * the key - which is exactly the distinction "they never named it" rests on.
 */
function toStoredPlant(row: CloudRow): StoredPlant {
  const plant: StoredPlant = {
    id: row.id,
    savedAt: row.saved_at,
    photoUri: row.photo_path ?? '',
    /* Pre-Portfolio rows have no `added_via` column value only if this ran
     * against an unmigrated table; 'scan' is what the migration backfills. */
    addedVia: row.added_via ?? 'scan',
  };
  if (row.diagnosis) plant.diagnosis = row.diagnosis;
  if (row.catalog_id) plant.catalogId = row.catalog_id;
  if (row.species) plant.species = row.species;
  if (row.soil_medium) plant.soilMedium = row.soil_medium;
  if (row.nickname) plant.nickname = row.nickname;
  if (row.last_watered_at) plant.lastWateredAt = row.last_watered_at;
  if (row.watering_log && row.watering_log.length > 0) plant.wateringLog = row.watering_log;
  if (row.last_repotted_at) plant.lastRepottedAt = row.last_repotted_at;
  if (row.repot_log && row.repot_log.length > 0) plant.repotLog = row.repot_log;
  if (row.last_fertilized_at) plant.lastFertilizedAt = row.last_fertilized_at;
  if (row.fertilizer_log && row.fertilizer_log.length > 0) {
    plant.fertilizerLog = row.fertilizer_log;
  }
  if (row.reminder_id) plant.reminderId = row.reminder_id;
  return plant;
}

/*
 * The inverse. Written once and shared by save, saveManual and importBatch so
 * a field added to `StoredPlant` cannot be carried by one write path and
 * dropped by another - which is how a hand-added plant would arrive on a second
 * device with its nickname missing.
 *
 * `reminder_id` is never written from here: a local notification handle is
 * meaningless on any other device, so it is patched in separately by the
 * device that scheduled it.
 */
function toRow(userId: string, plant: StoredPlant, photoPath: string | null): CloudRow {
  return {
    id: plant.id,
    user_id: userId,
    saved_at: plant.savedAt,
    photo_path: photoPath,
    diagnosis: plant.diagnosis ?? null,
    added_via: plant.addedVia,
    catalog_id: plant.catalogId ?? null,
    species: plant.species ?? null,
    soil_medium: plant.soilMedium ?? null,
    nickname: plant.nickname ?? null,
    last_watered_at: plant.lastWateredAt ?? null,
    watering_log: plant.wateringLog ?? [],
    last_repotted_at: plant.lastRepottedAt ?? null,
    repot_log: plant.repotLog ?? [],
    last_fertilized_at: plant.lastFertilizedAt ?? null,
    fertilizer_log: plant.fertilizerLog ?? [],
    reminder_id: null,
  };
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
    return insertNew(userId, { ...input, addedVia: 'scan' });
  }

  /*
   * The Portfolio tab's second door: a plant the user already owns, typed in
   * rather than photographed. Same insert as `savePlant` - the only difference
   * is which fields carry the identity, and `toRow` is what keeps the two from
   * drifting apart.
   *
   * The photo is OPTIONAL here in a way it never was for a scan: a plant added
   * from the shelf may genuinely have no picture, and an empty `photoUri` must
   * skip the upload rather than push a zero-byte object.
   */
  async function saveManualPlant(
    userId: string,
    input: ManualInput
  ): Promise<CloudSaveResult> {
    return insertNew(userId, { ...input, addedVia: 'manual' });
  }

  async function insertNew(
    userId: string,
    input: (ManualInput | { photoUri: string; diagnosis: PlantDiagnosis }) & {
      addedVia: 'scan' | 'manual';
    }
  ): Promise<CloudSaveResult> {
    const id = newId();
    const uploaded = input.photoUri
      ? await deps.uploadPhoto(`${userId}/${id}.${photoExtension(input.photoUri)}`, input.photoUri)
      : null;

    const draft = { ...input, id, savedAt: new Date(now()).toISOString() } as StoredPlant;
    const row = toRow(userId, draft, uploaded);

    if (!(await deps.insertPlant(row))) return { ok: false, reason: 'network' };
    return { ok: true, plant: toStoredPlant(row) };
  }

  async function updatePlant(id: string, patch: CloudPatch): Promise<CloudMutateResult> {
    const rowPatch: Partial<CloudRow> = {};
    if ('lastWateredAt' in patch) rowPatch.last_watered_at = patch.lastWateredAt ?? null;
    if ('reminderId' in patch) rowPatch.reminder_id = patch.reminderId ?? null;
    if ('wateringLog' in patch) rowPatch.watering_log = patch.wateringLog ?? [];
    if ('lastRepottedAt' in patch) rowPatch.last_repotted_at = patch.lastRepottedAt ?? null;
    if ('repotLog' in patch) rowPatch.repot_log = patch.repotLog ?? [];
    if ('lastFertilizedAt' in patch) rowPatch.last_fertilized_at = patch.lastFertilizedAt ?? null;
    if ('fertilizerLog' in patch) rowPatch.fertilizer_log = patch.fertilizerLog ?? [];
    if ('soilMedium' in patch) rowPatch.soil_medium = patch.soilMedium ?? null;
    if ('nickname' in patch) rowPatch.nickname = patch.nickname ?? null;
    if ('photoPath' in patch) rowPatch.photo_path = patch.photoPath ?? null;

    return (await deps.updatePlant(id, rowPatch)) ? { ok: true } : { ok: false, reason: 'network' };
  }

  /*
   * Swap the picture on a plant that already exists.
   *
   * Upload first, patch second - the same order as insertNew, and for the same
   * reason: a row pointed at an object that failed to upload renders a broken
   * image forever, while an uploaded object no row points at is a few
   * kilobytes nobody sees. The object key deliberately reuses the plant id, so
   * replacing a photo overwrites the old one rather than accumulating a new
   * object per edit.
   *
   * Returns the stored path so the caller can decide how to resolve it; the
   * bucket is private, so the path is not directly renderable.
   */
  async function replacePhoto(
    userId: string,
    id: string,
    sourceUri: string
  ): Promise<{ ok: true; path: string } | { ok: false; reason: 'network' }> {
    const uploaded = await deps.uploadPhoto(`${userId}/${id}.${photoExtension(sourceUri)}`, sourceUri);
    if (!uploaded) return { ok: false, reason: 'network' };

    const patched = await updatePlant(id, { photoPath: uploaded });
    return patched.ok ? { ok: true, path: uploaded } : { ok: false, reason: 'network' };
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

      // `toRow` writes reminder_id as null - a device-local notification handle
      // never travels to another device.
      const row = toRow(userId, plant, uploaded);

      if (await deps.insertPlant(row)) imported.push(plant.id);
      else failed.push(plant.id);
    }

    return { imported, failed };
  }

  return { fetchAll, savePlant, saveManualPlant, updatePlant, replacePhoto, removePlant, importBatch };
}

export type CloudPlantLibrary = ReturnType<typeof createCloudPlantLibrary>;
