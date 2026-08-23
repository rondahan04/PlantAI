import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { setSessionHint } from '../services/sessionHint';

/*
 * Resolves the real session asynchronously (there is no synchronous way to
 * read it - Supabase's persisted session lives behind AsyncStorage) and
 * keeps `sessionHint` (the synchronous flag Home's first paint reads)
 * up to date with every change, including sign-out from another screen and
 * token expiry.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionHint(data.session !== null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionHint(next !== null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return session;
}
