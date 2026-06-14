import { Nursery } from '../types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NURSERIES_DATA = require('../../assets/nurseries.json') as NurseryJSON[];

interface PlantJSON {
  name: string;
  aliases: string[];
  price: string;
  inStock: boolean;
}

interface NurseryJSON {
  nurseryId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  deliveryAvailable: boolean;
  deliveryFee: string;
  deliveryTime: string;
  pickupAvailable: boolean;
  hours: string;
  phone: string;
  rating: number;
  reviewCount: number;
  image: string;
  plants: PlantJSON[];
}

/*
 * Haversine formula — great-circle distance in km.
 *
 *   a = sin²(Δlat/2) + cos(lat1) · cos(lat2) · sin²(Δlng/2)
 *   d = 2R · atan2(√a, √(1−a))
 */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/*
 * Normalize plant name for alias matching:
 * - lowercase
 * - strip pot size qualifiers (6in, 4", medium, large)
 * - trim whitespace
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\d+\s*['"]?\s*(inch|in|cm|gallon|gal|pot|liter|l)\b/gi, '')
    .replace(/\b(small|medium|large|xl|extra\s+large|big)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/*
 * Returns true if the queried plant name matches a nursery plant entry.
 * Matching strategy (in order of precision):
 *   1. Exact normalized match on scientific name or any alias
 *   2. First-word match (genus match: "Monstera" matches "Monstera deliciosa")
 *   3. Query is a substring of a candidate name or vice versa
 *
 * If nothing matches → caller falls back to showing all nurseries (by design).
 */
function plantMatches(queryRaw: string, plant: PlantJSON): boolean {
  const query = normalizeName(queryRaw);
  const queryFirstWord = query.split(/\s+/)[0];

  const candidates = [plant.name, ...plant.aliases].map(normalizeName);

  return candidates.some((c) => {
    const cFirstWord = c.split(/\s+/)[0];
    return (
      c === query ||
      c.includes(query) ||
      query.includes(c) ||
      cFirstWord === queryFirstWord
    );
  });
}

/*
 * Load real nurseries from assets/nurseries.json, compute haversine distance
 * from the user's position, match the diagnosed plant against each nursery's
 * inventory, and sort by: matched nurseries first, then by distance ascending.
 *
 * If no nursery matches the plant name, all nurseries are returned (unfiltered)
 * so the user always sees results rather than an empty screen.
 *
 * @param plantName  Common or scientific name from Plant.id diagnosis
 * @param userLat    User latitude (defaults to Tel Aviv center as demo fallback)
 * @param userLng    User longitude (defaults to Tel Aviv center as demo fallback)
 */
export function loadNearbyNurseries(
  plantName: string,
  userLat: number = 32.0853,
  userLng: number = 34.7818
): Nursery[] {
  const nurseries: Nursery[] = NURSERIES_DATA.map((n: NurseryJSON) => {
    const distanceKm = haversineKm(userLat, userLng, n.lat, n.lng);
    const distanceStr =
      distanceKm < 1
        ? `${Math.round(distanceKm * 1000)}m`
        : `${distanceKm.toFixed(1)} km`;

    const matchedPlant = n.plants.find(
      (p) => plantMatches(plantName, p) && p.inStock
    );

    return {
      id: n.nurseryId,
      name: n.name,
      distance: distanceStr,
      distanceKm,
      rating: n.rating,
      reviewCount: n.reviewCount,
      address: n.address,
      hasPlant: !!matchedPlant,
      plantPrice: matchedPlant?.price ?? n.plants.find((p) => p.inStock)?.price ?? '—',
      deliveryAvailable: n.deliveryAvailable,
      deliveryTime: n.deliveryTime,
      deliveryFee: n.deliveryFee,
      pickupAvailable: n.pickupAvailable,
      hours: n.hours,
      phone: n.phone,
      image: n.image,
      latitude: n.lat,
      longitude: n.lng,
    };
  });

  const anyMatch = nurseries.some((n) => n.hasPlant);

  if (!anyMatch) {
    // No nursery stocks this plant — show all sorted by distance
    console.log(`[nurseryService] No alias match for "${plantName}" — showing all nurseries`);
    return nurseries.sort((a, b) => a.distanceKm - b.distanceKm);
  }

  // Matched nurseries first, then by distance
  return nurseries.sort((a, b) => {
    if (a.hasPlant && !b.hasPlant) return -1;
    if (!a.hasPlant && b.hasPlant) return 1;
    return a.distanceKm - b.distanceKm;
  });
}
