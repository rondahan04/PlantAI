import * as Location from 'expo-location';

/*
 * Where "near me" resolves to, for every screen that starts a nursery scrape.
 *
 * Shared rather than duplicated per screen: the fallback point and the
 * permission handling are the same decision everywhere, and a second copy
 * would drift the moment one screen's fallback is corrected.
 */

/* Tel Aviv / Herzliya centre - used when permission is denied or GPS fails. */
export const FALLBACK_LAT = 32.1624;
export const FALLBACK_LNG = 34.8443;

export async function resolveCoords(): Promise<{ lat: number; lng: number }> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    }
  } catch {
    // fall through to the fallback - a scrape at an approximate point is far
    // better than no scrape at all.
  }
  return { lat: FALLBACK_LAT, lng: FALLBACK_LNG };
}
