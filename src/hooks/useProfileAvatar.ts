import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { current, subscribe, refresh, type AvatarView } from '../services/profile/avatar';
import { getSessionHint } from '../services/auth/sessionHint';

/*
 * The account's picture, for any screen that draws it.
 *
 * `current()` is synchronous and returns the held object, so the first frame
 * has a face on it when one is known - the dashboard greeting and the portfolio
 * masthead both paint before any network call could finish, and an avatar that
 * pops in a beat later is worse than one that was never promised.
 *
 * The refresh is fired once per mount and deduplicated in the service, so three
 * avatars on screen are one request. Guarded on the session hint: a guest has no
 * profile to fetch, and asking for one on every mount is a guaranteed round trip
 * to a guaranteed null.
 */
export function useProfileAvatar(): AvatarView | null {
  const avatar = useSyncExternalStore(subscribe, current, current);

  useEffect(() => {
    if (getSessionHint()) void refresh();
  }, []);

  return avatar;
}
