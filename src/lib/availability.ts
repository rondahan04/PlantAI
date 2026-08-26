/**
 * How a nursery's availability is described in one line.
 *
 * The scraper returns either an exact listing (a real product with a price) or
 * an LLM likelihood. That likelihood used to arrive pre-formatted as
 * "~50% · <a whole sentence of reasoning>" and was rendered into a small pill,
 * where it clipped mid-word:
 *
 *   "~50% · The site text is only a security-verification page, so there is
 *    no explicit evidence about Monstera or plant ca…"
 *
 * Two things were wrong there. The row was unreadable, and the number was
 * fabricated - that site was a bot wall, so there was no shop to be 50% sure
 * about. This module fixes the first and refuses to state the second: an
 * unreadable site gets no percentage at all.
 *
 * Presentation and thresholds live here rather than in the screen for the same
 * reason as `confidence.ts` - one place to change what a band means.
 */

import type { Nursery } from '../types';

export type AvailabilityTone = 'good' | 'maybe' | 'unknown';

export interface AvailabilityBadge {
  /** Short enough for one line in a pill. */
  text: string;
  tone: AvailabilityTone;
  /** The full reasoning, revealed on demand. '' when there is nothing more. */
  detail: string;
  /** Whether tapping the pill has anything to show. */
  hasDetail: boolean;
}

/* Bands for an LLM likelihood. Deliberately coarse: the model's number is an
 * opinion, and rendering it to the percent implies a precision it lacks. */
export const LIKELY_AT_OR_ABOVE = 70;
export const MAYBE_AT_OR_ABOVE = 40;

function band(confidence: number): string {
  if (confidence >= LIKELY_AT_OR_ABOVE) return 'Likely has it';
  if (confidence >= MAYBE_AT_OR_ABOVE) return 'Might have it';
  return 'Probably not';
}

type AvailabilityInput = Pick<
  Nursery,
  'inStockKnown' | 'hasPlant' | 'shipsToHome' | 'availability' | 'availabilityNote'
>;

export function availabilityBadge(n: AvailabilityInput): AvailabilityBadge {
  // An exact listing outranks every estimate - we saw the product and its price.
  if (n.inStockKnown) {
    return {
      text: `In stock now · ${n.shipsToHome ? 'ships to home' : 'local pickup'}`,
      tone: 'good',
      detail: '',
      hasDetail: false,
    };
  }

  const a = n.availability;

  if (a?.kind === 'estimate' && typeof a.confidence === 'number') {
    return {
      text: `${band(a.confidence)} · ${a.confidence}%`,
      tone: a.confidence >= MAYBE_AT_OR_ABOVE ? 'maybe' : 'unknown',
      detail: a.detail,
      hasDetail: Boolean(a.detail),
    };
  }

  /*
   * No percentage here, on purpose. We never read the shop, so any number would
   * be about a captcha page rather than about the plant. "Couldn't read" is the
   * whole truth and it is shorter.
   */
  if (a?.kind === 'unreadable') {
    return { text: "Couldn't read this site", tone: 'unknown', detail: a.detail, hasDetail: Boolean(a.detail) };
  }

  if (a?.kind === 'error') {
    return { text: "Couldn't check this site", tone: 'unknown', detail: a.detail, hasDetail: Boolean(a.detail) };
  }

  /*
   * Legacy path: a job started by an older server, still held in memory across
   * a restart, carries only the pre-formatted string. Show it behind the tap
   * rather than dropping the row's only signal.
   */
  if (n.availabilityNote) {
    return {
      text: 'Availability unknown',
      tone: 'unknown',
      detail: n.availabilityNote,
      hasDetail: true,
    };
  }

  return {
    text: 'Availability unknown - call to confirm',
    tone: 'unknown',
    detail: '',
    hasDetail: false,
  };
}
