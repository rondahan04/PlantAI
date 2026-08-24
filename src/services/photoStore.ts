/*
 * Photo persistence (TODOS item 9).
 *
 * `expo-camera` and `expo-image-picker` both hand back a URI in the CACHE
 * directory. iOS empties that directory whenever it feels pressure for space -
 * on a timeline nobody controls and long after the user has forgotten saving
 * the plant. The record survives, the image does not, and the library fills up
 * with grey rectangles. So on save the file is copied into the document
 * directory, which the system does not reclaim, and the record is repointed at
 * the copy.
 *
 * Native imports are deliberately absent: the seam below is what lets
 * `node --test` exercise a purged source, a throwing copy and a copy that
 * silently writes nothing, none of which a simulator will reproduce on demand.
 * `photos.ts` binds it to `expo-file-system`, the same split as
 * `plantStore` / `plantLibrary`.
 *
 * One asymmetry worth naming: `copy` is async in expo-file-system 56 while
 * everything else here is sync. That is why saving does NOT wait on the copy -
 * the plant is persisted synchronously with its cache URI first (so a kill
 * mid-copy can only cost the picture, never the plant) and the document URI is
 * patched in afterwards.
 */

export const PHOTO_DIR_NAME = 'plant-photos';

/* Only extensions a plant photo can plausibly arrive with; anything else is a
 * guess, and a wrong guess in the filename is worse than the honest default. */
const MAX_EXT_LEN = 5;

export interface PhotoDeps {
  /* Document directory URI, trailing slash included. */
  documentDir: string;
  ensureDir(uri: string): void;
  exists(uri: string): boolean;
  /* File names (not URIs) directly inside `uri`; empty when it does not exist. */
  list(uri: string): string[];
  copy(from: string, to: string): Promise<void>;
  /* Best effort, never throws - a file we cannot delete is a leak, not a bug
   * the user can act on. */
  remove(uri: string): void;
}

/*
 * Lowercased extension without the dot, or `jpg` when the source has none we
 * can trust. `ph://` asset URIs and Android content URIs routinely have no
 * extension at all, and a directory containing a dot must not be mistaken for
 * one.
 */
export function photoExtension(sourceUri: string): string {
  const path = sourceUri.split('?')[0].split('#')[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'jpg';

  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > MAX_EXT_LEN || !/^[a-z0-9]+$/.test(ext)) return 'jpg';
  return ext;
}

/*
 * Ids are generated locally and are already URL-safe, but a filename derived
 * from data is a path-traversal waiting for the day the id comes from
 * somewhere else. Anything outside the safe set becomes an underscore.
 */
function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

export interface SweepOptions {
  /*
   * Whether the library the `keep` list came from actually loaded. A corrupt or
   * future-version library reports zero plants, and sweeping on that would
   * delete every photo the user owns - precisely the loss plantStore's
   * quarantine exists to prevent.
   */
  libraryReadable?: boolean;
}

export function createPhotoStore(deps: PhotoDeps) {
  const dir = `${deps.documentDir.replace(/\/+$/, '')}/${PHOTO_DIR_NAME}/`;

  function fileNameFor(id: string, ext: string): string {
    return `${safeId(id)}.${ext}`;
  }

  /* Every file this store wrote for `id`, whatever extension it landed with. */
  function filesFor(id: string): string[] {
    const prefix = `${safeId(id)}.`;
    try {
      return deps.list(dir).filter((name) => name.startsWith(prefix));
    } catch {
      return [];
    }
  }

  /* True when the URI is one this store owns, so callers can tell a persisted
   * photo from a cache URI still awaiting adoption. */
  function owns(uri: string): boolean {
    return typeof uri === 'string' && uri.startsWith(dir);
  }

  /*
   * The same photo, addressed through TODAY's document directory.
   *
   * iOS can preserve an app's data container while changing the UUID in its
   * path (a reinstall over an existing install does exactly this). The stored
   * URI is absolute, so every previously-adopted photo then points at a
   * container path that no longer resolves even though the file itself is
   * sitting untouched in the new one - the library fills with placeholders for
   * photos that were never actually lost.
   *
   * Recognising a URI as "ours, from a previous container" needs only the
   * directory name and the file name; both survive the move. Returns null for
   * anything that was never this store's file, so a genuine cache URI still
   * goes down the copy path below.
   */
  function relocate(uri: string): string | null {
    if (typeof uri !== 'string' || !uri.includes(`/${PHOTO_DIR_NAME}/`)) return null;
    const name = uri.slice(uri.lastIndexOf('/') + 1);
    if (!name) return null;
    return `${dir}${name}`;
  }

  /*
   * Copy `sourceUri` into the document directory under `id`.
   *
   * Returns the new URI, or `null` when the photo could not be rescued - an
   * already-purged source, a full disk, a copy that reported success without
   * writing bytes. `null` is not an error the user should see: the plant is
   * saved either way, and the caller simply leaves the record pointing at
   * whatever it had.
   */
  async function adopt(id: string, sourceUri: string): Promise<string | null> {
    if (!sourceUri) return null;
    // Already ours. The repair path re-adopts on every load, so this is the
    // common case, and it must not delete-then-recopy a file onto itself.
    if (owns(sourceUri)) return deps.exists(sourceUri) ? sourceUri : null;

    /*
     * Ours, but written under a previous container path - the file is already
     * where it belongs, so this is a repoint, not a copy. Checked before the
     * existence test below because that test is exactly what fails for a
     * stale container URI.
     */
    const moved = relocate(sourceUri);
    if (moved && deps.exists(moved)) return moved;

    if (!deps.exists(sourceUri)) return null;

    const destination = `${dir}${fileNameFor(id, photoExtension(sourceUri))}`;
    try {
      deps.ensureDir(dir);
      // Clear anything already sitting under this id - a re-diagnosis of the
      // same plant, or a leftover from a failed adopt. `copy` rejects rather
      // than overwriting unless told otherwise, and the binding cannot know
      // which of the two it is looking at.
      for (const name of filesFor(id)) deps.remove(`${dir}${name}`);

      await deps.copy(sourceUri, destination);
    } catch {
      return null;
    }

    // The read-back, same reason as plantStore.persist: a copy that resolves is
    // not evidence the bytes landed, and a record pointing at a file that does
    // not exist renders as a broken image forever.
    if (!deps.exists(destination)) return null;
    return destination;
  }

  /* Drop the photo for a plant the user removed. */
  function discard(id: string): void {
    for (const name of filesFor(id)) {
      try {
        deps.remove(`${dir}${name}`);
      } catch {
        /* best effort */
      }
    }
  }

  /*
   * Delete every photo no plant claims, returning how many went. Orphans come
   * from a kill between the copy and the record update, and from a removal
   * whose write failed after the file was already gone from the library.
   */
  function sweep(keepIds: string[], opts: SweepOptions = {}): number {
    if (opts.libraryReadable === false) return 0;

    const keep = new Set(keepIds.map(safeId));
    let names: string[];
    try {
      names = deps.list(dir);
    } catch {
      return 0;
    }

    let deleted = 0;
    for (const name of names) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      if (keep.has(base)) continue;
      try {
        deps.remove(`${dir}${name}`);
        deleted++;
      } catch {
        /* best effort */
      }
    }
    return deleted;
  }

  return { dir, adopt, discard, sweep, owns };
}

export type PhotoStore = ReturnType<typeof createPhotoStore>;
