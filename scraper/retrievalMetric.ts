/*
 * The retrieval metric itself, separated from the script that prints it so the
 * test suite can assert the same numbers the report shows. A gate that measures
 * something slightly different from the report is a gate nobody trusts.
 *
 * Offline and free: every shop response is replayed from the captured fixtures.
 * See scripts/retrieval-accuracy.ts for what the numbers mean.
 */

import {
  PLANTS,
  loadRetrievalManifest,
  readRetrievalFixture,
  plantById,
  type RetrievalFixture,
} from './retrievalFixtures.ts';
import { wooProduct, shopifyProduct, cleanName } from './platformApi.ts';
import { extractStructuredProducts, type StructuredProduct } from './structuredPrice.ts';
import { buildQueryPlan, rankCandidates, isDecisive, canonical } from './queryPlan.ts';

/* The national shippers. They are the entire Deliver tab, so they are held to a
 * higher bar than a nursery that merely happens to be nearby. */
export const NATIONAL_HOSTS = new Set(['al-haderech.co.il', 'rootine.co.il']);

export type Outcome = 'hit' | 'miss' | 'wrong' | 'quiet' | 'noisy' | 'unread';

export interface MetricRow {
  host: string;
  plantId: string;
  national: boolean;
  listed: boolean;
  expected: string[];
  got?: string;
  decisive: boolean;
  outcome: Outcome;
}

export interface MetricSummary {
  rows: MetricRow[];
  capturedAt: string;
  listed: number;
  hits: number;
  wrong: number;
  offered: number;
  absent: number;
  quiet: number;
  undecided: number;
  /* Retrieval rate over the shop/plant pairs where the shop lists the plant. */
  retrieval: number;
  precision: number;
  quietRate: number;
  nationalRetrieval: number;
  pickupRetrieval: number;
}

/* Products a captured body describes, through the real mappers. */
function productsOf(f: RetrievalFixture): StructuredProduct[] {
  const body = readRetrievalFixture(f.bodyFile);
  if (!body) return [];
  const origin = `https://${f.host}`;
  if (f.route === 'html') return extractStructuredProducts(body, f.requestUrl);
  try {
    const parsed = JSON.parse(body);
    if (f.route === 'woo-store') {
      return (Array.isArray(parsed) ? parsed : [])
        .map((r: any) => wooProduct(r, origin))
        .filter((p): p is StructuredProduct => p !== null);
    }
    return (parsed?.products ?? [])
      .map((r: any) => shopifyProduct(r, origin))
      .filter((p: StructuredProduct | null): p is StructuredProduct => p !== null);
  } catch {
    return [];
  }
}

/*
 * Replay one shop's answer to one plant, the way production asks it.
 *
 * The ladder is honoured rather than assumed: the broad rung first, falling
 * back to the full-phrase capture, which is exactly what createSearcher does
 * live. A Shopify catalogue answers every plant from one body, so it has no
 * rung to choose.
 */
/*
 * Which question we ask the shop.
 *
 *   broad  what the pipeline does now: send the genus, rank the shelf locally.
 *   full   what it did before: send the whole plant name and take what comes.
 *
 * `full` is not dead code and not a fallback - it is the control. A metric that
 * cannot express the old behaviour cannot show that the new behaviour is
 * better, and "100%" on its own is as consistent with a broken metric as with a
 * fixed pipeline.
 */
export type Strategy = 'broad' | 'full';

export function retrieve(fixtures: RetrievalFixture[], plantId: string, strategy: Strategy = 'broad') {
  const plant = plantById(plantId)!;
  const plan = buildQueryPlan({
    original: plant.latin,
    hebrew: plant.hebrew,
    latin: plant.latin,
    /* Stands in for what planQuery's `alt` returns live; without it this would
     * measure a weaker system than the one that actually runs. */
    altSpellings: plant.alt,
  });

  if (fixtures.some((f) => f.route === 'shopify-json')) {
    const all = fixtures.filter((f) => f.route === 'shopify-json').flatMap(productsOf);
    return { plan, products: all, read: all.length > 0 };
  }

  const forPlant = fixtures.filter((f) => f.plantId === plantId);
  const byVariant = (v: string) => forPlant.find((f) => f.variant === v);
  const rungs = (
    strategy === 'full'
      ? [byVariant('full')]
      : [byVariant('broad'), byVariant('full')]
  ).filter(Boolean) as RetrievalFixture[];

  let read = false;
  for (const f of rungs) {
    if (f.status >= 200 && f.status < 400) read = true;
    const products = productsOf(f);
    if (products.length) return { plan, products, read };
  }
  return { plan, products: [] as StructuredProduct[], read };
}

/* Did we return one of the products the judge accepted? Compared on canonical
 * tokens, so a title differing only by whitespace or entities still counts. */
export function sameProduct(a: string, b: string): boolean {
  const ta = canonical(cleanName(a)).join(' ');
  const tb = canonical(cleanName(b)).join(' ');
  if (!ta || !tb) return false;
  return ta === tb || ta.includes(tb) || tb.includes(ta);
}

export function scoreRetrieval(strategy: Strategy = 'broad'): MetricSummary {
  const manifest = loadRetrievalManifest();
  const hosts = [...new Set(manifest.fixtures.map((f) => f.host))];
  const rows: MetricRow[] = [];

  for (const host of hosts) {
    const forHost = manifest.fixtures.filter((f) => f.host === host);
    for (const plant of PLANTS) {
      const truthRow = forHost.find((f) => f.plantId === plant.id && f.truth);
      if (!truthRow?.truth) continue; // unlabelled pairs cannot be scored
      const { listed } = truthRow.truth;
      const expected = truthRow.truth.productNames ?? [];

      const { plan, products, read } = retrieve(forHost, plant.id, strategy);
      const ranked = rankCandidates(products, plan);
      const got = ranked[0]?.name;
      const decisive = isDecisive(ranked);

      /*
       * The outcome is about CORRECTNESS only. Whether ranking could settle it
       * without a model is a separate axis (`decisive`), reported as a cost
       * rather than folded in here - mixing the two once made precision exceed
       * 100%, because a correct-but-undecided row counted in the numerator and
       * not the denominator.
       */
      let outcome: Outcome;
      if (listed) {
        /* Any judged title is a correct answer - the same plant in a different
         * pot is not a different plant. */
        outcome = !got ? 'miss' : expected.some((e) => sameProduct(got, e)) ? 'hit' : 'wrong';
      } else if (!read) {
        outcome = 'unread';
      } else {
        outcome = got ? 'noisy' : 'quiet';
      }

      rows.push({
        host,
        plantId: plant.id,
        national: NATIONAL_HOSTS.has(host),
        listed,
        expected,
        got,
        decisive,
        outcome,
      });
    }
  }

  const rate = (a: number, b: number) => (b === 0 ? 1 : a / b);
  const listedRows = rows.filter((r) => r.listed);
  const hits = listedRows.filter((r) => r.outcome === 'hit');
  const absent = rows.filter((r) => !r.listed);
  /* Everything we would put in front of a user. */
  const offered = rows.filter((r) => r.got);
  /* Of those, the ones ranking settled on its own. The rest each cost an LLM
   * call in production - a cost, not an error. */
  const undecided = offered.filter((r) => !r.decisive);
  const quiet = absent.filter((r) => r.outcome !== 'noisy');
  const nat = listedRows.filter((r) => r.national);
  const pick = listedRows.filter((r) => !r.national);

  return {
    rows,
    capturedAt: manifest.capturedAt,
    listed: listedRows.length,
    hits: hits.length,
    wrong: listedRows.filter((r) => r.outcome === 'wrong').length,
    offered: offered.length,
    absent: absent.length,
    quiet: quiet.length,
    undecided: undecided.length,
    retrieval: rate(hits.length, listedRows.length),
    precision: rate(hits.length, offered.length),
    quietRate: rate(quiet.length, absent.length),
    nationalRetrieval: rate(nat.filter((r) => r.outcome === 'hit').length, nat.length),
    pickupRetrieval: rate(pick.filter((r) => r.outcome === 'hit').length, pick.length),
  };
}
