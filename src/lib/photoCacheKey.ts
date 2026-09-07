/*
 * A cache key for a plant's photograph that survives the URL changing.
 *
 * WHY THE PHOTOS RELOADED EVERY LAUNCH. Every <Image> already asks for
 * `cachePolicy="memory-disk"`, and it was doing nothing for cloud plants.
 * expo-image keys its disk cache by the URI, and a cloud photo's URI is a
 * SIGNED url whose `?token=...` is minted fresh - the signing cache is
 * in-memory only, so a cold start re-signs every photo and hands <Image> a
 * string it has never seen. Every launch was therefore a full re-download of
 * the whole library over the network.
 *
 * The stable part of that URL is its PATH: `.../plants/<user>/<plant>.jpg` is
 * the same object however many times it is re-signed. Keying on the path turns
 * the disk cache back on without changing how anything is fetched.
 *
 * THE STALENESS THIS BUYS, AND WHO PAYS IT. `replacePhoto` overwrites the same
 * object path, so a replaced photo keeps its key and the cache would serve the
 * old picture. expo-image has no per-key eviction - only a global clear - so
 * the screen that replaces a photo clears the cache after a successful write.
 * Rare operation, blunt fix, and correct; the alternative is a plant showing a
 * photo the user has already replaced, which reads as the edit having failed.
 */

/*
 * The key for a photo, or undefined to let expo-image key on the URI itself.
 *
 * A local `file://` photo needs no help: its URI is already stable and unique,
 * and inventing a key for it would only add a way to get it wrong.
 */
export function photoCacheKey(photoUri: string): string | undefined {
  if (typeof photoUri !== 'string') return undefined;

  const trimmed = photoUri.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;

  /* Everything before the query. The token, its expiry and any other signing
   * parameter live in the query and are exactly what must not be in the key. */
  const path = trimmed.split('?')[0];

  // A URL that is nothing but a query is not something to key on.
  return path.length > 0 ? path : undefined;
}
