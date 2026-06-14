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
  distance: string;
  distanceKm: number;
  rating: number;
  reviewCount: number;
  address: string;
  hasPlant: boolean;
  plantPrice: string;
  deliveryAvailable: boolean;
  deliveryTime: string;
  deliveryFee: string;
  pickupAvailable: boolean;
  hours: string;
  phone: string;
  image: string;
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
    nurseries: Nursery[];
    mode: DeliveryMode;
  };
};
