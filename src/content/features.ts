import type { Ionicons } from '@expo/vector-icons';

/*
 * The three-beat product story, in one place.
 *
 * Onboarding tells it to a first-time user and Home's first-run layout repeats
 * it to anyone who skipped. Two copies of this list would drift the moment a
 * feature is renamed, and the drift is invisible — the two screens are never
 * on-screen together.
 *
 * `blurb` is the onboarding voice (second person, one full sentence, room to
 * breathe under a display headline); `desc` is the Home card voice (a clause,
 * sized for a row). Same feature, different amount of space.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

export interface Feature {
  icon: IconName;
  title: string;
  desc: string;
  blurb: string;
}

export const FEATURES: Feature[] = [
  {
    icon: 'scan-outline',
    title: 'Snap & Diagnose',
    desc: 'AI identifies what is hurting your plant instantly',
    blurb: 'Point your camera at a struggling plant. In seconds you get the species, what is wrong, and how to fix it.',
  },
  {
    icon: 'water-outline',
    title: 'Track & Water',
    desc: 'A watering schedule tuned to each plant you save',
    blurb: 'Every plant you save gets a care plan and a watering rhythm, with a reminder so you never guess again.',
  },
  {
    icon: 'storefront-outline',
    title: 'Find Replacements',
    desc: 'Locate healthy plants at nurseries near you',
    blurb: 'When a plant is past saving, we find a healthy one at a nursery near you — delivered or ready to collect.',
  },
];
