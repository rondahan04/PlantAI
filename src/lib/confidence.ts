/**
 * Species-identification confidence.
 *
 * `PlantDiagnosis.confidence` is PlantNet's score for the SPECIES MATCH. It says
 * nothing about how sick the plant is - those are two unrelated numbers, and the
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
  /** What to show as the plant's name. The genus when genus-led, else the species. */
  headline: string;
  /** True when the genus is confident but the species is not. */
  genusLed: boolean;
  /** Label for the genus portion of the bar. '' when there is no genus data. */
  genusLabel: string;
}

/** Genus and its aggregated score, when the server sent them. */
export interface GenusInfo {
  genus?: string;
  genusPercent?: number;
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
export function identityConfidence(
  percent: number,
  plantName: string,
  genusInfo: GenusInfo = {}
): IdentityConfidence {
  const tier = confidenceTier(percent);
  const label = `${percent}% species match`;
  const { genus, genusPercent } = genusInfo;

  /*
   * WHICH SERVICE identified the plant is deliberately not surfaced here. The
   * server sends `identificationSource` and logs it, so the pipeline stays
   * debuggable, but naming the vendor tells the user nothing they can act on -
   * the number beside the bar is the part that should drive their trust, and it
   * means the same thing either way. Product decision, 2026-08-28.
   */

  const hasGenus =
    typeof genus === 'string' &&
    genus.trim() !== '' &&
    typeof genusPercent === 'number' &&
    /*
     * Aggregation may only ever strengthen the species score. A genus below it
     * means something upstream is inconsistent - ignore it rather than present
     * a headline weaker than the line beneath it.
     */
    genusPercent >= percent;

  const genusLabel = hasGenus ? `${genusPercent}% genus match` : '';

  /*
   * Genus-led is the Anthurium case: we are sure of the group and unsure only
   * of the exact species. Requiring the SPECIES to be non-high is what keeps
   * this from firing when everything is already confident, and requiring the
   * GENUS to be high is what keeps a cross-genus mistake (the Aug 2026
   * Monstera/Rhaphidophora confusion) from being dressed up as certainty.
   */
  const genusLed =
    hasGenus && confidenceTier(genusPercent!) === 'high' && tier !== 'high';

  if (genusLed) {
    return {
      tier,
      namePrefix: '',
      label,
      genusLabel,
      headline: genus!.trim(),
      genusLed: true,
      noteTitle: 'We know the plant group, not the exact species',
      noteBody: `This is a ${genus!.trim()} (${genusPercent}% match). We cannot tell which species - ${plantName} is the closest at ${percent}%. Care for the group is reliable; anything species-specific may not be.`,
      needsCaveat: true,
    };
  }

  if (tier === 'high') {
    return {
      tier,
      namePrefix: '',
      label,
      genusLabel,
      headline: plantName,
      genusLed: false,
      noteTitle: '',
      noteBody: '',
      needsCaveat: false,
    };
  }

  if (tier === 'moderate') {
    return {
      tier,
      namePrefix: 'Probably',
      label,
      genusLabel,
      headline: plantName,
      genusLed: false,
      noteTitle: 'We are not certain of the species',
      noteBody: `This looks like ${plantName}, but it is not a confident match. The advice below assumes that identification is right.`,
      needsCaveat: true,
    };
  }

  return {
    tier,
    namePrefix: 'Possibly',
    label,
    genusLabel,
    headline: plantName,
    genusLed: false,
    noteTitle: "We could not identify this plant",
    noteBody: `${plantName} is our best guess and it is a weak one. Treat the advice below as a starting point, not a diagnosis. A photo with the leaves filling the frame, in daylight, usually identifies much better.`,
    needsCaveat: true,
  };
}
