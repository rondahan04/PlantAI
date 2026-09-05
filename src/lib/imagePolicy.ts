/*
 * How big a plant photo should be once it is ours.
 *
 * WHY. A photo enters the app at whatever size the camera or the library hands
 * over, and every later cost is set at that moment: the bytes uploaded for a
 * diagnosis, the bytes written to the documents directory, the bytes pushed to
 * the user's private bucket, and the bitmap decoded every time the photo is
 * drawn. A full-resolution gallery pick has already broken one of those - it
 * exceeded the server's 12MB body cap in production and surfaced to the user
 * as a lost network connection.
 *
 * Downscaling was deliberately skipped in August because it needs a native
 * dependency and a rebuild. That reasoning stops applying the moment a rebuild
 * is happening anyway.
 *
 * This module holds only the DECISION, so it can be tested without the native
 * module: whether to resize, and to what. The resizing itself lives in
 * services/imageResize.ts.
 */

/*
 * The long edge we keep. Chosen against what actually consumes these photos:
 * PlantNet identifies from leaf and stem shape and wants detail but not
 * megapixels, and the largest a photo is ever DRAWN is a full-width hero on a
 * 3x phone - roughly 1300px. 1600 leaves headroom above both without carrying
 * a 12MP file around for the rest of the plant's life.
 */
export const MAX_EDGE_PX = 1600;

export interface ResizePlan {
  /* Pass to the manipulator. Height is null so aspect ratio is preserved. */
  width: number;
  height: null;
}

/*
 * Null means "leave it alone", and that is the common case for a camera
 * capture, which already arrives compressed at quality 0.7.
 *
 * Never UPSCALES. A small photo blown up to 1600 would be bigger on disk, no
 * better to look at, and would quietly turn the one cheap case into an
 * expensive one.
 *
 * Unknown dimensions (0, negative, NaN - a picker that did not report them)
 * also return null: resizing on a guess risks mangling a photo, and the size
 * guard downstream still catches anything genuinely too large to send.
 */
export function resizePlan(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE_PX
): ResizePlan | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return null;

  /*
   * The manipulator takes a target WIDTH, so a portrait photo - which is most
   * plant photos - has to have its width derived from the height it is being
   * capped to, or the cap silently applies to the wrong edge and a tall image
   * stays enormous.
   */
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: null };
}
