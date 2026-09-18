import Storage from 'expo-sqlite/kv-store';
import { createAvatarCache, type AvatarSnapshot } from './avatarCache';
import { avatarMirror } from '../media/photoMirror';
import { getProfile, updateProfile, type Profile } from '../auth/auth';
import {
  uploadAvatar,
  deleteAvatarObject,
  signAvatar,
  clearAvatarUrlCache,
} from '../auth/avatarStorage';
import { DEFAULT_FOCUS_Y, DEFAULT_ZOOM } from '../../lib/media/photoFocus';
import { supabase } from '../auth/supabase';

/*
 * The account's picture, as the screens need it.
 *
 * Three things have to agree for a face to appear instantly and stay correct:
 * the local snapshot (so the first frame has something to draw), the on-disk
 * mirror (so that something is a file rather than an expired signed url), and
 * the profile row (which is the truth, and is a network call away). This module
 * is where they are kept in step, so that Settings, the dashboard greeting and
 * the portfolio masthead are three views of one fact rather than three
 * independent fetches.
 *
 * Deliberately module-level rather than React context. The avatar is read by
 * screens in different navigators that never share a provider, and a context
 * spanning them would have to sit above the whole app to serve a 28pt circle.
 */

const cache = createAvatarCache({
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
});

const listeners = new Set<() => void>();

/*
 * The rendered value, rebuilt only when something changes.
 *
 * Held rather than computed per call because `current()` is a
 * `useSyncExternalStore` snapshot: returning a fresh object each time would
 * re-render every screen holding an avatar, forever.
 */
export interface AvatarView {
  /* A local file when one has been mirrored, a signed url until then. */
  uri: string;
  focusY: number;
  zoom: number;
}

let view: AvatarView | null = null;
/* The signed url for the current path, held only in memory - it is a
 * short-lived capability and has no business on disk. */
let signedUrl: string | null = null;
let userId: string | null = null;
let refreshing: Promise<void> | null = null;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* one bad subscriber must not stop the others being told */
    }
  }
}

function rebuild(): void {
  const snapshot = cache.get();
  if (!snapshot || !userId) {
    const had = view !== null;
    view = null;
    if (had) notify();
    return;
  }

  const local = avatarMirror.localFor(userId);
  const uri = local ?? signedUrl;
  if (!uri) {
    const had = view !== null;
    view = null;
    if (had) notify();
    return;
  }

  const same =
    view !== null &&
    view.uri === uri &&
    view.focusY === snapshot.focusY &&
    view.zoom === snapshot.zoom;
  if (same) return;

  view = { uri, focusY: snapshot.focusY, zoom: snapshot.zoom };
  notify();
}

/* Synchronous, stable, safe to call during render. */
export function current(): AvatarView | null {
  return view;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* The framing to open the editor with, even when there is no picture yet. */
export function framing(): { focusY: number; zoom: number } {
  const snapshot = cache.get();
  return {
    focusY: snapshot?.focusY ?? DEFAULT_FOCUS_Y,
    zoom: snapshot?.zoom ?? DEFAULT_ZOOM,
  };
}

/*
 * Take a freshly-read profile as the truth and bring everything else into line.
 *
 * Also the only place the mirror is asked to fetch: it needs a signed url, and
 * this is the moment one exists.
 */
export function hydrate(profile: Profile | null): void {
  if (!profile) {
    signedUrl = null;
    cache.put(null);
    rebuild();
    return;
  }

  userId = profile.id;
  signedUrl = profile.avatar_url;

  const next: AvatarSnapshot | null = profile.avatar_path
    ? { path: profile.avatar_path, focusY: profile.avatar_focus_y, zoom: profile.avatar_zoom }
    : null;
  cache.put(next);

  if (profile.avatar_path && profile.avatar_url) {
    /*
     * Mirrored under the USER id, not the object path: there is one avatar per
     * account, and keying on the path would leave every superseded picture on
     * the phone forever with nothing able to name them for deletion.
     */
    void avatarMirror
      .ensure([{ id: profile.id, photoUri: profile.avatar_url }])
      .then((landed) => {
        if (landed > 0) rebuild();
      });
  }

  rebuild();
}

/*
 * Ask the server, then hydrate. Safe to call from several screens at once - the
 * in-flight promise is shared, so three mounted avatars are one request.
 */
export async function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      hydrate(await getProfile());
    } catch {
      /* Keep whatever the snapshot already holds. A profile we could not read
       * is not a reason to blank a face that is already on screen. */
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface SetAvatarResult {
  ok: boolean;
}

/*
 * Replace the picture, its framing, or both.
 *
 * ORDER MATTERS AND IS NOT THE OBVIOUS ONE. Upload first, repoint the row
 * second, delete the old object last. Deleting first would mean a failed upload
 * leaves an account whose picture is gone and unrecoverable; this way the worst
 * case is an orphaned object in a bucket that `delete_own_account` clears
 * anyway.
 */
export async function setAvatar(
  sourceUri: string | null,
  focusY: number,
  zoom: number
): Promise<SetAvatarResult> {
  const previous = cache.get();

  try {
    /* Framing only - the picture is unchanged, so nothing is uploaded and
     * nothing is deleted. This is the common edit. */
    if (sourceUri === null) {
      if (!previous) return { ok: false };
      const profile = await updateProfile({ avatar_focus_y: focusY, avatar_zoom: zoom });
      hydrate(profile);
      return { ok: true };
    }

    if (!userId) {
      const profile = await getProfile();
      if (!profile) return { ok: false };
      userId = profile.id;
    }

    const path = await uploadAvatar(userId, sourceUri);
    if (!path) return { ok: false };

    const profile = await updateProfile({
      avatar_path: path,
      avatar_focus_y: focusY,
      avatar_zoom: zoom,
    });

    /*
     * The mirror is keyed on the user, so the file already on disk is the OLD
     * picture under exactly the right name. Dropping it before hydrating is
     * what stops the new avatar rendering as the previous one.
     */
    avatarMirror.discard(userId);
    hydrate(profile);

    if (previous?.path && previous.path !== path) void deleteAvatarObject(previous.path);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function removeAvatar(): Promise<SetAvatarResult> {
  const previous = cache.get();
  try {
    const profile = await updateProfile({ avatar_path: null });
    if (userId) avatarMirror.discard(userId);
    signedUrl = null;
    hydrate(profile);
    if (previous?.path) void deleteAvatarObject(previous.path);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* Sign-out and account deletion. */
export function clear(): void {
  cache.clear();
  avatarMirror.clear();
  clearAvatarUrlCache();
  signedUrl = null;
  userId = null;
  view = null;
  notify();
}

/* Re-signing, for a url that expired while the app was open and before the
 * mirror had the file. Rare; the mirror normally makes it moot. */
export async function resign(): Promise<void> {
  const snapshot = cache.get();
  if (!snapshot || !userId || avatarMirror.localFor(userId)) return;
  signedUrl = await signAvatar(snapshot.path);
  rebuild();
}

/*
 * Forget everything when the session ends.
 *
 * Driven off the auth listener rather than called from `signOut`, because
 * `auth.ts` cannot import this module - this one already imports IT, for
 * getProfile and updateProfile, and the pair would be a cycle. The listener is
 * also the stronger guarantee: it fires for a session that expired or was
 * revoked elsewhere, neither of which goes through the sign-out button.
 *
 * A new user id on SIGNED_IN is taken as the start of a different account, and
 * the previous one's face must not survive into it on a shared device.
 */
supabase.auth.onAuthStateChange((_event, session) => {
  const nextId = session?.user.id ?? null;
  if (nextId === userId) return;
  clear();
  userId = nextId;
  if (nextId) void refresh();
});
