/*
 * Where a plant's growth journal is kept.
 *
 * WHY ITS OWN BLOB AND NOT A FIELD ON `StoredPlant`. Two reasons, and the
 * second is the load-bearing one.
 *
 * 1. The library is re-read on every render of Home and every focus of a card.
 *    The journal is read when one plant's screen opens. Folding a per-screen
 *    list of photographs into the hot blob makes every watering write
 *    re-serialize it, and makes a corrupt library also lose every note the user
 *    has written.
 *
 * 2. A LOGGED-IN USER'S LIBRARY IS A MIRROR OF THE CLOUD, and `plantRepo`
 *    refreshes it by writing the rows the server returned VERBATIM. The journal
 *    is deliberately local in v1 - no column, no migration, no upload - so a
 *    field on the plant record would be erased by the next refresh, on a
 *    timeline the user cannot predict and with no error to show them. A
 *    separate key is untouched by that write, which is the only way "local
 *    only" can actually mean local only.
 *
 * The consequence to keep in mind when v2 adds sync: this store is keyed by
 * plant id and knows nothing about accounts, so the journal follows the DEVICE.
 * Signing in on a second phone shows the plants and not their journals. That is
 * the deal v1 makes, and `services/media/photos.ts` makes the same one for the
 * files themselves.
 *
 * Pure/bound split mirrors plantStore <-> plantLibrary: no native imports here,
 * so `node --test` can exercise the whole thing without an Expo runtime.
 */

import {
  addEntry,
  normalizeGrowth,
  photoIds,
  removeEntry,
  repointPhoto,
  setNote,
  type GrowthEntry,
} from '../../lib/care/growth.ts';
import type { StorageDeps } from './plantStore';

export type { StorageDeps } from './plantStore';

export const GROWTH_KEY = 'plantai.growth';

/* Bump only alongside a migration step. v1 is current. */
export const GROWTH_VERSION = 1;

interface Journal {
  version: number;
  /* Keyed by plant id. A plant with no photographs holds no key at all rather
   * than an empty array, so the blob does not grow one entry per plant the
   * moment the feature ships. */
  plants: Record<string, GrowthEntry[]>;
}

export interface GrowthOptions {
  now?: () => number;
  newId?: () => string;
}

export type GrowthResult =
  | { ok: true; entries: GrowthEntry[] }
  | { ok: false; reason: 'storage_full' };

/*
 * An unreadable journal reports EMPTY rather than throwing, and does not
 * quarantine the way the library does.
 *
 * The asymmetry is deliberate. A corrupt library is the user's whole collection
 * and worth preserving bytes for a support conversation; a corrupt journal is
 * photographs whose files are still sitting in the document directory and whose
 * index is gone. There is nothing a later build could do with the damaged text
 * that it cannot do with the files. What matters is that the screen still opens
 * - a plant whose journal cannot be parsed must not be a plant that cannot be
 * viewed.
 */
export function createGrowthStore(storage: StorageDeps, opts: GrowthOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId =
    opts.newId ??
    (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  function readAll(): Record<string, GrowthEntry[]> {
    let raw: string | null;
    try {
      raw = storage.getItem(GROWTH_KEY);
    } catch {
      return {};
    }
    if (raw === null) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (typeof parsed !== 'object' || parsed === null) return {};

    const journal = parsed as Partial<Journal>;
    /*
     * A blob from a newer build is intact data in a shape this one does not
     * understand. Reading it as v1 would drop whatever the newer version added
     * and the next write would persist that loss, so this build declines to
     * read it at all - the same rule plantStore applies, minus the quarantine.
     */
    if (typeof journal.version === 'number' && journal.version > GROWTH_VERSION) return {};
    if (typeof journal.plants !== 'object' || journal.plants === null) return {};

    const out: Record<string, GrowthEntry[]> = {};
    for (const [plantId, list] of Object.entries(journal.plants)) {
      /* Normalized on the way OUT, per plant: one damaged list must not cost
       * the user the journals of every other plant. */
      const entries = normalizeGrowth(list);
      if (entries.length > 0) out[plantId] = entries;
    }
    return out;
  }

  /*
   * Persist and CONFIRM, the same read-back plantStore does and for the same
   * reason: `setItem` succeeding is not evidence the bytes landed - a full disk
   * throws on some platforms and returns quietly on others.
   */
  function persist(all: Record<string, GrowthEntry[]>): boolean {
    const payload = JSON.stringify({ version: GROWTH_VERSION, plants: all } satisfies Journal);
    try {
      storage.setItem(GROWTH_KEY, payload);
    } catch {
      return false;
    }
    try {
      return storage.getItem(GROWTH_KEY) === payload;
    } catch {
      return false;
    }
  }

  /* One plant's journal, newest first and already cleaned. */
  function entriesFor(plantId: string): GrowthEntry[] {
    return readAll()[plantId] ?? [];
  }

  /*
   * The shape every mutation below shares: read everything, hand this plant's
   * list to a pure function from lib/care/growth.ts, write the result back. A
   * plant whose list comes back empty loses its KEY rather than keeping an
   * empty array, so deleting the last photo leaves a blob byte-identical to one
   * where the feature was never used.
   */
  function write(plantId: string, next: (entries: GrowthEntry[]) => GrowthEntry[]): GrowthResult {
    const all = readAll();
    const entries = next(all[plantId] ?? []);
    if (entries.length > 0) all[plantId] = entries;
    else delete all[plantId];

    if (!persist(all)) return { ok: false, reason: 'storage_full' };
    return { ok: true, entries };
  }

  /*
   * Add a photograph.
   *
   * Returns the entry as well as the list because the caller needs its ID
   * immediately: the id is the name of the file the photo will be copied to,
   * and that copy starts the moment this returns.
   */
  function add(
    plantId: string,
    input: { photoUri: string; note?: string },
    at: number = now()
  ): GrowthResult & { entry?: GrowthEntry } {
    const id = newId();
    const result = write(plantId, (entries) =>
      addEntry(entries, { id, photoUri: input.photoUri, note: input.note }, at)
    );
    if (!result.ok) return result;
    return { ...result, entry: result.entries.find((e) => e.id === id) };
  }

  function remove(plantId: string, entryId: string): GrowthResult {
    return write(plantId, (entries) => removeEntry(entries, entryId));
  }

  /* Point an entry at the document-directory copy once it lands. */
  function setPhotoUri(plantId: string, entryId: string, photoUri: string): GrowthResult {
    return write(plantId, (entries) => repointPhoto(entries, entryId, photoUri));
  }

  function editNote(plantId: string, entryId: string, note: string | undefined): GrowthResult {
    return write(plantId, (entries) => setNote(entries, entryId, note));
  }

  /* Drop a whole plant's journal, for a plant the user removed. The caller
   * deletes the files - this store never touches the filesystem. */
  function discardPlant(plantId: string): GrowthResult {
    return write(plantId, () => []);
  }

  /*
   * Forget the journals of plants that are no longer in the library, returning
   * how many went.
   *
   * REFUSES TO RUN against a library that did not load: an unreadable library
   * reports zero plants, and pruning on that would delete every journal the
   * user has. Exactly the guard `photoStore.sweep` carries, for exactly the
   * same accident.
   */
  function prune(keepPlantIds: string[], opts: { libraryReadable?: boolean } = {}): number {
    if (opts.libraryReadable === false) return 0;
    const all = readAll();
    const keep = new Set(keepPlantIds);
    let dropped = 0;
    for (const plantId of Object.keys(all)) {
      if (keep.has(plantId)) continue;
      delete all[plantId];
      dropped++;
    }
    if (dropped === 0) return 0;
    return persist(all) ? dropped : 0;
  }

  /*
   * Every photo file the journal still claims, across all plants. This is the
   * keep-list for the growth photo sweep, and it must be read from storage at
   * the moment of the sweep rather than from anything a screen is holding.
   */
  function allPhotoIds(): string[] {
    const out: string[] = [];
    for (const entries of Object.values(readAll())) out.push(...photoIds(entries));
    return out;
  }

  /*
   * Account deletion: forget every journal on this device.
   *
   * Deliberately NOT called on sign-out. A journal is keyed by plant id and
   * never left the phone, so it belongs to whoever holds the phone rather than
   * to the session - the same reasoning that leaves the guest plant key alone
   * when someone only meant to switch accounts. Deletion is the explicit
   * "erase me" path, and there it goes with everything else.
   *
   * The caller deletes the files; this store never touches the filesystem.
   */
  function wipeAll(): void {
    try {
      storage.removeItem(GROWTH_KEY);
    } catch {
      /* best effort - the deletion it is part of has already succeeded, and
       * throwing here would report a failed account deletion that did happen */
    }
  }

  return {
    entriesFor,
    add,
    remove,
    setPhotoUri,
    editNote,
    discardPlant,
    prune,
    allPhotoIds,
    wipeAll,
  };
}
