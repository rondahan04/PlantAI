/*
 * Where to send someone who wants to BUY a treatment.
 *
 * The treatment plan's "find it nearby" button runs the nursery scrape, which
 * is the right answer for the things a garden centre actually keeps on a shelf
 * - neem oil, a fungicide, potting mix, perlite. It is the wrong answer for
 * plant nutrients. Almost no Israeli nursery stocks chelated iron or a
 * micronutrient supplement, so the scrape spends thirty to sixty seconds and a
 * paid job to come back with nothing, every time, for a product the user could
 * have been handed a link to.
 *
 * So nutrients skip the scrape and go to a shop known to carry them. Everything
 * else is unchanged.
 *
 * MATCHED IN ENGLISH, deliberately. `product` is the shop search term and stays
 * English by design even on a Hebrew record - see the note on `productLabel` in
 * src/types/index.ts and the language rule in server/diagnose.ts. The Hebrew the
 * user reads lives in `productLabel`, which is never matched here.
 *
 * Pure - no react-native import - so `node --test` covers it.
 */

/*
 * The suppliers.
 *
 * Plain constants rather than a config file or a remote lookup: there are
 * only a few, they change about never, and a dead link is something a test should
 * catch at build time rather than a user find on a shelf.
 *
 * NO TRACKING PARAMETERS. Two of these were copied out of a browser after a
 * Google ad click and arrived carrying `gclid`, `gbraid` and a set of `utm_*`
 * values. Shipping those would attribute every user's tap for the life of the
 * app to one stale click of ours, and they are not needed to reach the page -
 * both were verified to load without them. A test asserts they stay out.
 */

/* A full nutrient kit: feeds, and the micronutrients a deficiency calls for. */
export const NUTRIENT_SHOP_URL =
  'https://hydroshop.co.il/products/%d7%a2%d7%a8%d7%9b%d7%aa-%d7%93%d7%99%d7%a9%d7%95%d7%9f-%d7%9c%d7%9b%d7%9c-%d7%a1%d7%95%d7%92%d7%99-%d7%94%d7%9e%d7%a6%d7%a2%d7%99%d7%9d-ghe-starter-kit/';

/* Neemgard, 60ml, neem-oil based. */
export const NEEM_SHOP_URL = 'https://hydroshop.co.il/products/%d7%a0%d7%99%d7%9e%d7%92%d7%90%d7%a8%d7%93/';

/* Kligrin, a systemic fungicide for houseplants. */
export const FUNGICIDE_SHOP_URL = 'https://www.gadot-garden.com/product/%D7%A7%D7%9C%D7%99%D7%92%D7%A8%D7%99%D7%9F/';

export const CONFIDOR_SHOP_URL =
  'https://rootine.co.il/products/%D7%A7%D7%95%D7%A0%D7%A4%D7%99%D7%93%D7%95%D7%A8-0-5-%D7%9C%D7%99%D7%98%D7%A8';

/*
 * What counts as a nutrient. Covers the names the model actually reaches for:
 * the feed itself, the micronutrient supplements a deficiency calls for, and
 * the two salts that get prescribed by their chemical name.
 *
 * Kept narrow on purpose. A false positive sends someone after a fungicide to
 * a page of fertilizer; a false negative only leaves them with the search they
 * had before.
 */
const NUTRIENT_TERMS = [
  'fertilizer',
  'fertiliser',
  'plant food',
  'npk',
  'nutrient',
  'nutrients',
  'micronutrient',
  'micronutrients',
  'micro nutrient',
  'trace element',
  'trace elements',
  'chelate',
  'chelated',
  'iron',
  'cal-mag',
  'calmag',
  'cal mag',
  'calcium',
  'magnesium',
  'epsom',
];

const NEEM_TERMS = ['neem', 'neemgard', 'azadirachtin'];

/*
 * `fungicide` only, not `insecticide`. They share six letters and nothing
 * else, and sending someone after scale insects to a fungicide is the kind of
 * wrong answer that costs them a plant.
 */
const FUNGICIDE_TERMS = ['fungicide', 'fungicidal'];

const CONFIDOR_TERMS = ['confidor', 'imidacloprid'];

/*
 * Checked in order, most specific first. Nothing overlaps today, but the order
 * is what keeps that true when a term is added: a product matching two groups
 * should get the narrower answer, not whichever happened to be declared first.
 */
/*
 * The id is what the button's words are chosen by. Carried here rather than
 * derived from the URL so the copy cannot silently fall back to the wrong
 * sentence when a link changes - "Get Aroid Fertilizer now!" on a neem oil
 * card is a worse bug than a broken link, because it looks fine.
 */
export type ShopId = 'confidor' | 'nutrient' | 'neem' | 'fungicide';

const SUPPLIERS: { id: ShopId; terms: string[]; url: string }[] = [
  { id: 'confidor', terms: CONFIDOR_TERMS, url: CONFIDOR_SHOP_URL },
  { id: 'neem', terms: NEEM_TERMS, url: NEEM_SHOP_URL },
  { id: 'fungicide', terms: FUNGICIDE_TERMS, url: FUNGICIDE_SHOP_URL },
  { id: 'nutrient', terms: NUTRIENT_TERMS, url: NUTRIENT_SHOP_URL },
];

/*
 * Whole words only. Substring matching reads "environment" as iron, which is
 * the sort of mistake that is invisible in review and obvious on the screen.
 * The terms are ASCII, so `\b` is the right boundary here.
 */
const patternsFor = (terms: string[]): RegExp[] =>
  terms.map((term) => new RegExp(`\\b${term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i'));

const COMPILED = SUPPLIERS.map((s) => ({ id: s.id, url: s.url, patterns: patternsFor(s.terms) }));

/*
 * The shop for this product, or null when there is no known supplier and the
 * nursery search is still the best answer.
 */
export function shopFor(product: string): { id: ShopId; url: string } | null {
  const text = product.trim();
  if (text === '') return null;
  for (const supplier of COMPILED) {
    if (supplier.patterns.some((re) => re.test(text))) return { id: supplier.id, url: supplier.url };
  }
  return null;
}
