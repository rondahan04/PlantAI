import { Nursery } from '../types';

const NURSERY_NAMES = [
  'GreenLeaf Garden Center',
  'The Plant Loft',
  'Urban Roots Nursery',
  'Bloom & Grow',
  'The Potting Shed',
  'Leafy Paradise',
  'Roots & Branches',
  'Garden & Grace',
];

const STREET_NAMES = [
  'Oak Street',
  'Maple Avenue',
  'Garden Boulevard',
  'Cedar Lane',
  'Willow Drive',
  'Rose Street',
  'Elm Avenue',
];

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

export function generateNearbyNurseries(
  plantName: string,
  userLat: number = 32.0853,
  userLon: number = 34.7818
): Nursery[] {
  const count = randomInt(4, 6);
  const nurseries: Nursery[] = [];

  for (let i = 0; i < count; i++) {
    const distanceKm = parseFloat(randomBetween(0.3, 8).toFixed(1));
    const distanceStr =
      distanceKm < 1
        ? `${Math.round(distanceKm * 1000)}m`
        : `${distanceKm.toFixed(1)} km`;

    const rating = parseFloat(randomBetween(3.8, 5.0).toFixed(1));
    const reviewCount = randomInt(24, 312);
    const streetNum = randomInt(1, 200);
    const streetName =
      STREET_NAMES[randomInt(0, STREET_NAMES.length - 1)];
    const name = NURSERY_NAMES[i % NURSERY_NAMES.length];

    const price = randomBetween(29, 89);
    const priceStr = `$${price.toFixed(0)}`;

    const deliveryFee = randomBetween(4.99, 12.99);
    const deliveryTime = `${randomInt(1, 4)}–${randomInt(5, 8)} hrs`;

    const latOffset = (distanceKm / 111) * (Math.random() > 0.5 ? 1 : -1);
    const lonOffset =
      (distanceKm / (111 * Math.cos((userLat * Math.PI) / 180))) *
      (Math.random() > 0.5 ? 1 : -1);

    const openHour = randomInt(7, 9);
    const closeHour = randomInt(17, 20);

    nurseries.push({
      id: `nursery-${i}`,
      name,
      distance: distanceStr,
      distanceKm,
      rating,
      reviewCount,
      address: `${streetNum} ${streetName}`,
      hasPlant: true,
      plantPrice: priceStr,
      deliveryAvailable: Math.random() > 0.25,
      deliveryTime,
      deliveryFee: `$${deliveryFee.toFixed(2)}`,
      pickupAvailable: true,
      hours: `${openHour}:00 AM – ${closeHour > 12 ? closeHour - 12 : closeHour}:00 ${closeHour >= 12 ? 'PM' : 'AM'}`,
      phone: `+1 (${randomInt(200, 999)}) ${randomInt(100, 999)}-${randomInt(1000, 9999)}`,
      image: `https://picsum.photos/seed/${name.replace(/\s/g, '')}/400/300`,
      latitude: userLat + latOffset,
      longitude: userLon + lonOffset,
    });
  }

  return nurseries.sort((a, b) => a.distanceKm - b.distanceKm);
}
