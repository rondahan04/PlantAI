import type { PlantDiagnosis } from '../types';
import type { SoilMediumId } from '../lib/soilMedia';

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
export const LIBRARY_VERSION = 2;

/*
 * The species a hand-added plant is, snapshotted from the catalog rather than
 * referenced by id alone. `catalogId` can go stale when an app update rewrites
 * the catalog; this cannot, and it is what every screen actually renders.
 */
export interface PlantSpecies {
  name: string;
  scientificName: string;
  genus: string;
  family: string;
}

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
  /*
   * OPTIONAL since v2. Until the Portfolio tab there was exactly one way a
   * plant entered the library - photograph it, diagnose it, save the result -
   * so a record without a diagnosis could only be damage. Adding a healthy
   * plant by hand breaks that equivalence: the user is telling us what the
   * plant IS, and has not asked us what is wrong with it. Synthesizing an
   * all-clear diagnosis to keep the field required would be worse than absence,
   * because every downstream reader would then treat an invention as a
   * finding. Readers must optional-chain, and `addedVia` says which kind of
   * record they are holding.
   */
  diagnosis?: PlantDiagnosis;
  /*
   * How this plant got into the library. Stored rather than inferred from
   * `diagnosis` being present, because the two will drift: a hand-added plant
   * can later be photographed and gain one, and it is still a plant the user
   * added themselves. Every pre-v2 record is stamped 'scan' by the migration -
   * not a guess, the camera was the only door.
   */
  addedVia: 'scan' | 'manual';
  /*
   * The catalog entry the species was picked from, kept for re-linking (a
   * genus care plan, a nursery search) but never for rendering - see the note
   * on PlantSpecies. Absent on scanned plants, which were never matched to the
   * catalog, and on hand-added plants whose species was typed rather than
   * picked.
   */
  catalogId?: string;
  /*
   * What the plant is, as the user asserted it. Present on hand-added plants
   * and absent on scanned ones, whose identity lives in the diagnosis - the
   * two are alternative sources of the same fact, which is why validation
   * accepts a record carrying either and rejects one carrying neither.
   */
  species?: PlantSpecies;
  /*
   * What the plant is growing in, which changes how often it wants water (see
   * lib/soilMedia.ts). Absent on every plant saved before v2 and deliberately
   * NOT defaulted by the migration: the user has never been asked, and a
   * medium is a fact about someone's pot that no photo and no diagnosis can
   * reveal. Guessing it would silently rescale their watering schedule.
   * Readers fall back to DEFAULT_SOIL_MEDIUM for display, which is a UI choice
   * and not something we write into their data.
   */
  soilMedium?: SoilMediumId;
  /*
   * What the user calls this plant. Absent means they never named it, which is
   * the common case - it must not be backfilled from the species, or renaming
   * would become impossible to tell from never having named it at all.
   */
  nickname?: string;
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
   * Repotting / soil change and feeding, same shape and same rules as the
   * watering pair above: a denormalized "last" field for anything that renders
   * per-card, and a bounded newest-first log for the history calendar. Read
   * both through `careHistory(plant, kind)`.
   *
   * Optional and absent-tolerant on purpose - exactly how `wateringLog` was
   * introduced - so plants saved before this feature keep loading with no
   * LIBRARY_VERSION bump and no migration step.
   */
  lastRepottedAt?: string;
  repotLog?: string[];
  lastFertilizedAt?: string;
  fertilizerLog?: string[];
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
export const MAX_CARE_LOG = 1000;

/* Kept as the original name so existing callers and tests are untouched. */
export const MAX_WATERING_LOG = MAX_CARE_LOG;

/*
 * The three things a user logs against a plant. Each maps to one bounded log
 * plus one denormalized "last" field; the pair is the same design in all three
 * cases, so the behaviour lives in one place rather than being copied per kind.
 */
export type CareKind = 'water' | 'repot' | 'fertilizer';

interface CareFields {
  logKey: 'wateringLog' | 'repotLog' | 'fertilizerLog';
  lastKey: 'lastWateredAt' | 'lastRepottedAt' | 'lastFertilizedAt';
}

const CARE_FIELDS: Record<CareKind, CareFields> = {
  water: { logKey: 'wateringLog', lastKey: 'lastWateredAt' },
  repot: { logKey: 'repotLog', lastKey: 'lastRepottedAt' },
  fertilizer: { logKey: 'fertilizerLog', lastKey: 'lastFertilizedAt' },
};

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
export function careHistory(plant: StoredPlant, kind: CareKind = 'water'): string[] {
  const { logKey, lastKey } = CARE_FIELDS[kind];
  const stored = plant[logKey];
  const raw = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of [...raw, plant[lastKey]].filter((e): e is string => typeof e === 'string')) {
    const t = Date.parse(entry);
    if (Number.isNaN(t) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }

  return out.sort((a, b) => Date.parse(b) - Date.parse(a));
}

/* The watering-specific name this started as. Every existing caller uses it. */
export function wateringHistory(plant: StoredPlant): string[] {
  return careHistory(plant, 'water');
}

function isTreatmentish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.title === 'string' && typeof t.description === 'string';
}

/* A diagnosis complete enough to render: a name, a condition, and the two
 * lists the detail screen maps over. Anything less is damage, not a shape. */
function isDiagnosisish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.plantName === 'string' &&
    typeof d.condition === 'string' &&
    Array.isArray(d.issues) &&
    Array.isArray(d.treatments) &&
    d.treatments.every(isTreatmentish)
  );
}

/* All four fields are required together because they are written together, in
 * one snapshot off the catalog. A half-copied species is a bug in the writer,
 * and letting it load would spread it. */
function isSpeciesish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const sp = v as Record<string, unknown>;
  return (
    typeof sp.name === 'string' &&
    typeof sp.scientificName === 'string' &&
    typeof sp.genus === 'string' &&
    typeof sp.family === 'string'
  );
}

/*
 * Validate a single stored record. Deliberately stricter than "it parsed".
 *
 * The bar is IDENTITY: a record must carry either a diagnosis or a species,
 * because those are the only two places a plant's name comes from. One with
 * neither renders as a nameless card with no condition and nothing to act on,
 * which a user reads as a bug in the app rather than as storage that was
 * damaged - and a bug they cannot report, because there is nothing on the card
 * to describe. Dropping it puts the loss where load() can account for it.
 *
 * Requiring BOTH is what v1 did, and would now delete every hand-added plant
 * on load; requiring neither would let the nameless card through.
 *
 * Nothing here DELETES: load() filters on the way out and the bytes stay on
 * disk. See the write-back in load() for why that distinction is load-bearing.
 */
function isStoredPlant(v: unknown): v is StoredPlant {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.savedAt !== 'string' || typeof p.photoUri !== 'string') {
    return false;
  }
  if (p.addedVia !== 'scan' && p.addedVia !== 'manual') return false;
  /*
   * The two identity fields are treated ASYMMETRICALLY, and the difference is
   * about what each one crashes rather than about how much we trust it.
   *
   * A half-formed diagnosis is fatal to the record, because readers walk into
   * it unguarded: PlantDetailScreen does `diagnosis.issues.map(...)` and
   * `diagnosis.treatments.map(...)` behind nothing more than a truthiness
   * check, so a diagnosis with `issues: 'not an array'` is a red screen on
   * open. Dropping the record trades a crash for a loss we can account for.
   *
   * A half-formed species is not, because every reader reaches it as
   * `plant.species?.name` - undefined on any shape, rendered as a fallback
   * name, never thrown. So it is treated as ABSENT: the record still loads on
   * whatever identity it has left, and only a plant with no usable identity at
   * ALL is dropped. Rejecting it outright would delete a scanned plant with a
   * perfectly good diagnosis over a field its screens never dereference.
   */
  if (p.diagnosis !== undefined && !isDiagnosisish(p.diagnosis)) return false;
  const speciesOk = p.species !== undefined && isSpeciesish(p.species);
  return p.diagnosis !== undefined || speciesOk;
}


/*
 * A migration step takes a library at version N and returns it at N+1. Steps
 * are keyed by the version they upgrade FROM, so `{ 1: fn }` moves v1 → v2.
 */
export type Migration = (library: any) => any;
export type Migrations = Record<number, Migration>;

/*
 * The real migration table. The chain was built empty, before it was needed,
 * precisely so this moment would be cheap: the first blob written without a
 * migration path is a permanent problem, and by the time v2 arrived there was
 * live user data that cannot be re-created.
 *
 * Each entry is keyed by the version it upgrades FROM, and lands in the same
 * commit as the `LIBRARY_VERSION` bump that makes it run - a bump without a
 * step makes load() throw, and a step without a bump never runs.
 *
 * A step must be TOTAL over whatever it is handed. It runs before validation,
 * on records this build has never seen, so it may not assume any field it did
 * not itself write; broken records are the filter's job afterwards, and a step
 * that throws costs the user their whole library to quarantine.
 */
export const MIGRATIONS: Migrations = {
  /*
   * v1 → v2: stamp `addedVia`.
   *
   * Every v1 plant came through the camera, because photographing it was the
   * only way to create one - this is a fact about the old app, not an
   * inference about the record. Nothing else is filled in: `soilMedium`,
   * `species` and `nickname` are all things only the user can tell us, and
   * inventing them here would be indistinguishable, forever after, from the
   * user having said so.
   */
  1: (library: any) => ({
    ...library,
    plants: Array.isArray(library?.plants)
      ? library.plants.map((p: any) =>
          // Non-objects are left exactly as they are rather than being spread
          // into one - `{...null}` would quietly manufacture a plant-shaped
          // record out of junk, which the validator then has to catch.
          typeof p === 'object' && p !== null ? { ...p, addedVia: 'scan' } : p
        )
      : library?.plants,
  }),
};

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

    /*
     * UNFILTERED, and it has to stay that way - do not "tidy" a
     * `.filter(isStoredPlant)` back in here.
     *
     * This write is the only place the app REWRITES a library it did not just
     * change, so it is the only place a bad record can be erased instead of
     * merely hidden. Filtering here would delete every record this build
     * cannot read, on launch, silently, with load() still returning ok: true
     * and no quarantine copy kept - failure mode 2 in the header, caused by
     * the code meant to prevent it. A record we cannot read today may be one a
     * later build, or a support conversation, can recover.
     *
     * The read path below filters on the way OUT, which hides the record
     * without touching the bytes. That is the non-destructive half, and it is
     * what the migration's own "broken records are the filter's job" means.
     */
    if (migrated !== lib && Array.isArray(migrated.plants)) {
      persist(migrated.plants);
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
      addedVia: 'scan',
      diagnosis: input.diagnosis,
    };

    const next = [plant, ...current];
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant, plants: next };
  }

  /*
   * Save a plant the user added BY HAND, with no diagnosis behind it.
   *
   * A sibling of `save` rather than an optional-diagnosis branch inside it: the
   * two have different required fields, and a single entry point taking both as
   * optional would accept `{ photoUri }` alone and write the nameless record
   * that `isStoredPlant` exists to reject. Two functions make the store's rule
   * - every plant carries an identity - a thing the type checker enforces at
   * the call site instead of something the loader discovers later.
   *
   * Optional fields are OMITTED rather than written as `undefined`, so the blob
   * holds no keys with null meanings and `'soilMedium' in plant` keeps working
   * as "the user chose one".
   */
  function saveManual(input: {
    photoUri: string;
    species: PlantSpecies;
    catalogId?: string;
    soilMedium?: SoilMediumId;
    nickname?: string;
  }): SaveResult {
    const current = load().plants;
    const plant: StoredPlant = {
      id: newId(),
      savedAt: new Date(now()).toISOString(),
      photoUri: input.photoUri,
      addedVia: 'manual',
      species: input.species,
      ...(input.catalogId !== undefined ? { catalogId: input.catalogId } : {}),
      ...(input.soilMedium !== undefined ? { soilMedium: input.soilMedium } : {}),
      ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
    };

    const next = [plant, ...current];
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant, plants: next };
  }

  /*
   * Patch one plant in place.
   *
   * Narrow by design: the fields the watering schedule owns, `photoUri` once
   * item 9's copy into the document directory finishes, and the four the user
   * edits directly on a hand-added plant. A general `update(id, patch)` would
   * let a caller overwrite a diagnosis - the one thing in a stored plant that
   * came from a paid call and cannot be re-derived. That still holds with
   * diagnosis optional: `soilMedium`, `nickname`, `catalogId` and `species` are
   * all things the user typed and can retype, so losing one to a bad patch
   * costs a correction rather than a call.
   */
  function update(
    id: string,
    patch: Partial<
      Pick<
        StoredPlant,
        | 'lastWateredAt'
        | 'lastRepottedAt'
        | 'lastFertilizedAt'
        | 'reminderId'
        | 'photoUri'
        | 'soilMedium'
        | 'nickname'
        | 'catalogId'
        | 'species'
      >
    >
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
    for (const key of [
      'lastWateredAt',
      'lastRepottedAt',
      'lastFertilizedAt',
      'reminderId',
      'soilMedium',
      'nickname',
      'catalogId',
      'species',
    ] as const) {
      if (key in patch && patch[key] === undefined) delete updated[key];
    }
    /*
     * ...but not to the point of erasing the plant. A hand-added plant's
     * species is its only identity, so clearing it writes a record that fails
     * `isStoredPlant` and vanishes on the next load - the same trap `photoUri`
     * has below, and the same answer. A plant with a diagnosis still carries a
     * name without it, so there the clear goes through.
     */
    if (updated.species === undefined && updated.diagnosis === undefined) {
      updated.species = target.species;
    }
    /*
     * Same trap one step earlier: a patch carrying a half-formed species object
     * writes a record that may fail validation and vanish on the next load.
     * TypeScript stops an honest caller, but the guard above is worthless if a
     * malformed value walks past it, so the last good species wins.
     */
    if (patch.species !== undefined && !isSpeciesish(patch.species)) {
      updated.species = target.species;
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
  function markCare(id: string, kind: CareKind, at: number = now()): UpdateResult {
    const { logKey, lastKey } = CARE_FIELDS[kind];
    const current = load().plants;
    const target = current.find((p) => p.id === id);
    if (!target) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const history = careHistory(target, kind);
    /*
     * A double tap must not become two entries on the same day. The calendar
     * would show one dot either way, so a duplicate is invisible there and only
     * shows up as a wrong count - the quietest kind of wrong.
     */
    const log = history[0] && sameDay(history[0], stamp) ? history.slice(1) : history;

    const updated: StoredPlant = {
      ...target,
      [lastKey]: stamp,
      // Newest first, and bounded: the whole library is one JSON blob that is
      // re-read on every render, so an unbounded log is a slow leak into the
      // cost of opening the app. Rewriting from the NORMALIZED history also
      // self-heals a log that was stored unsorted or with junk in it.
      [logKey]: [stamp, ...log].slice(0, MAX_CARE_LOG),
    };
    /*
     * Water only. The handle points at a notification scheduled for a due date
     * this watering has just moved, so keeping it would fire a reminder for a
     * plant already watered. Repotting and feeding schedule nothing, and must
     * not cancel the watering reminder as a side effect.
     */
    if (kind === 'water') delete updated.reminderId;

    const next = current.map((p) => (p.id === id ? updated : p));
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant: updated, plants: next };
  }

  /*
   * Log a watering. Clears the reminder handle along with it; scheduling the
   * replacement is the caller's job - it needs the OS. Kept as its own name
   * because every existing caller and its test suite use it.
   */
  function markWatered(id: string, at: number = now()): UpdateResult {
    return markCare(id, 'water', at);
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

  return { load, save, saveManual, update, markWatered, markCare, remove, replace };
}

export type PlantStore = ReturnType<typeof createPlantStore>;
