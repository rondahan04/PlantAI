/*
 * What a plant is actually growing in.
 *
 * This is not decoration: the same Alocasia in peat and in LECA wants different
 * watering, different feeding and a different warning when it goes wrong, which
 * is why the genus care plan is fetched as one plan PER MEDIUM rather than one
 * plan with a soil sentence in it (see src/lib/genusCarePlan.ts).
 *
 * Pure on purpose - no react-native import - so the list and its multipliers
 * can be tested with `node --test`. The drawing lives in
 * src/components/SoilMediumIcon.tsx; this file only names the glyph and tint it
 * should use, as theme keys rather than colours, so dark mode is not a second
 * table to maintain.
 */

export type SoilMediumId =
  | 'potting_mix'
  | 'aroid_mix'
  | 'leca'
  | 'pon'
  | 'sphagnum'
  | 'bark'
  | 'perlite_mix'
  | 'water';

/*
 * A subset of the keys in Theme['color'], resolved by SoilMediumIcon.
 *
 * A local union rather than `keyof Theme['color']` on purpose: the theme
 * imports react-native, and this module is pulled into the server tsconfig
 * program through its colocated test, where those globals break the build (see
 * the note on RootStackParamList in src/types/index.ts). This still catches the
 * typo that a bare `string` would let through and render as a blank tint.
 */
export type SoilTint = 'repot' | 'feed' | 'accent' | 'warning' | 'secondary' | 'water' | 'primary';

export interface SoilMedium {
  id: SoilMediumId;
  label: string;
  /* One line, shown under the label in the picker. */
  description: string;
  /* Ionicons glyph name. Typed loosely here to keep this module free of the
   * @expo/vector-icons import; SoilMediumIcon narrows it at the call site. */
  icon: string;
  /* A key of Theme['color'], resolved by the component. */
  tint: SoilTint;
  /*
   * FALLBACK ONLY. Scales the base watering interval when no genus care plan
   * has been cached yet - offline, or the call failed. Once `bySoil` exists the
   * model's own interval for this medium wins and this number is not read.
   *
   * Below 1 means "dries out faster, water sooner".
   */
  waterMultiplier: number;
}

export const SOIL_MEDIA: SoilMedium[] = [
  {
    id: 'potting_mix',
    label: 'Potting mix',
    description: 'Standard peat-based houseplant soil',
    icon: 'layers-outline',
    tint: 'repot',
    waterMultiplier: 1,
  },
  {
    id: 'aroid_mix',
    label: 'Aroid mix',
    description: 'Chunky bark, perlite and coco, free-draining',
    icon: 'grid-outline',
    tint: 'feed',
    waterMultiplier: 0.8,
  },
  {
    id: 'leca',
    label: 'LECA',
    description: 'Clay balls with a water reservoir',
    icon: 'ellipsis-horizontal-circle-outline',
    tint: 'accent',
    waterMultiplier: 0.6,
  },
  {
    id: 'pon',
    label: 'Pon',
    description: 'Pumice, zeolite and lava with slow-release feed',
    icon: 'apps-outline',
    tint: 'warning',
    waterMultiplier: 0.65,
  },
  {
    id: 'sphagnum',
    label: 'Sphagnum moss',
    description: 'Long-fibre moss, holds a lot of water',
    icon: 'cloud-outline',
    tint: 'secondary',
    waterMultiplier: 1.4,
  },
  {
    id: 'bark',
    label: 'Orchid bark',
    description: 'Coarse bark, very airy, dries quickly',
    icon: 'reorder-four-outline',
    tint: 'repot',
    waterMultiplier: 0.7,
  },
  {
    id: 'perlite_mix',
    label: 'Perlite heavy',
    description: 'Mostly perlite, near-hydroponic',
    icon: 'sparkles-outline',
    tint: 'water',
    waterMultiplier: 0.6,
  },
  {
    id: 'water',
    label: 'Water',
    description: 'Rooting or growing in plain water',
    icon: 'water-outline',
    tint: 'water',
    waterMultiplier: 2,
  },
];

export const SOIL_MEDIUM_IDS: SoilMediumId[] = SOIL_MEDIA.map((m) => m.id);

export function soilMediumById(id: SoilMediumId | undefined): SoilMedium | undefined {
  return SOIL_MEDIA.find((m) => m.id === id);
}

/* The medium a plant gets when the user has not chosen one. Never guessed from
 * a photo - it is a fact about the pot, not about the plant. */
export const DEFAULT_SOIL_MEDIUM: SoilMediumId = 'potting_mix';
