import { supabase } from './supabase';
import { plantRepo } from './plantRepoInstance';
import { isUniqueViolation } from '../lib/authErrors';
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
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw new AuthServiceError(error.message);
  await supabase.auth.signOut();
  plantRepo.wipeMirror();
}

export interface Profile {
  id: string;
  username: string;
  full_name: string | null;
  bio: string | null;
}

export async function getProfile(): Promise<Profile | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, bio')
    .eq('id', userId)
    .single();
  if (error) throw new AuthServiceError(error.message);
  return data;
}

export async function updateProfile(patch: {
  username?: string;
  full_name?: string;
  bio?: string;
}): Promise<Profile> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new AuthServiceError('no active session');

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('id, username, full_name, bio')
    .single();

  if (error) {
    if (isUniqueViolation(error.message)) throw new DuplicateUsernameError();
    throw new AuthServiceError(error.message);
  }
  return data;
}
