export interface PlantDiagnosis {
  plantName: string;
  condition: 'healthy' | 'mild' | 'moderate' | 'severe' | 'critical';
  conditionLabel: string;
  issues: string[];
  treatments: Treatment[];
  canBeSaved: boolean;
  confidence: number;
  description: string;
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
  Nurseries: {
    plantName: string;
    lat: number;
    lng: number;
    mode: DeliveryMode;
  };
};
