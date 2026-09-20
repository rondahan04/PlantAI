/*
 * A durable on-device copy of every cloud plant photo.
 *
 * WHY THIS EXISTS, WHEN expo-image ALREADY HAS A DISK CACHE. Two reasons, and
 * the second is the one that made this unavoidable.
 *
 * First, the cache is evictable. It is a cache: iOS reclaims it under pressure,
 * on a schedule nobody controls. A logged-in user's photos live nowhere else on
 * the phone, so an eviction means the whole library re-downloads over the
 * network - and if the phone is offline at that moment, the library is a wall
 * of grey boxes for plants the user definitely still owns.
 *
 * Second, and worse: the mirror persists a plant's photoUri as the SIGNED url
 * it was read with, and a signed url is valid for an hour. On a cold start the
 * library paints from that mirror, so every remote photoUri on screen is
 * already expired. `photoCacheKey` is what rescued this - it keys the cache on
 * the object path so the expired url never has to be fetched - but that only
 * holds while the cached bytes are there. The moment they are not, the app asks
 * an expired url for an image and gets a 400, and stays broken until
 * `refreshFromCloud` lands and re-signs.
 *
 * A `file://` copy has neither problem. It cannot expire, it cannot be evicted,
 * it needs no network, and - because its URI is stable - `Image.prefetch` can
 * actually warm it, which a re-signed url can never be (prefetch takes no
 * cacheKey, so a prefetched signed url lands under a key nothing reads).
 *
 * GUEST PHOTOS ARE NOT MIRRORED. They are already local files owned by
 * `photoStore`, in a different directory, swept by different rules. Mirroring
 * a local file to another local file is pure waste.
 *
 * Native imports are deliberately absent, same seam as `photoStore`: the
 * interesting cases - a download that resolves without writing bytes, a full
 * disk, a directory that cannot be listed - are testable under `node --test`
 * and are not reproducible on a simulator on demand. `photoMirror.ts` binds
 * this to expo-file-system.
 */

/* One definition of "is this on the network", shared with the repo and the
 * bulk-diagnose runner rather than re-guessed here. */
import { isRemoteUri } from '../../lib/media/remoteUri.ts';

export const MIRROR_DIR_NAME = 'plant-photos-cloud';

/*
 * How many downloads run at once. The point of this whole module is that the
 * library appears instantly from disk, so the downloads are background work
 * behind an already-painted screen; opening thirty sockets to fill a cache
 * would compete with the requests the user is actually waiting for.
 */
const CONCURRENCY = 4;

/*
 * How many times one URL is tried before it is left alone.
 *
 * COUNTED PER URL, NOT PER PLANT, and that distinction is the whole reason this
 * constant needs a comment. On a cold start the library paints from the mirror,
 * whose stored photoUris are signed urls MINTED LAST SESSION and therefore
 * already expired - so the first downloads a logged-in user's first launch
 * attempts are all doomed, through no fault of the photo. Counting against the
 * plant would spend its entire budget on those, and the re-signed url that
 * `refreshFromCloud` produces moments later - the one that would actually have
 * worked - would never be tried at all. A fresh signature is a fresh URL and so
 * gets a fresh budget, which is exactly right: it is a genuinely different
 * request.
 *
 * The budget still does its job within a session for the failures worth giving
 * up on - a deleted object, a path the bucket will not serve - which would
 * otherwise be re-requested by every focus effect on every screen forever.
 */
const MAX_ATTEMPTS = 2;

export interface MirrorDeps {
  /* Document directory URI, trailing slash included. */
  documentDir: string;
  ensureDir(uri: string): void;
  exists(uri: string): boolean;
  /* File names (not URIs) directly inside `uri`; empty when it does not exist. */
  list(uri: string): string[];
  /* Fetch `url` into `destination`. Rejects on any failure. */
  download(url: string, destination: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /* Best effort, never throws. */
  remove(uri: string): void;
}

export interface MirrorablePlant {
  id: string;
  photoUri: string;
}

export interface SweepOptions {
  /*
   * Whether the library the keep-list came from actually loaded. Identical
   * reasoning to photoStore.sweep: a corrupt library reports zero plants, and
   * sweeping on that would delete the user's entire mirrored library.
   */
  libraryReadable?: boolean;
}

/* Only extensions a plant photo can plausibly carry. */
const MAX_EXT_LEN = 5;

/*
 * Lowercased extension without the dot, or `jpg`. Unlike a picker URI, a signed
 * url always has a query attached, and it is routinely longer than the path -
 * so the query and fragment are stripped before anything else is read.
 */
export function mirrorExtension(sourceUri: string): string {
  const path = sourceUri.split('?')[0].split('#')[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'jpg';

  const ext = name.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > MAX_EXT_LEN || !/^[a-z0-9]+$/.test(ext)) return 'jpg';
  return ext;
}

/*
 * Ids come from the cloud here, not from this device, so sanitising the
 * filename is not defensive housekeeping - it is the only thing between a
 * server-supplied string and a path.
 */
function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

/* The plant a mirrored file belongs to, or null for a name this store did not
 * write (a stray file, a half-finished `.part`). */
export function idFromMirrorName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const base = name.slice(0, dot);
  // `.part` files are in-flight downloads, not photos anyone can render.
  if (name.endsWith('.part')) return null;
  return base.length > 0 ? base : null;
}

/*
 * `dirName` exists so a second, independent mirror can be created for
 * something that is not a plant photo - the account's avatar is one file
 * keyed on the user rather than many keyed on plants, and it must not be
 * swept by a pass that reasons about the plant id list. Same machinery,
 * separate directory, separate index.
 */
export function createPhotoMirror(deps: MirrorDeps, dirName: string = MIRROR_DIR_NAME) {
  const dir = `${deps.documentDir.replace(/\/+$/, '')}/${dirName}/`;

  /*
   * id -> file URI, built once from a single directory listing.
   *
   * Lazy and then held, because `localFor` is called during RENDER - once per
   * photo, per frame, on a scrolling list. A directory listing there would be
   * a syscall per row per frame. Every write below keeps the map in step, so it
   * never needs rebuilding.
   */
  let index: Map<string, string> | null = null;
  const inFlight = new Set<string>();
  /* Keyed on plant AND url - see MAX_ATTEMPTS. */
  const attempts = new Map<string, number>();

  function attemptKey(id: string, photoUri: string): string {
    return `${safeId(id)}\n${photoUri}`;
  }
  const listeners = new Set<() => void>();

  function load(): Map<string, string> {
    if (index) return index;
    const built = new Map<string, string>();
    let names: string[];
    try {
      names = deps.list(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const id = idFromMirrorName(name);
      if (id) built.set(id, `${dir}${name}`);
    }
    index = built;
    return built;
  }

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* a subscriber that throws must not stop the others being told */
      }
    }
  }

  /*
   * The local copy of this plant's photo, or undefined if there is not one yet.
   * Synchronous by contract - callers use it during render to choose which URI
   * to hand the image.
   */
  function localFor(id: string): string | undefined {
    if (!id) return undefined;
    return load().get(safeId(id));
  }

  /* Of these plants, the ones with a remote photo and no local copy yet. */
  function pending(plants: readonly MirrorablePlant[]): MirrorablePlant[] {
    const map = load();
    const out: MirrorablePlant[] = [];
    const seen = new Set<string>();
    for (const plant of plants) {
      if (!plant?.id || !plant.photoUri || !isRemoteUri(plant.photoUri)) continue;
      const key = safeId(plant.id);
      if (seen.has(key) || map.has(key) || inFlight.has(key)) continue;
      if ((attempts.get(attemptKey(plant.id, plant.photoUri)) ?? 0) >= MAX_ATTEMPTS) continue;
      seen.add(key);
      out.push(plant);
    }
    return out;
  }

  async function fetchOne(plant: MirrorablePlant): Promise<boolean> {
    const key = safeId(plant.id);
    const name = `${key}.${mirrorExtension(plant.photoUri)}`;
    const destination = `${dir}${name}`;
    /*
     * Downloaded beside the real name and moved into place, never written
     * straight to it. A download interrupted by a kill or a lost radio can
     * leave a partial file at the destination, and a partial JPEG is a file
     * that exists, indexes, renders as a broken image, and is never retried.
     * The move is the commit.
     */
    const staging = `${destination}.part`;

    inFlight.add(key);
    const tries = attemptKey(plant.id, plant.photoUri);
    attempts.set(tries, (attempts.get(tries) ?? 0) + 1);
    try {
      deps.ensureDir(dir);
      deps.remove(staging);
      await deps.download(plant.photoUri, staging);
      // A download that resolves is not evidence bytes landed - same read-back
      // as photoStore.adopt, for the same reason.
      if (!deps.exists(staging)) {
        deps.remove(staging);
        return false;
      }
      await deps.move(staging, destination);
      if (!deps.exists(destination)) return false;
    } catch {
      deps.remove(staging);
      return false;
    } finally {
      inFlight.delete(key);
    }

    load().set(key, destination);
    return true;
  }

  /*
   * Bring every remote photo in `plants` down to the phone.
   *
   * Fire and forget: the screen that calls this has already painted from the
   * mirror and has nothing to do with the result. Resolves when the batch is
   * done so tests can await it; nothing in the app does.
   *
   * Cheap on the common path - a fully mirrored library does one map lookup
   * per plant and returns - which is what lets the focus effects call it every
   * single time they run.
   */
  async function ensure(plants: readonly MirrorablePlant[]): Promise<number> {
    const queue = pending(plants);
    if (queue.length === 0) return 0;

    let cursor = 0;
    let landed = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length) {
        const plant = queue[cursor++];
        if (await fetchOne(plant)) landed++;
      }
    });
    await Promise.all(workers);

    // One notification for the batch rather than one per photo: every
    // subscriber is a component re-reading the whole index anyway.
    if (landed > 0) notify();
    return landed;
  }

  /*
   * Drop this plant's copy.
   *
   * Called when a photo is REPLACED, not only when a plant is deleted: the new
   * photo overwrites the same object path in the bucket, so a mirror keyed on
   * the plant would otherwise keep serving the picture the user just replaced -
   * which reads as the edit having failed.
   */
  function discard(id: string): void {
    const key = safeId(id);
    const map = load();
    const uri = map.get(key);
    if (uri) {
      deps.remove(uri);
      map.delete(key);
    }
    /* Every url ever tried for this plant, or a replacement photo that happens
     * to resolve to a url already written off would never be fetched. */
    const prefix = `${key}\n`;
    for (const tries of [...attempts.keys()]) {
      if (tries.startsWith(prefix)) attempts.delete(tries);
    }
    if (uri) notify();
  }

  /* Delete every mirrored file no plant claims, returning how many went. */
  function sweep(keepIds: readonly string[], opts: SweepOptions = {}): number {
    if (opts.libraryReadable === false) return 0;

    const keep = new Set(keepIds.map(safeId));
    let names: string[];
    try {
      names = deps.list(dir);
    } catch {
      return 0;
    }

    const map = load();
    let deleted = 0;
    for (const name of names) {
      const id = idFromMirrorName(name);
      /*
       * A `.part` returns null here and is swept too, which is correct: it is
       * an abandoned download from a previous launch, and nothing in this
       * session is holding it - `fetchOne` removes its own staging file before
       * writing and on every failure path.
       */
      if (id !== null && keep.has(id)) continue;
      try {
        deps.remove(`${dir}${name}`);
        if (id !== null) map.delete(id);
        deleted++;
      } catch {
        /* best effort */
      }
    }
    if (deleted > 0) notify();
    return deleted;
  }

  /* Told when a photo lands, so a screen already showing the remote url can
   * switch to the local copy without waiting for its next reload. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /* Sign-out: another account's photos must not stay on this phone, and the
   * next account's ids would index against them. */
  function clear(): void {
    let names: string[];
    try {
      names = deps.list(dir);
    } catch {
      names = [];
    }
    for (const name of names) deps.remove(`${dir}${name}`);
    index = new Map();
    attempts.clear();
    notify();
  }

  return { dir, localFor, ensure, pending, discard, sweep, subscribe, clear };
}
