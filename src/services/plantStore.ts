import type { PlantDiagnosis } from '../types';

/*
 * The plant library (TODOS item 5).
 *
 * This is the retention spine. Diagnosis acquires a user and the marketplace
 * transacts, but the library is the only reason anyone opens the app a second
 * time — so the bar here is not "usually works", it is "never loses a plant
 * without saying so".
 *
 * Two failure modes drive the whole design, because both are invisible in
 * production and both surface to the user as an empty screen:
 *
 *   1. A write that does not land. Out of space, `setItem` throws on some
 *      platforms and quietly does nothing on others. Every write is therefore
 *      read back and compared before it is reported as saved.
 *   2. A blob that will not parse. The library is quarantined rather than
 *      overwritten, and load() reports `corrupt` rather than returning an empty
 *      list — "you have no plants" is indistinguishable from a deletion the
 *      user never performed.
 *
 * Everything is SYNCHRONOUS on purpose. D8 chose an adaptive Home that shows
 * marketing copy on first run and the library afterwards; an async read means a
 * returning user sees a frame of marketing content before their plants appear.
 * `expo-sqlite/kv-store` provides sync accessors precisely for this.
 */

export const LIBRARY_KEY = 'plantai.library';
export const QUARANTINE_KEY = 'plantai.library.corrupt';

/*
 * Bump ONLY together with a migration step (TODOS item 6). The version lives in
 * the blob rather than the key so a migration can read the old shape in place
 * instead of hunting across keys.
 */
export const LIBRARY_VERSION = 1;

export interface StoredPlant {
  id: string;
  /* ISO-8601. Sort key for the library and, later, the photo timeline (E2). */
  savedAt: string;
  /*
   * Until TODOS item 9 this is the camera's cache URI, which iOS purges on its
   * own schedule. The record survives; the image may not. Item 9 copies the
   * file into the document directory on save.
   */
  photoUri: string;
  diagnosis: PlantDiagnosis;
}

interface Library {
  version: number;
  plants: StoredPlant[];
}

/*
 * The seam that keeps this module testable without a device, mirroring
 * `PipelineDeps` in the scraper. Sync by requirement, not by convenience — see
 * the note on D8 above.
 */
export interface StorageDeps {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreOptions {
  now?: () => number;
  newId?: () => string;
}

/*
 * `corrupt` and `future_version` are separate because the recovery differs: a
 * corrupt blob is damage, while a future one means the user downgraded the app
 * and their data is intact under a newer schema.
 */
export type LoadFailure = 'corrupt' | 'future_version';

export type LoadResult =
  | { ok: true; plants: StoredPlant[] }
  | { ok: false; reason: LoadFailure; plants: StoredPlant[] };

export type SaveResult =
  | { ok: true; plant: StoredPlant; plants: StoredPlant[] }
  | { ok: false; reason: 'storage_full' };

export type RemoveResult = { ok: true; plants: StoredPlant[] } | { ok: false; reason: 'storage_full' };

function isTreatmentish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.title === 'string' && typeof t.description === 'string';
}

/*
 * Validate a single stored record. Deliberately stricter than "it parsed" — a
 * plant missing its diagnosis renders a card with no condition, no issues and
 * no treatments, which looks like a bug in the diagnosis rather than damaged
 * storage.
 */
function isStoredPlant(v: unknown): v is StoredPlant {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.savedAt !== 'string' || typeof p.photoUri !== 'string') {
    return false;
  }
  const d = p.diagnosis as Record<string, unknown> | undefined;
  if (typeof d !== 'object' || d === null) return false;
  return (
    typeof d.plantName === 'string' &&
    typeof d.condition === 'string' &&
    Array.isArray(d.issues) &&
    Array.isArray(d.treatments) &&
    d.treatments.every(isTreatmentish)
  );
}

export function createPlantStore(storage: StorageDeps, opts: StoreOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId =
    opts.newId ??
    (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  /*
   * Move the unreadable value aside instead of deleting it. The FIRST
   * quarantine wins: the earliest corrupt blob is the one closest to the user's
   * real data, so later garbage must not overwrite the better recovery
   * candidate. Failure to quarantine is not fatal — the read already failed and
   * the user is better served by a working app than by a second error.
   */
  function quarantine(raw: string): void {
    try {
      if (storage.getItem(QUARANTINE_KEY) === null) storage.setItem(QUARANTINE_KEY, raw);
      storage.removeItem(LIBRARY_KEY);
    } catch {
      /* best effort */
    }
  }

  function load(): LoadResult {
    const raw = storage.getItem(LIBRARY_KEY);
    if (raw === null) return { ok: true, plants: [] };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      quarantine(raw);
      return { ok: false, reason: 'corrupt', plants: [] };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      quarantine(raw);
      return { ok: false, reason: 'corrupt', plants: [] };
    }

    const lib = parsed as Partial<Library>;
    if (!Array.isArray(lib.plants)) {
      quarantine(raw);
      return { ok: false, reason: 'corrupt', plants: [] };
    }

    /*
     * A blob from a newer app version is intact data in a shape this build does
     * not understand. Parsing it as the current version would silently drop the
     * fields the newer app wrote, and the next save would persist that loss.
     * Migration forward is item 6; refusing to mangle is this build's job.
     */
    if (typeof lib.version === 'number' && lib.version > LIBRARY_VERSION) {
      quarantine(raw);
      return { ok: false, reason: 'future_version', plants: [] };
    }

    /*
     * Drop individually unreadable records rather than condemning the whole
     * library. Losing one entry is recoverable; losing fifty is not.
     */
    return { ok: true, plants: lib.plants.filter(isStoredPlant) };
  }

  /*
   * Persist and CONFIRM. `setItem` succeeding is not evidence the bytes landed:
   * a full disk throws on some platforms and returns quietly on others. The
   * read-back is what turns a silent data loss into an error the user can act
   * on.
   */
  function persist(plants: StoredPlant[]): boolean {
    const payload = JSON.stringify({ version: LIBRARY_VERSION, plants } satisfies Library);
    try {
      storage.setItem(LIBRARY_KEY, payload);
    } catch {
      return false;
    }
    return storage.getItem(LIBRARY_KEY) === payload;
  }

  /*
   * Newest first: the plant a user just saved is the one they are most likely
   * looking for, and D7's triage grouping re-sorts by condition for display
   * anyway.
   */
  function save(input: { photoUri: string; diagnosis: PlantDiagnosis }): SaveResult {
    const current = load().plants;
    const plant: StoredPlant = {
      id: newId(),
      savedAt: new Date(now()).toISOString(),
      photoUri: input.photoUri,
      diagnosis: input.diagnosis,
    };

    const next = [plant, ...current];
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant, plants: next };
  }

  function remove(id: string): RemoveResult {
    const current = load().plants;
    const next = current.filter((p) => p.id !== id);
    // Nothing matched: report success rather than inventing a failure for an
    // operation whose goal ("this id is not in the library") already holds.
    if (next.length === current.length) return { ok: true, plants: current };

    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plants: next };
  }

  return { load, save, remove };
}

export type PlantStore = ReturnType<typeof createPlantStore>;
