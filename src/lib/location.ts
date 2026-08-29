/**
 * Where the user is, for nursery search.
 *
 * Lifted out of DiagnosisScreen, which owned the only copy. Three screens now
 * need it - diagnosis, a saved plant, and the search tab - and three private
 * copies of a fallback coordinate is how they drift apart.
 *
 * Pure by requirement, like plantStore: importing expo-location here would make
 * the module unloadable under bare `node --test`. The device binding lives in
 * services/location.ts, mirroring plantStore -> plantLibrary.
 *
 * Never rejects. A denied permission is not an error the user has to handle: a
 * nursery search from the middle of Tel Aviv is still a useful answer, and
 * blocking the whole feature on a permission dialog would be worse than being
 * slightly wrong about where they are.
 */

export interface Coords {
  lat: number;
  lng: number;
}

/* Tel Aviv center. Used when permission is denied or GPS is unavailable. */
export const FALLBACK_LAT = 32.1624;
export const FALLBACK_LNG = 34.8443;

/*
 * The seam that makes this testable under bare `node --test`, mirroring
 * `StorageDeps` in plantStore and `PipelineDeps` in the scraper. Without it the
 * fallback logic could only be exercised on a device with the permission
 * actually denied, which is to say never.
 */
export interface LocationDeps {
  requestPermission(): Promise<{ status: string }>;
  getPosition(): Promise<{ coords: { latitude: number; longitude: number } }>;
}

/*
 * Resolving costs a permission round-trip and a GPS fix, and all three callers
 * may ask within seconds of each other. A short memo keeps that to one. Five
 * minutes because nursery results are ranked by distance in kilometres - moving
 * far enough to change the answer takes longer than that.
 */
const MEMO_MS = 5 * 60 * 1000;
let memo: { at: number; coords: Coords } | null = null;

export async function resolveCoords(
  deps: LocationDeps,
  now: () => number = Date.now
): Promise<Coords> {
  if (memo && now() - memo.at < MEMO_MS) return memo.coords;

  let coords: Coords = { lat: FALLBACK_LAT, lng: FALLBACK_LNG };
  try {
    const { status } = await deps.requestPermission();
    if (status === 'granted') {
      const loc = await deps.getPosition();
      coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    }
  } catch {
    /* fall through to the fallback - see the note at the top */
  }

  memo = { at: now(), coords };
  return coords;
}

/* Tests, and anywhere a fresh fix genuinely matters. */
export function resetCoordsCache(): void {
  memo = null;
}
