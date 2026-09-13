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

import type { Nursery } from '../../types/index';

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


/*
 * The wording, injected like `WateringCopy` and `IdentityCopy`. This module
 * decides what we actually know about a shop's stock; the caller supplies the
 * sentence.
 */
export interface AvailabilityCopy {
  likely: string;
  maybe: string;
  unlikely: string;
  inStock: (shipsToHome: boolean) => string;
  notFound: string;
  /* We never managed to read this shop, so we are not claiming anything about
   * what it stocks. Distinct from notFound, which says we looked. */
  couldNotCheck: string;
  /* The shop was read and sells nothing online, or there was never a site to
   * read at all. Not a failure on our side, and not a claim about the shelf -
   * a nursery you phone. */
  noOnlineShop: string;
  estimate: (band: string, confidence: number) => string;
  /* Found the product and its price; the page never says whether it is in
   * stock. Distinct from both 'in stock' and 'did not find it'. */
  stockUnknown: string;
  unknown: string;
  unknownCallToConfirm: string;
}

/* English, so every existing caller and test behaves exactly as before. */
export const EN_AVAILABILITY_COPY: AvailabilityCopy = {
  likely: 'Likely has it',
  maybe: 'Might have it',
  unlikely: 'Probably not',
  inStock: (shipsToHome) => `In stock now · ${shipsToHome ? 'ships to home' : 'local pickup'}`,
  notFound: "Didn't find the product",
  couldNotCheck: "Couldn't check this shop",
  noOnlineShop: 'No online shop - call to check',
  estimate: (bandLabel, confidence) => `${bandLabel} · ${confidence}%`,
  stockUnknown: 'Listed · stock not stated',
  unknown: 'Availability unknown',
  unknownCallToConfirm: 'Availability unknown - call to confirm',
};

function band(confidence: number, words: AvailabilityCopy): string {
  if (confidence >= LIKELY_AT_OR_ABOVE) return words.likely;
  if (confidence >= MAYBE_AT_OR_ABOVE) return words.maybe;
  return words.unlikely;
}

type AvailabilityInput = Pick<
  Nursery,
  'inStockKnown' | 'hasPlant' | 'shipsToHome' | 'availability' | 'availabilityNote' | 'outcome'
>;

/*
 * Whether a nursery is worth showing at all.
 *
 * `not_sold` means we searched their catalogue and the plant was not in it.
 * That shop is not a result - it is the absence of one, and a list padded with
 * places that definitely cannot help is a list the user has to read past.
 */
export function isWorthShowing(n: Pick<Nursery, 'outcome'>): boolean {
  return n.outcome !== 'not_sold';
}

/*
 * Will this card actually show a price?
 *
 * Deliberately not `hasPlant`. A `priceSuspect` listing is one the final
 * cross-nursery check refused to believe, so the card renders "See price"
 * instead of the number - while `hasPlant` stays true. Ordering by `hasPlant`
 * therefore floated a shop with no visible price up among the priced ones.
 * The user is scanning for numbers; sort by the thing they can see.
 */
export function showsPrice(
  n: Pick<Nursery, 'hasPlant' | 'plantPrice' | 'priceSuspect'>
): boolean {
  return Boolean(n.hasPlant && !n.priceSuspect && n.plantPrice && n.plantPrice !== '-');
}

/*
 * ILS out of a displayed price string. Handles "₪1,499.90", '46.80 ש"ח' and
 * bare numbers; returns Infinity for anything unparseable so a price we cannot
 * read sorts last rather than winning the top of the list by accident.
 *
 * Mirrors parsePrice in scraper/pipeline.ts on purpose. The server sorts whole
 * nurseries and this sorts rendered cards, but they must agree about what a
 * number is - a client that read "₪1,499.90" as 1 would put the dearest shop
 * first while showing the user the reason it should be last.
 */
export function priceOf(price: string | undefined): number {
  const digits = (price || '').replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const n = Number.parseFloat(digits);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

/*
 * Pick Up order: the shops that answered the question first, cheapest of those
 * first, and everything we could not price after them, nearest first.
 *
 * Price leads over distance inside the priced block because that block is the
 * comparison - every row in it can sell you the plant today, so the only
 * question left is what it costs. Distance orders the rows below, where there
 * is no price to compare and "which is closest to call in at" is all that is
 * left, and it breaks ties between two shops charging the same.
 */
export function byPickupOrder(
  a: Pick<Nursery, 'hasPlant' | 'plantPrice' | 'priceSuspect' | 'distanceKm'>,
  b: Pick<Nursery, 'hasPlant' | 'plantPrice' | 'priceSuspect' | 'distanceKm'>
): number {
  const pa = showsPrice(a);
  const pb = showsPrice(b);
  if (pa !== pb) return pa ? -1 : 1;
  if (pa && pb) {
    const byPrice = priceOf(a.plantPrice) - priceOf(b.plantPrice);
    if (byPrice !== 0 && Number.isFinite(byPrice)) return byPrice;
  }
  return a.distanceKm - b.distanceKm;
}

export function availabilityBadge(
  n: AvailabilityInput,
  words: AvailabilityCopy = EN_AVAILABILITY_COPY
): AvailabilityBadge {
  // An exact listing outranks every estimate - we saw the product and its price.
  if (n.inStockKnown) {
    return {
      text: words.inStock(Boolean(n.shipsToHome)),
      tone: 'good',
      detail: '',
      hasDetail: false,
    };
  }

  /*
   * Nothing to show for this nursery. Two different reasons, and they are worth
   * separating.
   *
   * We SEARCHED and found nothing → "didn't find the product". A claim about
   * the shop's shelf.
   *
   * We could not read the shop at all → "couldn't check this shop". A claim
   * about us, and the honest one: saying we did not find the product implies we
   * looked, and for a shop whose search URL 404s we never did. Two nurseries
   * spent a month in that state telling users their plants were unavailable.
   *
   * Neither says "the scrape failed" - our plumbing is not the user's problem.
   * Both keep the row, because they may still want to ring the place.
   */
  if (n.outcome === 'not_found') {
    const kind = n.availability?.kind;
    const unread = kind === 'unreadable' || kind === 'error';
    /* Two ways to have no shop to read: a site with no catalogue, and no site
     * at all. Neither is a failure of ours or a claim about their shelf - what
     * the user can do in both is ring them, so both rows say so. */
    const noShop = kind === 'no_catalogue' || kind === 'no_website';
    return {
      text: noShop ? words.noOnlineShop : unread ? words.couldNotCheck : words.notFound,
      tone: 'unknown',
      detail: n.availability?.detail ?? '',
      hasDetail: Boolean(n.availability?.detail),
    };
  }

  const a = n.availability;

  /*
   * We have a real listing with a real price; what we lack is a stock
   * statement. Before this branch the auditor dropped these rows outright and
   * the shop vanished from the results entirely - so a nursery that does stock
   * the plant was hidden, on the grounds that we could not prove it did. Tone
   * is 'maybe', never 'good': the price is evidence, the stock is not.
   */
  if (a?.kind === 'stock_unknown') {
    return {
      text: words.stockUnknown,
      tone: 'maybe',
      detail: a.detail,
      hasDetail: Boolean(a.detail),
    };
  }

  if (a?.kind === 'estimate' && typeof a.confidence === 'number') {
    return {
      text: words.estimate(band(a.confidence, words), a.confidence),
      tone: a.confidence >= MAYBE_AT_OR_ABOVE ? 'maybe' : 'unknown',
      detail: a.detail,
      hasDetail: Boolean(a.detail),
    };
  }

  /*
   * Legacy shapes from a job started before outcomes existed. Same wording as
   * `not_found` above - the user should never see two vocabularies for one
   * situation just because a job outlived a deploy.
   */
  if (a?.kind === 'unreadable' || a?.kind === 'error') {
    return {
      text: words.couldNotCheck,
      tone: 'unknown',
      detail: a.detail,
      hasDetail: Boolean(a.detail),
    };
  }

  /*
   * Legacy path: a job started by an older server, still held in memory across
   * a restart, carries only the pre-formatted string. Show it behind the tap
   * rather than dropping the row's only signal.
   */
  if (n.availabilityNote) {
    return {
      text: words.unknown,
      tone: 'unknown',
      detail: n.availabilityNote,
      hasDetail: true,
    };
  }

  return {
    text: words.unknownCallToConfirm,
    tone: 'unknown',
    detail: '',
    hasDetail: false,
  };
}
