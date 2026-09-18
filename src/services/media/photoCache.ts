import { InteractionManager } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { isRemoteUri } from '../../lib/media/remoteUri';
import { photoCacheKey } from '../../lib/media/photoCacheKey';
import { plantPhotoMirror } from './photoMirror';
import { photoSizes } from './photoSizes';

/*
 * Making a plant's photograph appear the instant the screen does.
 *
 * Three costs sit between a stored photo and a drawn one, and only the first
 * of them had ever been paid down:
 *
 *   1. THE NETWORK. Solved by `photoCacheKey` (keying expo-image's disk cache
 *      on the object path so a re-signed url is not a new image) and, now, by
 *      `photoMirror` (a real file on the phone, which cannot expire or be
 *      evicted). Nothing here.
 *
 *   2. THE DISK READ AND JPEG DECODE. A cached photo is still bytes on flash
 *      that have to be read and decoded into a bitmap the first time anything
 *      draws them. That is the lag when Home and Portfolio are swapped: the
 *      images are "cached", and every one of them is still decoding from cold
 *      because the memory cache was emptied when the screen went away. This is
 *      what `warmPhotos` removes, by doing the decode before the screen asks.
 *
 *   3. THE MEASUREMENT. A photo cannot be laid out inside its frame until its
 *      own dimensions are known, and those arrive from an `onLoad` callback -
 *      a frame late however fast the bytes were. That is why a photo appears in
 *      the wrong crop and snaps into the right one. `learnPhotoSizes` measures
 *      ahead of time so the first frame is already correct; `photoSizeStore`
 *      then remembers it forever, so it is measured once per photo, ever.
 *
 *   4. THE PIXELS. Photos are stored at 1600px and drawn into 48px circles.
 *      Not addressed here - a smaller stored variant is its own change.
 *
 * WHY PREFETCH IS ONLY EVER GIVEN LOCAL URIS. `Image.prefetch` takes no
 * `cacheKey` (see its signature in expo-image 56). Handed a signed url it warms
 * the cache under that url - and every actual <Image> in this app reads under
 * the object PATH, because that is what `photoCacheKey` returns. So prefetching
 * a remote photo warms an entry nothing will ever look up, costs a download,
 * and leaves the screen exactly as slow. Local files have no such split: their
 * URI is their key. Remote photos are made fast by being mirrored, not by being
 * prefetched.
 */

/*
 * Enough to cover the screens that are actually looked at - a Portfolio above
 * the fold, Home's face strip, the hero and its next few candidates - without
 * decoding a two-hundred-plant library into memory for the sake of rows nobody
 * has scrolled to. The list beyond it still decodes lazily, exactly as before.
 */
const WARM_CAP = 24;

/*
 * Warmed once per launch. A second request for the same URI is not merely
 * wasted work: these calls come from focus effects, so without this a tab swap
 * would re-issue the whole batch every single time.
 */
const warmed = new Set<string>();

/*
 * Pull photos into the in-memory image cache ahead of the screen that draws
 * them. Fire and forget - a failure means the photo decodes on demand, which is
 * the behaviour this is an improvement on.
 */
function warmPhotos(uris: readonly (string | undefined)[], cap: number = WARM_CAP): void {
  const fresh: string[] = [];
  for (const uri of uris) {
    if (fresh.length >= cap) break;
    // Remote urls are skipped on purpose - see the note above; they are handled
    // by being mirrored to disk, after which they arrive here as file URIs.
    if (typeof uri !== 'string' || uri.length === 0 || isRemoteUri(uri)) continue;
    if (warmed.has(uri)) continue;
    warmed.add(uri);
    fresh.push(uri);
  }
  if (fresh.length === 0) return;

  ExpoImage.prefetch(fresh, 'memory-disk').catch(() => {
    /*
     * Forget the failures so a later attempt can retry them. A photo that
     * failed to warm still draws - the <Image> fetches it itself - so this is
     * a lost optimisation, never a lost picture.
     */
    for (const uri of fresh) warmed.delete(uri);
  });
}

/*
 * Forget what has been warmed, so it can be warmed again.
 *
 * Belongs beside `ExpoImage.clearMemoryCache()`: once the image caches have
 * been emptied, this set is a record of decodes that no longer exist, and
 * anything in it would be skipped forever. Rare and blunt, same as the clear it
 * accompanies - a user replaces a photo a handful of times, ever.
 */
export function resetPhotoWarmth(): void {
  warmed.clear();
}

export interface CacheablePlant {
  id: string;
  photoUri: string;
}

/*
 * How large a copy is decoded purely to read a photo's proportions.
 *
 * Small because nothing is drawn from it - `photoLayout` uses the ASPECT RATIO
 * and nothing else (it scales the natural size by a cover factor derived from
 * the same two numbers), so a uniformly downscaled measurement produces pixel
 * for pixel the same layout as the full one. Not smaller than this, because the
 * resized dimensions are whole numbers and rounding them is the only way this
 * can be wrong: at 256 the ratio is off by well under a percent, which is
 * invisible, and it is corrected by the real `onLoad` the first time the photo
 * is actually drawn.
 *
 * The size constraint is not an optimisation, it is the documented requirement:
 * `loadAsync` on a large image without one can crash on memory.
 */
const SIZE_PROBE_PX = 256;

/*
 * Measure photos before anything tries to draw them.
 *
 * This is what removes the SNAP - the photo appearing in the old centred crop
 * and jumping into the framing the user chose a frame later. The jump is not a
 * loading delay and no amount of caching touches it: `onLoad` is a callback, so
 * the dimensions it carries always arrive after the frame that needed them.
 * Measured ahead, the first frame is right.
 *
 * Only ever done once per photograph, ever, on any device: `photoSizes`
 * persists what it learns, so this loop finds nothing to do on every launch
 * after the one that learned the library.
 *
 * Sequential rather than parallel. These are decodes, and the whole point of
 * running them here is that they are off the path of something the user is
 * waiting for - turning them into a burst of concurrent native work would put
 * them right back on it.
 */
async function learnPhotoSizes(plants: readonly CacheablePlant[], cap: number): Promise<void> {
  let measured = 0;
  for (const plant of plants) {
    if (measured >= cap) return;
    const uri = plant.photoUri;
    if (typeof uri !== 'string' || uri.length === 0) continue;

    /* Keyed on the photo's stable identity, not on which copy of it is being
     * read - the mirrored file and the signed url are the same picture. */
    const key = photoCacheKey(uri) ?? uri;
    if (photoSizes.get(key)) continue;

    measured++;
    try {
      const ref = await ExpoImage.loadAsync(
        /* The cacheKey matters even here: without it a cloud photo would be
         * fetched under its signed url, which is a key nothing else in the app
         * reads - so the measurement would cost a whole extra download. */
        { uri: plantPhotoMirror.localFor(plant.id) ?? uri, cacheKey: photoCacheKey(uri) },
        { maxWidth: SIZE_PROBE_PX }
      );
      photoSizes.remember(key, { width: ref.width, height: ref.height });
    } catch {
      /* A photo we could not measure simply measures itself when it is drawn,
       * which is the behaviour this is an improvement on. */
    }
  }
}

/*
 * The single call a screen makes after it reads the library. Idempotent and
 * cheap once everything has landed, which is what lets the focus effects call
 * it unconditionally on every visit.
 *
 * DEFERRED UNTIL THE NAVIGATION ANIMATION IS DONE, and that is not a detail.
 * This is called from a focus effect, which fires while the screen is sliding
 * in - so decoding two dozen images and starting a batch of downloads right
 * there competes with the transition for the JS thread and the result is a tab
 * swap that visibly stutters. Everything below is work for a screen that has
 * already painted; none of it is worth a dropped frame in front of the user.
 * `runAfterInteractions` puts it in the gap immediately after.
 *
 * Order matters within it. Warming runs FIRST, against whatever is already
 * local, so the photos that can be made fast right now are not queued behind a
 * download for ones that cannot. The mirror then fills in the rest in the
 * background and notifies the screens, which re-render onto the local copy.
 */
export function syncPhotoCache(plants: readonly CacheablePlant[]): void {
  InteractionManager.runAfterInteractions(() => {
    warmPhotos(plants.map((p) => plantPhotoMirror.localFor(p.id) ?? p.photoUri));
    void learnPhotoSizes(plants, WARM_CAP);
    void plantPhotoMirror.ensure(plants).then((landed) => {
      if (landed > 0) warmPhotos(plants.map((p) => plantPhotoMirror.localFor(p.id)));
    });
  });
}
