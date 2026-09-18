import { supabase } from './supabase';
import { plantRepo } from '../plants/plantRepoInstance';
import { clearSignedUrlCache } from '../plants/supabasePlantCloud';
import { plantPhotoMirror } from '../media/photoMirror';
import { photoSizes } from '../media/photoSizes';
import { signAvatar, clearAvatarUrlCache } from './avatarStorage';
import { isUniqueViolation } from '../../lib/authErrors';
import type { Session } from '@supabase/supabase-js';

/*
 * Auth service (issue #1, Epic 1). Accounts are opt-in - nothing here runs
 * unless the user chooses Login/Signup/Settings; diagnosis and Home never
 * call into this file.
 *
 * Username uniqueness is enforced by the DB (profiles.username unique
 * constraint, supabase/migrations/20260822000000_auth_profiles.sql) and
 * surfaced here as a typed error rather than a raw Postgres message - the
 * signup trigger runs inside the same transaction as auth.signUp, so a
 * duplicate username fails the whole signup atomically (no orphaned
 * auth.users row).
 */

export class DuplicateUsernameError extends Error {
  constructor() {
    super('DUPLICATE_USERNAME');
    this.name = 'DuplicateUsernameError';
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('DUPLICATE_EMAIL');
    this.name = 'DuplicateEmailError';
  }
}

export class AuthServiceError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super('AUTH_SERVICE_ERROR');
    this.name = 'AuthServiceError';
    this.detail = detail;
    console.warn(`[auth] ${detail}`);
  }
}

export async function signUp(opts: {
  email: string;
  password: string;
  username: string;
  fullName: string;
}): Promise<Session> {
  const { email, password, username, fullName } = opts;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username, full_name: fullName } },
  });

  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new DuplicateEmailError();
    if (isUniqueViolation(error.message)) throw new DuplicateUsernameError();
    throw new AuthServiceError(error.message);
  }
  if (!data.session) throw new AuthServiceError('signup succeeded but no session returned');
  return data.session;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AuthServiceError(error.message);
  if (!data.session) throw new AuthServiceError('login succeeded but no session returned');
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new AuthServiceError(error.message);
  // The mirror is a cache of the account being signed out of - it must not
  // leak into a next login on a shared device.
  plantRepo.wipeMirror();
  /* A signed URL is a live read capability on a private bucket. Keeping one
   * after sign-out leaves a reader for an account nobody is signed into. */
  clearSignedUrlCache();
  /* Same rule one level down: the mirror holds the actual photographs of the
   * account being signed out of, as plain files on a shared device. It is also
   * indexed by plant id, so leaving it would let the NEXT account's ids collide
   * with the previous one's pictures. */
  plantPhotoMirror.clear();
  /* And the measurements taken from them, which are a list of that account's
   * object paths. Not secret, but there is no reason for them to outlive it. */
  photoSizes.clear();
  clearAvatarUrlCache();
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'plantai://reset-password',
  });
  if (error) throw new AuthServiceError(error.message);
}

/*
 * Called from ResetConfirmScreen after the deep link handed us an active
 * recovery session (supabase-js parses the token from the link internally
 * when the app opens via the plantai://reset-password scheme).
 */
export async function confirmPasswordReset(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthServiceError(error.message);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const email = sessionData.session?.user.email;
  if (!email) throw new AuthServiceError('no active session');

  // Re-verify the current password before allowing a change - a stale/
  // hijacked session shouldn't be enough on its own to lock the real owner
  // out.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (reauthError) throw new AuthServiceError('current password incorrect');

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthServiceError(error.message);
}

/*
 * Self-delete via the delete_own_account() RPC (SECURITY DEFINER, see the
 * migration) - the client holds no service-role key, so it can never call
 * the Supabase admin delete-user API directly. The function only ever
 * deletes auth.uid()'s own row; there is no user id to spoof.
 *
 * Storage cleanup happens here, client-side, via the Storage API - Supabase
 * rejects direct `delete from storage.objects` even from a SECURITY DEFINER
 * function (see the 2026-08-24 migration), so the RPC no longer attempts it.
 * A failure to clear photos is not fatal to account deletion: an orphaned
 * object under a deleted user's folder is unreachable dead weight, not a
 * blocker to the thing the user actually asked for.
 */
/*
 * `list()` returns a single page (100 objects by default), so a user with
 * more plants than that would leave the remainder behind on every delete -
 * dead objects nobody can reach and nothing will ever clean up. Page until
 * the folder is genuinely empty.
 */
const STORAGE_PAGE = 100;

async function purgeUserPhotos(userId: string): Promise<void> {
  for (;;) {
    const { data: files, error } = await supabase.storage
      .from('plant-photos')
      .list(userId, { limit: STORAGE_PAGE });

    if (error) {
      console.warn(`[auth] could not list photos for deletion: ${error.message}`);
      return;
    }
    if (!files || files.length === 0) return;

    const { error: removeError } = await supabase.storage
      .from('plant-photos')
      .remove(files.map((f) => `${userId}/${f.name}`));

    if (removeError) {
      console.warn(`[auth] could not remove photos: ${removeError.message}`);
      return;
    }
    // A short page means the folder is now drained; anything else would spin
    // forever if a delete silently no-ops.
    if (files.length < STORAGE_PAGE) return;
  }
}

export async function deleteAccount(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (userId) await purgeUserPhotos(userId);

  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw new AuthServiceError(error.message);
  await supabase.auth.signOut();
  // Everything local, not just the mirror - see `wipeAllLocal`. Home shows
  // guest and cloud plants as one list, so a survivor of either key reads as
  // the app ignoring the deletion the user just confirmed.
  plantRepo.wipeAllLocal();
  clearSignedUrlCache();
  plantPhotoMirror.clear();
  photoSizes.clear();
  clearAvatarUrlCache();
}

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  bio: string | null;
  /*
   * The storage OBJECT PATH, which is the durable fact, and a signed URL for
   * it, which is not. The path is what identifies the picture across
   * re-signings - it is the avatar's cache key and the mirror's filename - so
   * both travel together rather than the URL alone.
   */
  avatar_path: string | null;
  avatar_url: string | null;
  avatar_focus_y: number;
  avatar_zoom: number;
}

/*
 * The columns every read of a profile asks for, in one place - a select list
 * that drifts between the read and the write is how a screen ends up rendering
 * `undefined` for a field the other call site knows about.
 */
const PROFILE_COLUMNS = 'id, username, full_name, bio, avatar_path, avatar_focus_y, avatar_zoom';

/*
 * A row as stored, turned into a profile the app can render.
 *
 * The bucket is private, so `avatar_path` is not something <Image> can draw -
 * it has to be exchanged for a signed URL first, exactly as a plant's photo
 * path is. A failure to sign is deliberately not fatal: the rest of the
 * profile is still correct and still worth showing, and the avatar falls back
 * to its placeholder rather than taking the whole settings screen down.
 */
async function withAvatarUrl(row: ProfileRow): Promise<Profile> {
  const url = row.avatar_path ? await signAvatar(row.avatar_path) : null;
  return { ...row, avatar_url: url };
}

type ProfileRow = Omit<Profile, 'avatar_url'>;

export async function getProfile(): Promise<Profile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single();
  if (error) throw new AuthServiceError(error.message);
  return withAvatarUrl(data as ProfileRow);
}

export async function updateProfile(patch: {
  username?: string;
  full_name?: string;
  bio?: string;
  avatar_path?: string | null;
  avatar_focus_y?: number;
  avatar_zoom?: number;
}): Promise<Profile> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new AuthServiceError('no active session');

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error.message)) throw new DuplicateUsernameError();
    throw new AuthServiceError(error.message);
  }
  return withAvatarUrl(data as ProfileRow);
}
