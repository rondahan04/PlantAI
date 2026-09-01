import { SOIL_MEDIUM_IDS, type SoilMediumId } from './soilMedia.ts';
import type { Language } from './language.ts';

/*
 * Care advice for a whole GENUS, in every growing medium at once.
 *
 * Two decisions are baked into that sentence, and both are about cost.
 *
 * PER GENUS, not per plant. Care advice for Alocasia zebrina and Alocasia
 * frydek differs by less than the noise between two growers, and a user with
 * nine Alocasias would otherwise pay for nine identical calls. The genus is
 * also the one identity all three of our sources agree on - the catalog,
 * PlantNet and the vision model routinely disagree on the species and rarely
 * on the genus - so it is the only key a cache can be built on without
 * fragmenting into near-duplicates.
 *
 * EVERY MEDIUM IN ONE ANSWER, not the medium the plant is in today. The same
 * plant in peat and in LECA wants a different interval, and the user changes
 * medium by tapping a picker. Asking per medium would mean a network call at
 * the moment of a tap, which is exactly when the app must feel instant and
 * exactly when it is likeliest to be offline (a repot happens at the sink, not
 * at the desk). Fetching all eight up front costs one call, once, and makes
 * switching medium a local lookup that reschedules watering on the same frame.
 *
 * Pure on purpose, like the rest of src/lib: no expo-*, no react-native, and
 * the storage and the network both arrive as injected dependencies, so all of
 * this runs under `node --test` with no device. The storage seam is the same
 * shape as `StorageDeps` in services/plantStore.ts, deliberately - the app
 * hands both of them the one sync kv-store, and two subtly different seams
 * over the same object is how they drift.
 */

/*
 * A type alias rather than an interface, which matters only to the type
 * checker: TypeScript gives an alias an implicit index signature and an
 * interface none, so `plan as Record<string, unknown>` - how the tests reach in
 * to corrupt one field and prove the validator catches it - compiles for the
 * first and not the second. Nothing about the shape or its consumers differs.
 */
export type SoilCarePlan = {
  /* Prose the user reads. */
  water: string;
  /* Whole days. This is the number the schedule is actually built on; the
   * prose above is the explanation, not the source of truth. */
  waterEveryDays: number;
  /* Upper end of a range, absent when the model gave a single figure. The
   * watering state machine renders "due" as a window rather than an instant,
   * so a range is more honest than a point when we have one. */
  waterEveryDaysMax?: number;
  fertilizer: string;
  fertilizeEveryDays: number;
  light: string;
  humidity: string;
  /* Traps specific to THIS medium - root rot in a reservoir, salt build-up in
   * pon - which is why they hang off the per-medium plan rather than the
   * genus. Optional: most combinations have nothing worth warning about, and
   * an empty warning block on screen reads as a missing feature. */
  warnings?: string[];
};

export interface GenusCarePlan {
  genus: string;
  family: string;
  /* ISO-8601. Not read by anything yet - there is no expiry, because care
   * advice for a genus does not change on a timescale the app cares about -
   * but it is the only way to tell a plan written last week from one written
   * by a build two releases ago when a bad answer has to be traced. */
  fetchedAt: string;
  bySoil: Record<SoilMediumId, SoilCarePlan>;
}

/*
 * One key per genus, namespaced like every other key this app writes so a
 * future "clear cached advice" can find them without touching the library.
 */
/*
 * v2: the key gained a language. A v1 entry holds English prose under a key a
 * Hebrew reader would now hit, so the prefix bump retires those entries rather
 * than serving one language's advice to a reader of the other. They cost one
 * refetch each and are never read again.
 */
export const CACHE_KEY_PREFIX = 'plantai.careplan.v2.';

/*
 * Genus names reach us from three sources that do not agree on capitalization:
 * the catalog ships them title-cased, PlantNet echoes whatever the submitter
 * typed, and the vision model varies by prompt. Keyed raw, the cache would
 * hold 'Alocasia' and 'alocasia' as two genera - two calls, two entries, and a
 * user whose care advice changes depending on which screen identified the
 * plant. Trimmed and lowercased, they are one.
 */
export function cacheKeyFor(genus: string, lang: Language): string {
  return `${CACHE_KEY_PREFIX}${lang}.${genus.trim().toLowerCase()}`;
}

function isSoilCarePlan(value: unknown): value is SoilCarePlan {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;

  for (const key of ['water', 'fertilizer', 'light', 'humidity'] as const) {
    if (typeof p[key] !== 'string') return false;
  }

  /*
   * The intervals are checked hard because they are arithmetic, not prose. A
   * model that answers "about a week" makes `daysUntilDue` NaN, which renders
   * as a card that is never due and a reminder that is never scheduled - a
   * plant silently dropping out of the watering rota is the exact failure this
   * app exists to prevent. Zero or negative is the same class of damage from
   * the other direction: due forever, on every render.
   */
  for (const key of ['waterEveryDays', 'fertilizeEveryDays'] as const) {
    const n = p[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return false;
  }
  if (p.waterEveryDaysMax !== undefined) {
    const max = p.waterEveryDaysMax;
    if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) return false;
  }

  /* Absent is fine; present and not a list of strings is a shape the warnings
   * block would map over and crash on. */
  if (p.warnings !== undefined) {
    if (!Array.isArray(p.warnings) || !p.warnings.every((w) => typeof w === 'string')) return false;
  }

  return true;
}

/*
 * ALL OR NOTHING across SOIL_MEDIUM_IDS, and this is the load-bearing rule of
 * the module.
 *
 * A plan covering seven of eight media looks like a bargain - most users are
 * in potting mix, and the missing one might never be opened. But the cache
 * makes the hole PERMANENT: the entry is a hit, so the miss that would have
 * refetched it never happens again, and the one user who moves a plant to pon
 * gets an empty care screen for the life of the install. The same applies to a
 * plan written by an older build that knew fewer media - it is not stale
 * advice, it is advice with a gap, and the only repair is to refuse it and ask
 * again. Accepting partial data is cheap exactly once and expensive forever.
 */
export function isGenusCarePlan(value: unknown): value is GenusCarePlan {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;

  if (typeof p.genus !== 'string' || p.genus.trim() === '') return false;
  if (typeof p.family !== 'string') return false;
  if (typeof p.fetchedAt !== 'string') return false;
  if (typeof p.bySoil !== 'object' || p.bySoil === null) return false;

  const bySoil = p.bySoil as Record<string, unknown>;
  return SOIL_MEDIUM_IDS.every((id) => isSoilCarePlan(bySoil[id]));
}

export interface ParseOptions {
  genus: string;
  family: string;
  now?: () => number;
}

/*
 * Turn a raw response into a plan, taking `bySoil` from the ANSWER but genus
 * and family from the REQUEST.
 *
 * That split is not pedantry. The cache is keyed on the genus we asked about,
 * and models normalize: ask about 'Alocasia' and the answer may come back
 * labelled 'Alocasia (Elephant Ear)' or corrected to the accepted synonym. Let
 * the response name itself and the plan is written under a key nothing will
 * ever look up, so every render refetches and the cache silently does nothing.
 * The genus is ours; only the advice is the model's.
 *
 * Throws rather than returning null because the only caller that matters is on
 * the write path: a plan that does not validate must not reach storage, where
 * it would be served back as a hit forever. `get` below is where the throw is
 * turned into the null a screen can live with.
 */
export function parseGenusCarePlan(value: unknown, options: ParseOptions): GenusCarePlan {
  const now = options.now ?? (() => Date.now());
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

  const plan = {
    genus: options.genus,
    family: options.family,
    fetchedAt: new Date(now()).toISOString(),
    bySoil: raw.bySoil,
  };

  if (!isGenusCarePlan(plan)) {
    throw new Error(
      `incomplete care plan for ${options.genus}: every growing medium must be covered`
    );
  }
  return plan;
}

/*
 * The storage seam, identical in shape to `StorageDeps` in plantStore so both
 * can be handed the same sync kv-store. Sync for the same reason it is there:
 * a care screen must render the right plan on its first frame, and an async
 * read means a frame of fallback advice that then changes under the user.
 */
export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GenusCarePlanDeps {
  storage: CacheStorage;
  /*
   * The network call, injected. It returns `unknown` on purpose: the route
   * that answers it is a server concern and its response is untrusted input
   * like any other, so validation happens here rather than being assumed by a
   * type at the boundary.
   */
  fetchPlan(genus: string, family: string): Promise<unknown>;
  now?: () => number;
}

export function createGenusCarePlanCache(deps: GenusCarePlanDeps) {
  const now = deps.now ?? (() => Date.now());

  /*
   * Read the cache, synchronously, and never fetch.
   *
   * An entry that will not parse, or that no longer validates, is REMOVED
   * rather than merely reported as a miss. Left in place it is re-read and
   * re-rejected on every render, and - worse - `get` would keep refetching and
   * rewriting over bytes that a future bug might start accepting again.
   * Deleting turns a permanent bad state into one refetch.
   */
  function peek(genus: string, lang: Language): GenusCarePlan | null {
    const key = cacheKeyFor(genus, lang);
    const raw = deps.storage.getItem(key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      drop(key);
      return null;
    }

    if (!isGenusCarePlan(parsed)) {
      drop(key);
      return null;
    }
    return parsed;
  }

  /* Best effort: the read has already failed and the caller is about to
   * refetch, so a storage error here must not become a second failure. */
  function drop(key: string): void {
    try {
      deps.storage.removeItem(key);
    } catch {
      /* best effort */
    }
  }

  /*
   * The cached plan, or one fetch to get it.
   *
   * Returns NULL rather than throwing on any failure. A genus care plan is
   * enrichment: every caller has a local fallback (the per-medium multipliers
   * in soilMedia.ts) and a plant must still save, still render and still
   * schedule with no network at all. Turning a failed enrichment into an
   * exception would push that decision onto every screen, and one screen would
   * forget.
   */
  async function get(
    genus: string,
    family: string,
    lang: Language
  ): Promise<GenusCarePlan | null> {
    const cached = peek(genus, lang);
    if (cached) return cached;

    let plan: GenusCarePlan;
    try {
      const raw = await deps.fetchPlan(genus, family);
      plan = parseGenusCarePlan(raw, { genus, family, now });
    } catch {
      /*
       * Nothing is written on failure, deliberately. Caching a miss would save
       * a retry and cost the user their care advice until they reinstall - the
       * next launch is online more often than not, and a refetch is one call.
       */
      return null;
    }

    /*
     * The write is the last thing that happens and the only thing allowed to
     * fail quietly. By this point the plan is in hand and correct; a full disk
     * costs a refetch next session, and must not cost the user the care screen
     * in the one session where the call actually succeeded. Unlike plantStore,
     * there is no read-back - a lost cache entry is a wasted call, not lost
     * user data, and it is not worth a second storage round-trip on a path
     * that runs behind a network fetch.
     */
    try {
      deps.storage.setItem(cacheKeyFor(genus, lang), JSON.stringify(plan));
    } catch {
      /* best effort */
    }
    return plan;
  }

  return { peek, get };
}

export type GenusCarePlanCache = ReturnType<typeof createGenusCarePlanCache>;
