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
   * Ongoing species care - distinct from `treatments`, which fix what is wrong
   * today. Optional because it is advisory server-side (a model that omits it
   * must not fail the diagnosis) and because every plant saved before this
   * field existed has none. Absent means the section is not rendered.
   */
  carePlan?: CarePlan;
  /*
   * Cultivar/variety, e.g. "Thai Constellation" - present only when the model
   * could actually tell from the photo. Absent means generic species, not a
   * failure; never render an empty label for it.
   */
  variety?: string;
  /*
   * The genus, and PlantNet's score summed across every candidate species in
   * it. `confidence` above scores ONE species, and PlantNet splits its
   * probability across a genus's siblings - so a photo the app correctly calls
   * an Anthurium can score 23% on the species while the genus is near certain.
   *
   * Optional in both directions on purpose: an older server never sends these,
   * and every plant saved before this field existed has none. Read them through
   * `identityConfidence()` in src/lib/confidence.ts, which falls back to the
   * species-only behaviour when they are absent.
   */
  genus?: string;
  genusConfidence?: number;
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
  plantPrice: string; // '₪XX' or '-'
  /* Legacy pre-formatted string; read `availability` instead. Still sent so a
   * job started by an older server keeps rendering. */
  availabilityNote?: string;
  /*
   * found     - a real listing. Shown.
   * not_sold  - we read their catalogue, the plant is not in it. HIDDEN.
   * not_found - we could not read the shop. Shown as "didn't find the product".
   */
  outcome?: 'found' | 'not_sold' | 'not_found';
  /* Structured availability - see src/lib/availability.ts for presentation. */
  availability?: {
    kind: 'estimate' | 'unreadable' | 'error';
    confidence?: number;
    detail: string;
  };
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

/* The three destinations in the bottom tab bar. `Scan` hosts nothing - its tab
 * press pushes the root-stack Camera screen instead. */
export type MainTabParamList = {
  MyPlants: undefined;
  Scan: undefined;
  Find: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  /* The bottom-tab navigator. Keeps the name `Home` so the eleven existing
   * navigate('Home') / replace('Home') call sites are untouched - navigating to
   * a navigator lands on its initial route, which is still My Plants.
   *
   * Hand-written rather than NavigatorScreenParams: tsconfig.node.json pulls
   * this file in through the colocated test files, and importing
   * @react-navigation here drags React Native's globals into the server
   * program, where they redefine Blob and break server/diagnose.ts. */
  Home: { screen?: keyof MainTabParamList } | undefined;
  Camera: undefined;
  Diagnosis: {
    imageUri: string;
    diagnosis: PlantDiagnosis;
  };
  PlantDetail: { plantId: string };
  /* `kind` is optional so the existing navigate({ plantId }) call sites keep
   * working and default to watering. */
  WateringHistory: { plantId: string; kind?: 'water' | 'repot' | 'fertilizer' };
  Nurseries: {
    plantName: string;
    lat: number;
    lng: number;
    mode: DeliveryMode;
  };
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  ResetPasswordConfirm: undefined;
  Settings: undefined;
  EditProfileField: { field: 'full_name' | 'username' | 'bio'; current: string };
  ManageAccount: undefined;
  ChangePassword: undefined;
  Notifications: undefined;
};
