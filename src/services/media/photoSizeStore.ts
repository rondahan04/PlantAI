import type { Size } from '../../lib/media/photoFocus.ts';

/*
 * Every photograph's natural pixel size, remembered across launches.
 *
 * WHY A PHOTO VISIBLY JUMPS WHEN IT APPEARS. `photoLayout` needs three things
 * to place a picture inside its frame: the frame, the framing the user chose,
 * and the image's own width and height. The first two are known before the
 * first pixel is drawn. The third arrives from `onLoad`, which is a callback,
 * which means it is at best a frame late - and until then `photoLayout` is
 * handed a zero size and answers with the old centred cover fit.
 *
 * So the photo appears with the WRONG crop and snaps into the right one a
 * frame later. On a cold library that is every photo on the screen snapping at
 * once, and it happens even when the bytes came off the local disk instantly:
 * the delay is the callback, not the fetch, so none of the caching work
 * touches it.
 *
 * The natural size of a photograph never changes. It only has to be learnt
 * once, ever - and then the very first frame can be correct. That is all this
 * module is: a small, durable map from a photo to its dimensions.
 *
 * KEYED THE SAME WAY THE IMAGE CACHE IS - on the object path for a cloud photo
 * (a signed url's token is minted fresh and would make a new key every hour),
 * on the URI itself for a local file. See `lib/media/photoCacheKey`.
 *
 * Pure, with a storage seam, for the same reason `plantStore` is: `node --test`
 * covers the pruning and the corrupt-blob paths, which are the parts worth
 * covering, without needing an Expo runtime.
 */

export const PHOTO_SIZES_KEY = 'plantai.photoSizes.v1';

/*
 * How many photos are remembered. A library is a few dozen plants; the cap is
 * there so a user who has replaced photos for years does not carry a blob of
 * dead keys around, not because anyone is expected to reach it. Oldest-learnt
 * go first, which for this data is the same as least-likely-to-be-drawn.
 */
export const MAX_REMEMBERED = 300;

export interface SizeStorageDeps {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/* A size worth storing: two positive, finite, whole numbers. Anything else is
 * a measurement that failed, and writing it would pin the wrong geometry in
 * place permanently - strictly worse than the one-frame snap. */
export function isUsableSize(value: unknown): value is Size {
  if (typeof value !== 'object' || value === null) return false;
  const { width, height } = value as Partial<Size>;
  return (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

/*
 * Parse the stored blob, keeping only entries that are still meaningful.
 *
 * Insertion order IS the age order - the object is written back in the order
 * it is held - which is what makes the prune below a simple slice.
 */
export function parseSizes(raw: string | null): Map<string, Size> {
  const out = new Map<string, Size>();
  if (!raw) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt blob is a forgotten optimisation, never a broken screen: every
    // photo simply measures itself again, exactly as it did before this existed.
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key) continue;
    if (!isUsableSize(value)) continue;
    out.set(key, { width: value.width, height: value.height });
  }
  return out;
}

export function createPhotoSizeStore(deps: SizeStorageDeps) {
  /*
   * Read once, held for the session, written through.
   *
   * `get` is called during RENDER - once per photo, on a scrolling list - so it
   * has to be a map lookup, not a storage read and a JSON parse. The write side
   * is what keeps the map honest.
   */
  let sizes: Map<string, Size> | null = null;

  function load(): Map<string, Size> {
    if (sizes) return sizes;
    let raw: string | null;
    try {
      raw = deps.getItem(PHOTO_SIZES_KEY);
    } catch {
      raw = null;
    }
    sizes = parseSizes(raw);
    return sizes;
  }

  function persist(map: Map<string, Size>): void {
    try {
      deps.setItem(PHOTO_SIZES_KEY, JSON.stringify(Object.fromEntries(map)));
    } catch {
      /* A size we could not write is a photo that measures itself again next
       * launch. Not worth surfacing, and certainly not worth throwing under a
       * component's onLoad. */
    }
  }

  function get(key: string): Size | undefined {
    if (!key) return undefined;
    return load().get(key);
  }

  /*
   * Learn a photo's size.
   *
   * WRITES ONLY WHEN SOMETHING CHANGED, which is the difference between a
   * handful of storage writes on a first launch and one on every `onLoad` of
   * every image for the life of the app - including the ones that fire as a
   * list recycles rows under a scrolling thumb.
   */
  function remember(key: string, size: Size): void {
    if (!key || !isUsableSize(size)) return;
    const map = load();
    const known = map.get(key);
    if (known && known.width === size.width && known.height === size.height) return;

    // Re-inserted at the end even when it was already present, so "oldest" in
    // the prune below means oldest-learnt rather than oldest-ever-seen.
    map.delete(key);
    map.set(key, { width: size.width, height: size.height });

    if (map.size > MAX_REMEMBERED) {
      const excess = map.size - MAX_REMEMBERED;
      let dropped = 0;
      for (const oldest of map.keys()) {
        if (dropped >= excess) break;
        map.delete(oldest);
        dropped++;
      }
    }

    persist(map);
  }

  /* Sign-out and account deletion: sizes are not secret, but they are a list of
   * object paths belonging to an account nobody is signed into. */
  function clear(): void {
    sizes = new Map();
    persist(sizes);
  }

  function size(): number {
    return load().size;
  }

  return { get, remember, clear, size };
}

export type PhotoSizeStore = ReturnType<typeof createPhotoSizeStore>;
