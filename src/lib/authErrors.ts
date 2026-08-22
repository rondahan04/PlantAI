/*
 * Pure, no imports - kept out of services/auth.ts so this can be unit
 * tested under plain `node --test` without pulling in the Supabase client's
 * React Native chain (AsyncStorage, url-polyfill).
 */
export function isUniqueViolation(message: string): boolean {
  // Postgres unique_violation (23505) message text for our constraint name.
  return /profiles_username_key|duplicate key value/i.test(message);
}
