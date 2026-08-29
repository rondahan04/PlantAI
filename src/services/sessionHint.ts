import Storage from 'expo-sqlite/kv-store';

/*
 * A synchronous "was a session active as of the last auth event" flag.
 *
 * Supabase's real session lives behind `AsyncStorage` and is only knowable
 * asynchronously (`supabase.auth.getSession()`), which is fine for Login/
 * Settings but not for Home: D8 requires knowing which local key to read
 * (guest vs. cloud-mirror) during the FIRST render, the same constraint that
 * made `plantLibrary` and `onboarding` synchronous. `useSession` (a later
 * task) keeps this in sync with every auth state change; it is a hint, not
 * the source of truth - `getSession()` is still asked once per mount to
 * correct a stale flag (e.g. a session that expired while the app was
 * closed).
 */

const KEY = 'plantai.sessionHint';

export function getSessionHint(): boolean {
  return Storage.getItemSync(KEY) === '1';
}

export function setSessionHint(active: boolean): void {
  if (active) {
    Storage.setItemSync(KEY, '1');
  } else {
    Storage.removeItemSync(KEY);
  }
}
