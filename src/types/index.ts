export interface PlantDiagnosis {
  plantName: string;
  /*
   * Botanical name from PlantNet, e.g. "Rhaphidophora tetrasperma Hook.f.".
   * The server has always returned it; the client type omitted it, so a saved
   * plant used to lose its species. Two ferns can share a common name.
   */
  scientificName: string;
  condition: 'healthy' | 'mild' | 'moderate' | 'severe' | 'critical';
  conditionLabel: string;
  issues: string[];
  treatments: Treatment[];
  canBeSaved: boolean;
  confidence: number;
  description: string;
  /*
   * Ongoing species care — distinct from `treatments`, which fix what is wrong
   * today. Optional because it is advisory server-side (a model that omits it
   * must not fail the diagnosis) and because every plant saved before this
   * field existed has none. Absent means the section is not rendered.
   */
  carePlan?: CarePlan;
}

export interface CarePlan {
  soil: string;
  light: string;
  water: string;
  /*
   * The watering interval as whole days, mirroring the prose in `water`. The
   * reminder is scheduled from this, so it is absent rather than guessed: a
   * plant whose diagnosis carried no number gets the advice without a schedule,
   * never a schedule invented from a sentence.
   */
  waterEveryDays?: number;
  /* Upper end of a range ("every 7-10 days"); absent for a single figure. */
  waterEveryDaysMax?: number;
}

export interface Treatment {
  title: string;
  description: string;
  urgent: boolean;
}

export interface Nursery {
  id: string;
  name: string;
  website: string;
  address: string;
  distance: string; // formatted client-side from distanceKm ('' if unknown)
  distanceKm: number; // Infinity when coordinates are unknown (fallback list)
  hasPlant: boolean; // a real in-stock product was scraped
  inStockKnown: boolean; // exact listing (vs an LLM estimate)
  plantPrice: string; // '₪XX' or '—'
  availabilityNote?: string; // estimate text when inStockKnown is false
  shipsToHome: boolean; // national ship-to-home option (vs local store)
  rating?: number;
  reviewCount?: number;
  hours?: string;
  phone?: string;
  image?: string;
  latitude: number;
  longitude: number;
}

export type DeliveryMode = 'delivery' | 'pickup';

export type RootStackParamList = {
  Home: undefined;
  Camera: undefined;
  Diagnosis: {
    imageUri: string;
    diagnosis: PlantDiagnosis;
  };
  PlantDetail: { plantId: string };
  WateringHistory: { plantId: string };
  Nurseries: {
    plantName: string;
    lat: number;
    lng: number;
    mode: DeliveryMode;
  };
};
