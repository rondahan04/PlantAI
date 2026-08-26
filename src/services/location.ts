/**
 * Binds the pure coords resolver in `src/lib/location.ts` to expo-location.
 *
 * Same split as plantStore -> plantLibrary and photoStore -> photos: the logic
 * is testable without a device, and this file is the only thing that imports
 * the native module.
 */

import * as Location from 'expo-location';
import { resolveCoords as resolvePure, type Coords, type LocationDeps } from '../lib/location';

const deviceDeps: LocationDeps = {
  requestPermission: () => Location.requestForegroundPermissionsAsync(),
  getPosition: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
};

/* Never rejects - see the note in lib/location.ts. */
export function resolveCoords(): Promise<Coords> {
  return resolvePure(deviceDeps);
}

export { resetCoordsCache, FALLBACK_LAT, FALLBACK_LNG, type Coords } from '../lib/location';
