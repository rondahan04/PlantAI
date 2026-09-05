/*
 * How big a photo the diagnosis endpoint will accept, decided on the device
 * before the upload rather than by the server after it.
 *
 * WHY THIS EXISTS. A full-resolution gallery pick exceeded the server's
 * 12 MB body cap in production (2026-08-22). The server did the right thing -
 * 413 `payload_too_large` with its own neutral copy - but React Native tears
 * the request down as the body is written, so the client never read that
 * response. It saw a transport failure and told the user "the network
 * connection was lost", which is advice to move closer to the router about a
 * photo that will fail identically on the strongest wifi in the world.
 *
 * Checking here also saves the upload itself: on a phone tethered to a hotspot
 * (how this app is tested) that is megabytes of someone's data spent to earn an
 * error we could have produced instantly.
 *
 * DUPLICATED CONSTANT, deliberately - the same call `server/carePlan.ts` makes
 * about the growing media. `MAX_BODY_BYTES` lives in `server/index.ts`, and the
 * Dockerfile does not copy `src/` into the image, so there is no import that
 * could join them. The rule is that this number must never EXCEED the server's;
 * being under it is safe, being over it puts back the exact bug above.
 */
export const SERVER_MAX_BODY_BYTES = 12 * 1024 * 1024;

/*
 * The JSON envelope around the image: `{"imageBase64":"...","lang":"en"}` plus
 * room for a longer key set later. Tiny next to the photo, but the comparison
 * should be against what is actually sent, not against the image alone.
 */
const ENVELOPE_BYTES = 256;

/* Base64 is 4 bytes of payload for every 3 bytes of file. */
export const MAX_PHOTO_BYTES = Math.floor(((SERVER_MAX_BODY_BYTES - ENVELOPE_BYTES) * 3) / 4);

/*
 * Takes the ENCODED length, because that is what goes on the wire and it is
 * the number the caller already has - re-deriving the file size from it would
 * be guessing at padding.
 */
export function exceedsUploadLimit(base64Length: number): boolean {
  return base64Length + ENVELOPE_BYTES > SERVER_MAX_BODY_BYTES;
}

/*
 * For the copy: "8.4 MB".
 *
 * Rounded UP, not to nearest. A photo 40 KB over a 12 MB limit rounds to
 * "12.0 MB" either way at one decimal, and "that image is 12.0 MB and the
 * limit is 12.0 MB" reads as a bug in the app rather than a reason to retake
 * the shot. Rounding up cannot produce that sentence, and it can never
 * understate a size the user is being asked to reduce.
 */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${(Math.ceil(mb * 10) / 10).toFixed(1)} MB`;
}
