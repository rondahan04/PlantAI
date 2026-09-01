import type { Ionicons } from '@expo/vector-icons';
import { copy } from '../services/language';

/*
 * The three-beat product story, in one place.
 *
 * Onboarding tells it to a first-time user and Home's first-run layout repeats
 * it to anyone who skipped. Two copies of this list would drift the moment a
 * feature is renamed, and the drift is invisible - the two screens are never
 * on-screen together.
 *
 * `blurb` is the onboarding voice (second person, one full sentence, room to
 * breathe under a display headline); `desc` is the Home card voice (a clause,
 * sized for a row). Same feature, different amount of space.
 *
 * The WORDS live in the copy tree so they can be Hebrew; this file keeps the
 * order and the icons, which are the parts that are not language.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

export interface Feature {
  icon: IconName;
  title: string;
  desc: string;
  blurb: string;
}

export const FEATURES: Feature[] = [
  { icon: 'scan-outline', ...copy.features.scan },
  { icon: 'water-outline', ...copy.features.track },
  { icon: 'storefront-outline', ...copy.features.replace },
];
