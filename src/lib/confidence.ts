/**
 * Species-identification confidence.
 *
 * `PlantDiagnosis.confidence` is PlantNet's score for the SPECIES MATCH. It says
 * nothing about how sick the plant is — those are two unrelated numbers, and the
 * UI used to paint the confidence bar with the *condition* color, which read as
 * "48% severity" rather than "48% sure what this is".
 *
 * A real run in Aug 2026 returned "Mini monstera" (Rhaphidophora tetrasperma) at
 * 48% for a photo of a Monstera deliciosa, rendered exactly like a 92% match.
 * A user who accepts that gets a treatment plan and a nursery search for a plant
 * they do not own. Every consumer of `confidence` goes through this module so
 * that presentation and threshold live in one place.
 */

export type ConfidenceTier = 'high' | 'moderate' | 'low';

/** At or above this, present the identification plainly. */
export const CONFIDENT_AT_OR_ABOVE = 70;
/** Below this, lead with the doubt rather than the species name. */
export const UNSURE_BELOW = 40;

export interface IdentityConfidence {
  tier: ConfidenceTier;
  /** Hedge word placed before the plant name (''when confident). */
  namePrefix: string;
  /** Compact label shown beside the bar. */
  label: string;
  /** Heading for the caveat card. '' when confident. */
  noteTitle: string;
  /** Body for the caveat card. '' when confident. */
  noteBody: string;
  /** Whether to show the caveat card and retake affordance at all. */
  needsCaveat: boolean;
}

export function confidenceTier(percent: number): ConfidenceTier {
  if (percent >= CONFIDENT_AT_OR_ABOVE) return 'high';
  if (percent >= UNSURE_BELOW) return 'moderate';
  return 'low';
}

/*
 * The caveat is deliberately a separate card rather than a different bar color:
 * color alone is invisible to a colorblind user and easy to scan past, and the
 * point of this feature is that uncertainty should be impossible to miss.
 */
export function identityConfidence(percent: number, plantName: string): IdentityConfidence {
  const tier = confidenceTier(percent);
  const label = `${percent}% species match`;

  if (tier === 'high') {
    return { tier, namePrefix: '', label, noteTitle: '', noteBody: '', needsCaveat: false };
  }

  if (tier === 'moderate') {
    return {
      tier,
      namePrefix: 'Probably',
      label,
      noteTitle: 'We are not certain of the species',
      noteBody: `This looks like ${plantName}, but it is not a confident match. The advice below assumes that identification is right.`,
      needsCaveat: true,
    };
  }

  return {
    tier,
    namePrefix: 'Possibly',
    label,
    noteTitle: "We could not identify this plant",
    noteBody: `${plantName} is our best guess and it is a weak one. Treat the advice below as a starting point, not a diagnosis. A photo with the leaves filling the frame, in daylight, usually identifies much better.`,
    needsCaveat: true,
  };
}
