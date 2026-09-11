import type { Language } from '../lib/i18n/language';
import type { DiagnosisProse } from '../lib/diagnosis/diagnosisProse';

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
   * Which language the prose above is written in.
   *
   * The model writes it once, on the day of the photo, so this is a fact about
   * the record rather than about the app. Absent on everything saved before
   * the field existed - readers go through `languageOf` in lib/diagnosisProse,
   * which falls back to reading the script.
   */
  lang?: Language;
  /*
   * The same prose in the other languages we have paid to produce, INCLUDING
   * the one currently on the top-level fields.
   *
   * Keeping the original is what makes switching back free: without it,
   * translating en->he throws the English away and he->en has to be bought
   * again. Only words live here - see the note in lib/diagnosisProse.ts on
   * what is deliberately not prose.
   */
  translations?: Partial<Record<Language, DiagnosisProse>>;
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
   * `identityConfidence()` in src/lib/diagnosis/confidence.ts, which falls back to the
   * species-only behaviour when they are absent.
   */
  genus?: string;
  genusConfidence?: number;
  /*
   * Which service named this plant. `plantnet` is a botanical database matching
   * against herbarium specimens; `openai` is a vision model, used only as a
   * backup when PlantNet came back weak or did not answer at all.
   *
   * The distinction is shown to the user rather than hidden: a visual match is
   * a different KIND of evidence, and someone deciding whether to trust a
   * treatment plan deserves to know which one they got. Optional in both
   * directions - an older server never sends it, and plants saved before the
   * backup existed have none. Absent means PlantNet.
   */
  identificationSource?: 'plantnet' | 'openai';
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
  /*
   * What to search a nursery for - an English or brand name - or an empty
   * string when this treatment is advice rather than a purchase.
   *
   * Supplied by the model, which already knows whether it just recommended a
   * buyable thing. It exists because the client used to work this out by
   * parsing the English title against English substance and action words, and
   * that returns null for every Hebrew title - silently removing the only
   * commerce path out of a diagnosis.
   *
   * OPTIONAL, and the three states are distinct: a string is a product, '' is
   * the model saying there is nothing to buy, and absent is a record written
   * before this field existed. Only the last falls through to the parser.
   */
  product?: string;
  /*
   * The SAME product, written for a human in the app's language.
   *
   * `product` is a search term that gets typed into an Israeli nursery's site,
   * so it stays English on purpose - translating it is how the buy button
   * stops finding anything. But it was also the button's LABEL, which is how a
   * Hebrew treatment card ended up reading "למצוא Balanced aroid fertilizer
   * בסביבה". Two jobs, two fields: this one is read, that one is searched.
   *
   * Absent on every record written before the split, and on any English
   * diagnosis, where the two would be identical anyway - callers fall back to
   * `product`.
   */
  productLabel?: string;
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
  /* The specific product page behind plantPrice - the Order button's target. */
  productUrl?: string;
  /* Which listing plantPrice belongs to, and how many matched. */
  productName?: string;
  matchCount?: number;
  /* A final LLM pass did not trust this price, so plantPrice is '-'. */
  priceSuspect?: boolean;
  priceNote?: string;
  /* Structured availability - see src/lib/nursery/availability.ts for presentation. */
  availability?: {
    kind: 'estimate' | 'unreadable' | 'error' | 'stock_unknown' | 'no_catalogue' | 'no_website';
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
  /* Named Dashboard rather than Home so it can never be confused with the root
   * stack's `Home` (the tab host) at a navigate() call site. */
  Dashboard: undefined;
  Portfolio: undefined;
  Scan: undefined;
  Find: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  /* The bottom-tab navigator. Keeps the name `Home` so the eleven existing
   * navigate('Home') / replace('Home') call sites are untouched - navigating to
   * a navigator lands on its initial route, which is now Portfolio.
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
  /* Rename a plant and replace its picture. Takes only the id for the same
   * reason PlantDetail does: params are persisted and restored, so the screen
   * re-reads the plant rather than carrying a stale copy of it. */
  EditPlant: { plantId: string };
  /* `kind` is optional so the existing navigate({ plantId }) call sites keep
   * working and default to watering. */
  /* `leaf` is not a care kind - it is new growth, which the same calendar
   * draws as its own filter with its own two markers. See lib/leaves.ts. */
  WateringHistory: { plantId: string; kind?: 'water' | 'repot' | 'fertilizer' | 'leaf' };
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
  Language: undefined;
  /*
   * The species catalog, pushed from the add-plant form. It cannot take an
   * onPick callback - params are persisted and restored, so they have to stay
   * serializable - so the picker returns its answer as data: it pops back to
   * the AddPlant already below it in the stack, carrying the chosen id.
   */
  SpeciesPicker: undefined;
  /* `picked` is absent on the way in and present on the way back from the
   * picker, which is why the whole params object is optional. */
  AddPlant: { picked?: { catalogId: string } } | undefined;
};
