/*
 * Is this photo somewhere on the network, or on this phone?
 *
 * WHY THE DISTINCTION EXISTS AT ALL. A plant's `photoUri` is not one kind of
 * string. A photo just taken is a local `file://` in the cache or documents
 * directory; a plant read back from the cloud carries a SIGNED HTTPS URL,
 * because `supabasePlantCloud.fetchAll` resolves every `photo_path` to one so
 * that <Image> can render it. Both are legitimately "the plant's photo".
 *
 * WHAT WENT WRONG WITHOUT IT. `readAsStringAsync` reads local files only. Handed
 * a signed URL it throws, and "Diagnose all" caught that per plant and counted a
 * failure - so for a logged-in user every plant failed, silently, and the button
 * looked dead. The bug was not in the bulk runner: it was that nothing asked
 * which kind of URI it had been given.
 *
 * Kept as its own tiny module so the question can be tested under `node --test`
 * without importing expo-file-system, which needs a native runtime.
 */

/*
 * True for a URI whose bytes have to be fetched over the network before they can
 * be read.
 *
 * Only http and https. `file:`, `content:`, `asset:`, `ph:` and a bare path are
 * all local as far as the file system is concerned, and a `data:` URI carries
 * its own bytes and needs no fetch either - treating any of them as remote would
 * send a download at something that is already here.
 */
export function isRemoteUri(uri: string): boolean {
  if (typeof uri !== 'string') return false;
  return /^https?:\/\//i.test(uri.trim());
}
