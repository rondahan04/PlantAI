import { createPlantRepo } from './plantRepo';
import { plantLibrary } from './plantLibrary';
import { cloudMirror } from './cloudMirror';
import { supabasePlantCloud } from './supabasePlantCloud';
import { getSessionHint } from './sessionHint';
import { supabase } from './supabase';

/*
 * `getUserId` reads whatever Supabase currently has cached in memory from the
 * last auth event - `supabase.auth.getSession()` is async and there is no
 * public synchronous accessor, so this tracks the id via the auth state
 * listener instead. Screens never call `getUserId` directly; only
 * `plantRepo`'s async methods do, after `getSessionHint()` has already gated
 * on there being a session at all.
 */
let cachedUserId: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user.id ?? null;
});

export const plantRepo = createPlantRepo({
  guest: plantLibrary,
  mirror: cloudMirror,
  cloud: supabasePlantCloud,
  getSessionHint,
  getUserId: () => cachedUserId,
});
