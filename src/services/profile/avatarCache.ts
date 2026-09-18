import { clampFocusY, clampZoom, DEFAULT_FOCUS_Y, DEFAULT_ZOOM } from '../../lib/media/photoFocus.ts';

/*
 * The account's picture, remembered on this device.
 *
 * WHY THIS IS NOT JUST READ FROM THE PROFILE. `getProfile` is a network call.
 * The avatar is drawn on the dashboard greeting and the portfolio masthead -
 * the first two screens the app paints - so waiting for that call means every
 * launch shows the empty placeholder for a beat and then pops a face in. The
 * same objection the plant library answered with a synchronous local read, and
 * the same answer here.
 *
 * WHAT IS STORED IS THE PATH, NOT THE URL. The bucket is private, so a
 * renderable URL is a signed one, and a signed URL is a short-lived capability
 * to read a private object - persisting it would leave a bucket-reading
 * credential on disk long after the app forgot why. The path is the durable
 * fact: it identifies the object across every re-signing, it is the mirror's
 * filename, and it is the image cache's key.
 *
 * Pure, with a storage seam, so `node --test` can cover the validation without
 * an Expo runtime.
 */

export const AVATAR_CACHE_KEY = 'plantai.avatar.v1';

export interface AvatarSnapshot {
  /* Storage object path, e.g. `<uid>/lq3f8x2a.jpg`. */
  path: string;
  focusY: number;
  zoom: number;
}

export interface AvatarCacheDeps {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/*
 * Parse the stored blob.
 *
 * The framing is CLAMPED rather than rejected. A path is the identity of a
 * picture and a wrong one means the wrong image, so a bad path throws the whole
 * snapshot away; a framing is a preference, and a value slightly outside the
 * range should show the picture at the nearest sane crop rather than lose it.
 */
export function parseAvatar(raw: string | null): AvatarSnapshot | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const { path, focusY, zoom } = parsed as Record<string, unknown>;
  if (typeof path !== 'string' || path.trim().length === 0) return null;

  return {
    path: path.trim(),
    focusY: typeof focusY === 'number' ? clampFocusY(focusY) : DEFAULT_FOCUS_Y,
    zoom: typeof zoom === 'number' ? clampZoom(zoom) : DEFAULT_ZOOM,
  };
}

export function createAvatarCache(deps: AvatarCacheDeps) {
  /* Read once, held, written through - `get` is called during render. */
  let snapshot: AvatarSnapshot | null | undefined;

  function get(): AvatarSnapshot | null {
    if (snapshot !== undefined) return snapshot;
    let raw: string | null;
    try {
      raw = deps.getItem(AVATAR_CACHE_KEY);
    } catch {
      raw = null;
    }
    snapshot = parseAvatar(raw);
    return snapshot;
  }

  /*
   * Returns whether anything actually changed, so a caller can skip telling
   * subscribers about a refresh that found the picture exactly as it left it -
   * which is every refresh but the first after a change.
   */
  function put(next: AvatarSnapshot | null): boolean {
    const current = get();
    const same =
      (current === null && next === null) ||
      (current !== null &&
        next !== null &&
        current.path === next.path &&
        current.focusY === next.focusY &&
        current.zoom === next.zoom);
    if (same) return false;

    if (next === null) {
      snapshot = null;
      try {
        deps.removeItem(AVATAR_CACHE_KEY);
      } catch {
        /* a cache we could not clear is re-read and corrected on the next
         * refresh; not worth failing a sign-out over */
      }
      return true;
    }

    const cleaned: AvatarSnapshot = {
      path: next.path,
      focusY: clampFocusY(next.focusY),
      zoom: clampZoom(next.zoom),
    };
    snapshot = cleaned;
    try {
      deps.setItem(AVATAR_CACHE_KEY, JSON.stringify(cleaned));
    } catch {
      /* held in memory for this session either way */
    }
    return true;
  }

  /* Sign-out and account deletion. Another account's face must not be sitting
   * in the greeting when the next person signs in on a shared device. */
  function clear(): void {
    put(null);
  }

  return { get, put, clear };
}
