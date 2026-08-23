import type { PlantDiagnosis } from '../types';

/*
 * The plant library (TODOS item 5).
 *
 * This is the retention spine. Diagnosis acquires a user and the marketplace
 * transacts, but the library is the only reason anyone opens the app a second
 * time - so the bar here is not "usually works", it is "never loses a plant
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
 *      list - "you have no plants" is indistinguishable from a deletion the
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
   * Normally a file in the app's document directory, copied there on save by
   * `photoStore` (item 9). It can still be a camera cache URI - a plant saved
   * before that shipped, or one whose copy was interrupted - and iOS purges
   * that directory on its own schedule, so a reader must tolerate a dead URI.
   * Home repairs what it can on launch.
   */
  photoUri: string;
  diagnosis: PlantDiagnosis;
  /*
   * ISO-8601, set when the user logs a watering. Absent means the schedule has
   * not been started - deliberately NOT defaulted to `savedAt`, because "you
   * watered this plant the day you photographed it" is a fact the app would be
   * inventing, and the whole reminder would then be built on it.
   */
  lastWateredAt?: string;
  /*
   * Every watering, newest first, ISO-8601. `lastWateredAt` is kept alongside
   * it rather than derived: the schedule reads that field on every render and
   * every card in the library, and it must not depend on the log being sorted,
   * present, or intact. The log is history for the calendar; the field is the
   * one fact the reminder is built on.
   *
   * Absent on plants watered before the log existed - read it through
   * `wateringHistory()`, which folds `lastWateredAt` back in.
   */
  wateringLog?: string[];
  /*
   * Identifier of the scheduled local notification, so the next watering can
   * cancel the one it replaces. Absent when nothing is scheduled: no OS
   * permission, no interval in the care plan, or the reminder already fired.
   * Stored rather than recomputed because the OS owns the notification and this
   * is the only handle back to it.
   */
  reminderId?: string;
}

interface Library {
  version: number;
  plants: StoredPlant[];
}

/*
 * The seam that keeps this module testable without a device, mirroring
 * `PipelineDeps` in the scraper. Sync by requirement, not by convenience - see
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
  /* Overridable so the chain can be exercised while the real table is empty. */
  migrations?: Migrations;
  targetVersion?: number;
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

export type UpdateResult =
  | { ok: true; plant: StoredPlant; plants: StoredPlant[] }
  | { ok: false; reason: 'storage_full' | 'not_found' };

/*
 * Roughly three years of daily watering. Far past any real use, and low enough
 * that a pathological log cannot bloat the blob the app parses on every launch.
 */
export const MAX_WATERING_LOG = 1000;

function sameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/*
 * Every watering this plant has, newest first.
 *
 * Folds `lastWateredAt` back in because plants watered before the log existed
 * hold that field alone - without this they would open a calendar with nothing
 * on it, which reads as data loss rather than as a feature that arrived late.
 * Junk entries are dropped instead of reaching the calendar as `Invalid Date`.
 */
export function wateringHistory(plant: StoredPlant): string[] {
  const raw = Array.isArray(plant.wateringLog) ? plant.wateringLog : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of [...raw, plant.lastWateredAt].filter((e): e is string => typeof e === 'string')) {
    const t = Date.parse(entry);
    if (Number.isNaN(t) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }

  return out.sort((a, b) => Date.parse(b) - Date.parse(a));
}

function isTreatmentish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.title === 'string' && typeof t.description === 'string';
}

/*
 * Validate a single stored record. Deliberately stricter than "it parsed" - a
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


/*
 * A migration step takes a library at version N and returns it at N+1. Steps
 * are keyed by the version they upgrade FROM, so `{ 1: fn }` moves v1 → v2.
 */
export type Migration = (library: any) => any;
export type Migrations = Record<number, Migration>;

/*
 * The real migration table. Empty today because v1 is current - the chain
 * exists before it is needed on purpose: the first blob written without a
 * migration path is a permanent problem, and by the time v2 is required there
 * is live user data that cannot be re-created.
 *
 * Adding v2 is two edits in one commit: `MIGRATIONS[1] = fn` (keyed by the
 * version it upgrades FROM) and `LIBRARY_VERSION = 2`. They must move together
 * - a bump without a step makes load() throw, and a step without a bump never
 * runs.
 */
export const MIGRATIONS: Migrations = {};

/*
 * Walk a library forward one version at a time until it reaches `target`.
 *
 * Deliberately steps rather than jumping: a v1 blob on a v4 app must pass
 * through every intermediate shape, because each step is only written to
 * understand the one immediately before it. A missing step throws instead of
 * skipping - handing later code a shape no migration ever produced is worse
 * than refusing to load, and the caller quarantines on throw.
 */
export function runMigrations(library: any, steps: Migrations, target: number): any {
  // A blob with no version predates versioning, which can only mean v1.
  let current = typeof library?.version === 'number' ? library.version : 1;
  if (current >= target) return library;

  let out = library;
  while (current < target) {
    const step = steps[current];
    if (!step) throw new Error(`no migration from library version ${current}`);
    out = { ...step(out), version: current + 1 };
    current++;
  }
  return out;
}

export function createPlantStore(storage: StorageDeps, opts: StoreOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId =
    opts.newId ??
    (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const migrations = opts.migrations ?? MIGRATIONS;
  const targetVersion = opts.targetVersion ?? LIBRARY_VERSION;

  /*
   * Move the unreadable value aside instead of deleting it. The FIRST
   * quarantine wins: the earliest corrupt blob is the one closest to the user's
   * real data, so later garbage must not overwrite the better recovery
   * candidate. Failure to quarantine is not fatal - the read already failed and
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
    if (typeof lib.version === 'number' && lib.version > targetVersion) {
      quarantine(raw);
      return { ok: false, reason: 'future_version', plants: [] };
    }

    /*
     * Bring an older blob up to the current shape, then WRITE IT BACK. Without
     * the write-back every launch re-migrates: wasted work, and a broken step
     * stays hidden behind an in-memory result that looks correct.
     *
     * A step that throws means the data is in an unknown state, so the
     * pre-migration bytes are quarantined rather than half-migrated data being
     * persisted over them.
     */
    let migrated: Partial<Library>;
    try {
      migrated = runMigrations(lib, migrations, targetVersion);
    } catch {
      quarantine(raw);
      return { ok: false, reason: 'corrupt', plants: [] };
    }

    if (migrated !== lib && Array.isArray(migrated.plants)) {
      persist(migrated.plants.filter(isStoredPlant));
    }
    if (!Array.isArray(migrated.plants)) {
      quarantine(raw);
      return { ok: false, reason: 'corrupt', plants: [] };
    }
    lib.plants = migrated.plants;

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
    const payload = JSON.stringify({ version: targetVersion, plants } satisfies Library);
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

  /*
   * Patch one plant in place.
   *
   * Narrow by design: the two fields the watering schedule owns, plus
   * `photoUri` once item 9's copy into the document directory finishes. A
   * general `update(id, patch)` would let a caller overwrite a diagnosis - the
   * one thing in a stored plant that came from a paid call and cannot be
   * re-derived.
   */
  function update(
    id: string,
    patch: Partial<Pick<StoredPlant, 'lastWateredAt' | 'reminderId' | 'photoUri'>>
  ): UpdateResult {
    const current = load().plants;
    const target = current.find((p) => p.id === id);
    // Gone: the plant was removed on another screen while this one held it.
    // Not an error the user can act on, and inventing the record back would be
    // worse than reporting that it is missing.
    if (!target) return { ok: false, reason: 'not_found' };

    /*
     * `undefined` in the patch CLEARS the field rather than being skipped -
     * clearing `reminderId` after cancelling a notification is the common case,
     * and a patch that silently ignored it would leave a dangling handle.
     */
    const updated: StoredPlant = { ...target, ...patch };
    for (const key of ['lastWateredAt', 'reminderId'] as const) {
      if (key in patch && patch[key] === undefined) delete updated[key];
    }
    /*
     * `photoUri` is required, so unlike the optional fields above it cannot be
     * cleared - spreading an explicit `undefined` over it would write a record
     * that fails `isStoredPlant` and vanishes from the library on the next
     * load. A patch that omits a photo keeps the one already there.
     */
    if (patch.photoUri === undefined) updated.photoUri = target.photoUri;

    const next = current.map((p) => (p.id === id ? updated : p));
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant: updated, plants: next };
  }

  /*
   * Log a watering. Clears the reminder handle along with it: the notification
   * that handle points at was scheduled for a due date this watering has just
   * moved, so keeping it would fire a reminder for a plant already watered.
   * Scheduling the replacement is the caller's job - it needs the OS.
   */
  function markWatered(id: string, at: number = now()): UpdateResult {
    const current = load().plants;
    const target = current.find((p) => p.id === id);
    if (!target) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const history = wateringHistory(target);
    /*
     * A double tap must not become two waterings on the same day. The calendar
     * would show one dot either way, so a duplicate is invisible there and only
     * shows up as a wrong count - the quietest kind of wrong.
     */
    const log = history[0] && sameDay(history[0], stamp) ? history.slice(1) : history;

    const updated: StoredPlant = {
      ...target,
      lastWateredAt: stamp,
      // Newest first, and bounded: the whole library is one JSON blob that is
      // re-read on every render, so an unbounded log is a slow leak into the
      // cost of opening the app.
      wateringLog: [stamp, ...log].slice(0, MAX_WATERING_LOG),
    };
    delete updated.reminderId;

    const next = current.map((p) => (p.id === id ? updated : p));
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant: updated, plants: next };
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

  /*
   * Overwrite the whole library with `plants` as given - no id/timestamp
   * generation, no merge with what is already stored. For a store standing in
   * as a read cache of an external source of truth (the Supabase mirror),
   * where the caller already has the authoritative list and generating new
   * identity for it here would desync it from the source it mirrors.
   */
  function replace(plants: StoredPlant[]): boolean {
    return persist(plants.filter(isStoredPlant));
  }

  return { load, save, update, markWatered, remove, replace };
}

export type PlantStore = ReturnType<typeof createPlantStore>;
