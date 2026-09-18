import { useCallback, useSyncExternalStore } from 'react';
import { plantPhotoMirror } from '../services/media/photoMirror';

/*
 * Which URI to actually draw for a plant's photograph.
 *
 * A logged-in plant's `photoUri` is a SIGNED url that expires in an hour, and
 * on a cold start the one the library paints from is already expired (see
 * `photoMirrorStore`). Once the photo has been mirrored to the phone there is a
 * `file://` copy that never expires, is never evicted, needs no network and -
 * unlike a re-signed url - can be prefetched. This hook prefers it.
 *
 * WHY A SUBSCRIPTION AND NOT A PLAIN LOOKUP. The mirror fills in behind an
 * already-painted screen. A plain read would return the remote url on first
 * render and never look again, so on a first launch after install every photo
 * would spend the whole session on the slow path even though its local copy
 * landed seconds in. `useSyncExternalStore` swaps them over the moment the
 * download commits, with no reload of the library and no flicker - expo-image
 * is showing the same picture either way.
 *
 * Falls back to `photoUri` unchanged, which is what guest plants (already local
 * files) and not-yet-mirrored cloud plants get. Nothing regresses if the mirror
 * never manages to write anything at all.
 */
export function usePlantPhoto(plantId: string | undefined, photoUri: string): string {
  /*
   * The snapshot must be referentially stable between notifications or React
   * re-renders forever: `localFor` returns the string held in the mirror's
   * index, not a newly built one, so repeated calls return the same reference.
   */
  const snapshot = useCallback(
    () => (plantId ? plantPhotoMirror.localFor(plantId) : undefined),
    [plantId]
  );
  const local = useSyncExternalStore(plantPhotoMirror.subscribe, snapshot, snapshot);
  return local ?? photoUri;
}
