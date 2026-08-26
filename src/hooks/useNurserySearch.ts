/**
 * Search nearby nurseries for a plant, from anywhere.
 *
 * Generalized from DiagnosisScreen's `handleFindReplacement`, which was the
 * only way into the nursery search. Three screens want it now - a fresh
 * diagnosis, a saved plant, and the search tab - and the service beneath has
 * always accepted arbitrary text, so the only thing missing was a way to ask.
 *
 * Keeps the prefetch behaviour that makes the results screen feel fast: the
 * scrape takes 30-90s, so it is started as early as we know what to look for
 * rather than when the user arrives.
 */

import { useCallback, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, DeliveryMode } from '../types';
import { resolveCoords, type Coords } from '../services/location';
import { prefetchNearbyNurseries } from '../services/nurseryService';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function useNurserySearch() {
  const navigation = useNavigation<Nav>();
  const coordsRef = useRef<Coords | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Warm the scrape before the user asks for it. Safe to call on mount: the
   * service caches by plant+location, so the later `search` reuses this rather
   * than paying for a second run.
   */
  const prefetch = useCallback(async (plantName: string) => {
    if (!plantName.trim()) return;
    const coords = await resolveCoords();
    coordsRef.current = coords;
    prefetchNearbyNurseries(plantName, coords.lat, coords.lng);
  }, []);

  const search = useCallback(
    async (plantName: string, mode: DeliveryMode = 'delivery') => {
      const query = plantName.trim();
      if (!query) return;

      // Usually already resolved by a prefetch. If the user was faster than the
      // GPS, resolve now and show the caller something is happening.
      let coords = coordsRef.current;
      if (!coords) {
        setBusy(true);
        try {
          coords = await resolveCoords();
          coordsRef.current = coords;
          prefetchNearbyNurseries(query, coords.lat, coords.lng);
        } finally {
          setBusy(false);
        }
      }

      navigation.navigate('Nurseries', {
        plantName: query,
        lat: coords.lat,
        lng: coords.lng,
        mode,
      });
    },
    [navigation]
  );

  return { busy, search, prefetch };
}
