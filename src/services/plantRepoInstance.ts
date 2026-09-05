import { createPlantRepo } from './plantRepo';
import { plantLibrary } from './plantLibrary';
import { cloudMirror } from './cloudMirror';
import { supabasePlantCloud } from './supabasePlantCloud';
import { getSessionHint } from './sessionHint';
import { supabase } from './supabase';
import { plantPhotos } from './photos';

/*
 * `getUserId` reads the last user id this module observed from Supabase -
 * seeded once at load via `getSession()` and kept current via the auth
 * listener. `getSessionHint()` (checked before any `getUserId()` call site
 * in `plantRepo.ts`) reflects the LAST auth event, not whether this cache has
 * resolved yet - so there is a brief cold-start window where a genuinely
 * logged-in user's `getUserId()` can still return null and a save/import call
 * reports 'network' rather than actually reaching the network. Calling
 * `getSession()` here at module init (rather than only listening) narrows
 * that window as much as this module can without screens themselves awaiting
 * auth readiness before their first save.
 */
let cachedUserId: string | null = null;
supabase.auth.getSession().then(({ data }) => {
  cachedUserId = data.session?.user.id ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user.id ?? null;
});

export const plantRepo = createPlantRepo({
  guest: plantLibrary,
  mirror: cloudMirror,
  cloud: supabasePlantCloud,
  photos: plantPhotos,
  getSessionHint,
  getUserId: () => cachedUserId,
});
