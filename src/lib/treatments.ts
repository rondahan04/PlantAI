import type { Treatment } from '../types';

/*
 * Which treatments can actually be bought, and under what name.
 *
 * A treatment is written for a human ("Confidor (imidacloprid) soil drench"),
 * and the nursery scrape takes a shop-able search term ("Confidor"). Half the
 * treatment plan is not a product at all - "wipe the scale off by hand" is
 * advice - and sending that to the scraper burns a 30-60s job to come back
 * with nothing. So this returns null for those, and the button is simply not
 * rendered: no CTA is better than one that reliably fails.
 */

/*
 * Generic substances the model reaches for by name. Matched before the brand
 * rule below so "Neem oil spray" searches for the oil rather than the word
 * "Neem". Longest first - "copper fungicide" must win over "fungicide".
 */
const SUBSTANCES = [
  'insecticidal soap',
  'horticultural oil',
  'copper fungicide',
  'systemic insecticide',
  'hydrogen peroxide',
  'rooting hormone',
  'sphagnum moss',
  'potting mix',
  'neem oil',
  'fungicide',
  'insecticide',
  'miticide',
  'fertilizer',
  'perlite',
];

/*
 * Words a treatment title opens with when it describes an ACTION rather than a
 * product. Without this list the capitalised first word of "Wipe the scale
 * off" reads as a brand name.
 */
const ACTION_WORDS = new Set([
  'allow',
  'apply',
  'avoid',
  'check',
  'cut',
  'discard',
  'dust',
  'increase',
  'isolate',
  'keep',
  'let',
  'lower',
  'mist',
  'move',
  'place',
  'prune',
  'quarantine',
  'raise',
  'reduce',
  'remove',
  'repot',
  'rinse',
  'soak',
  'spray',
  'stop',
  'treat',
  'trim',
  'wash',
  'water',
  'wipe',
]);

/* Trailing method words that are not part of the product's name. */
const STRIP = /[^\p{L}\p{N}-]/gu;

/*
 * The search term to scrape nurseries for, or null when the treatment is an
 * action rather than something on a shelf.
 */
export function treatmentProduct(title: string): string | null {
  const text = title.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  for (const substance of SUBSTANCES) {
    if (lower.includes(substance)) return substance;
  }

  /*
   * Brand rule: the first capitalised word that is not the opening verb. A
   * product is nearly always named in the title's first few words, so this
   * stops at the first hit rather than collecting every capitalised token
   * (which would pick up "Repeat after 3 weeks" style sentences).
   */
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(STRIP, '');
    if (word.length < 3) continue;
    if (i === 0 && ACTION_WORDS.has(word.toLowerCase())) continue;
    if (!/^\p{Lu}/u.test(word)) continue;
    return word;
  }

  return null;
}

/* The treatments worth showing a "find it nearby" button on, paired with
 * the term each one should scrape for. */
export function shoppableTreatments(
  treatments: Treatment[]
): { treatment: Treatment; product: string }[] {
  return treatments
    .map((treatment) => ({ treatment, product: treatmentProduct(treatment.title) }))
    .filter((entry): entry is { treatment: Treatment; product: string } => entry.product !== null);
}
