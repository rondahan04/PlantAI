import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCoords,
  resetCoordsCache,
  FALLBACK_LAT,
  FALLBACK_LNG,
  type LocationDeps,
} from '../lib/location.ts';

/*
 * The fallback path is the one that matters and the one a device can never
 * exercise on demand - you cannot un-grant a permission from a test. Hence the
 * injected deps.
 */

const granted = (lat: number, lng: number): LocationDeps => ({
  requestPermission: async () => ({ status: 'granted' }),
  getPosition: async () => ({ coords: { latitude: lat, longitude: lng } }),
});

test('granted permission returns the device position', async () => {
  resetCoordsCache();
  assert.deepEqual(await resolveCoords(granted(32.0853, 34.7818)), {
    lat: 32.0853,
    lng: 34.7818,
  });
});

test('denied permission falls back instead of rejecting', async () => {
  // A nursery search from the city centre still answers the question; failing
  // the whole feature on a permission dialog would not.
  resetCoordsCache();
  const denied: LocationDeps = {
    requestPermission: async () => ({ status: 'denied' }),
    getPosition: async () => {
      throw new Error('should not be asked');
    },
  };
  assert.deepEqual(await resolveCoords(denied), { lat: FALLBACK_LAT, lng: FALLBACK_LNG });
});

test('a GPS failure after a granted permission also falls back', async () => {
  resetCoordsCache();
  const broken: LocationDeps = {
    requestPermission: async () => ({ status: 'granted' }),
    getPosition: async () => {
      throw new Error('location unavailable');
    },
  };
  assert.deepEqual(await resolveCoords(broken), { lat: FALLBACK_LAT, lng: FALLBACK_LNG });
});

test('the memo spares the second and third caller a permission round-trip', async () => {
  resetCoordsCache();
  let calls = 0;
  const counting: LocationDeps = {
    requestPermission: async () => {
      calls += 1;
      return { status: 'granted' };
    },
    getPosition: async () => ({ coords: { latitude: 1, longitude: 2 } }),
  };

  const clock = () => 1_000_000;
  await resolveCoords(counting, clock);
  await resolveCoords(counting, clock);
  await resolveCoords(counting, clock);
  assert.equal(calls, 1, 'three screens, one GPS fix');
});

test('the memo expires so a moved user is not pinned to an old fix', async () => {
  resetCoordsCache();
  let calls = 0;
  const counting: LocationDeps = {
    requestPermission: async () => {
      calls += 1;
      return { status: 'granted' };
    },
    getPosition: async () => ({ coords: { latitude: 1, longitude: 2 } }),
  };

  let t = 1_000_000;
  await resolveCoords(counting, () => t);
  t += 6 * 60 * 1000;
  await resolveCoords(counting, () => t);
  assert.equal(calls, 2);
});
