#!/usr/bin/env npx tsx
/**
 * Writes ground truth into the retrieval manifest: for each (shop, plant), does
 * this shop list this plant, and under what name and price.
 *
 * WHY A MODEL AND NOT A RULE. The metric grades a string ranker. Deriving the
 * truth with string rules would grade that ranker against a sibling of itself
 * and report agreement as accuracy. So the judge here is given the shop's
 * product titles - ALL of them, read straight out of the captured JSON without
 * passing through our mapper - and asked a question about plants, not about
 * strings: is any of these that plant. Its answer is independent of every
 * threshold, fold and penalty in scraper/queryPlan.ts, which is the only way
 * the resulting number means anything.
 *
 * The judge is asked to be strict about cultivars, because that is the
 * distinction the whole change risks blurring: an Alocasia Zebrina is NOT an
 * Alocasia Regal Shield, and a truth set that let those pass would hide exactly
 * the regression we are most afraid of.
 *
 * Idempotent and re-runnable. Already-labelled pairs are skipped unless --force.
 *
 *   npx tsx scripts/label-retrieval-fixtures.ts
 *   npx tsx scripts/label-retrieval-fixtures.ts --force al-haderech.co.il
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadEnv, env, callOpenAIJson } from '../scraper/core.ts';
import {
  PLANTS,
  RETRIEVAL_FIXTURE_DIR,
  loadRetrievalManifest,
  readRetrievalFixture,
  rawTitles,
  type RetrievalFixture,
} from '../scraper/retrievalFixtures.ts';
import { extractStructuredProducts } from '../scraper/structuredPrice.ts';

const ROOT = path.join(__dirname, '..');
loadEnv(path.join(ROOT, '.env'));
const OPENAI_KEY = env('OPENAI_API_KEY');
if (!OPENAI_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyHost = args.find((a) => !a.startsWith('--'));

/* Titles the shop showed for this plant, across every captured body that could
 * contain them. A Shopify catalogue is one body for all twelve plants; a Woo
 * shop has one body per plant per term variant. */
function titlesFor(fixtures: RetrievalFixture[]): { titles: string[]; priceOf: Map<string, number> } {
  const titles = new Set<string>();
  const priceOf = new Map<string, number>();
  for (const f of fixtures) {
    const body = readRetrievalFixture(f.bodyFile);
    if (!body) continue;
    for (const t of rawTitles(body, f.route)) titles.add(t);
    /*
     * Prices come from our own mapper, unlike the titles. That is acceptable
     * where the titles are not: the judge decides WHICH product is the plant,
     * and the price is then read off that product - so a mapping bug shows up
     * as a wrong price in the report rather than as a truth the metric was
     * graded against.
     */
    if (f.route === 'html') {
      for (const p of extractStructuredProducts(body, f.requestUrl)) {
        titles.add(p.name);
        priceOf.set(p.name, p.price);
      }
    } else {
      try {
        const parsed = JSON.parse(body);
        const rows = Array.isArray(parsed) ? parsed : parsed?.products;
        for (const r of rows ?? []) {
          const name = r?.name ?? r?.title;
          const minor = Number(r?.prices?.currency_minor_unit);
          const raw = r?.prices?.price ?? r?.variants?.[0]?.price;
          const n = Number.parseFloat(String(raw ?? '').replace(/,/g, ''));
          if (typeof name === 'string' && Number.isFinite(n) && n > 0) {
            priceOf.set(name, r?.prices ? n / 10 ** (minor || 0) : n);
          }
        }
      } catch {
        /* a body that will not parse contributes no prices */
      }
    }
  }
  return { titles: [...titles], priceOf };
}

async function judge(
  plantLatin: string,
  plantHebrew: string,
  titles: string[]
): Promise<{ indices: number[]; why: string }> {
  if (titles.length === 0) return { indices: [], why: 'the shop returned no products at all' };
  /* Numbered so the answer is an index rather than a string the model might
   * paraphrase - a paraphrased title would not match any real product. */
  const list = titles.map((t, i) => `${i}. ${t}`).join('\n');
  const prompt = `You are labelling ground truth for a plant-shop search benchmark. Be strict.

The plant we want: "${plantLatin}" (in Hebrew, Israeli nurseries write it roughly as "${plantHebrew}").

Below is EVERY product title one Israeli nursery listed. Decide whether any of them IS that exact plant.

Rules:
- The GENUS must match. A Monstera is not an Alocasia.
- The CULTIVAR must match. "Alocasia Zebrina" is NOT "Alocasia Regal Shield". If we asked for a specific cultivar and the shop only has other cultivars of the same genus, the answer is null.
- If we asked for only a genus (e.g. just "Monstera"), then ANY product of that genus counts.
- Pot sizes, litres, "מבצע" (sale) and similar noise in the title are irrelevant - ignore them.
- A pot, a fertiliser or a tool that merely mentions the plant is NOT the plant.
- List EVERY title that is this plant, not just one. Shops list the same plant in several pot sizes and any of them is a correct answer.

Return ONLY JSON: { "indices": [<numbers of every matching title>], "why": "<short reason>" }
Return { "indices": [], "why": "..." } if none of them is this plant.

Titles:
${list}`;

  try {
    const out = await callOpenAIJson(prompt, OPENAI_KEY!, 2500);
    const raw = Array.isArray(out?.indices) ? out.indices : [];
    const indices = [
      ...new Set(
        raw.filter((n: unknown): n is number => typeof n === 'number' && n >= 0 && n < titles.length)
      ),
    ] as number[];
    return { indices, why: typeof out?.why === 'string' ? out.why : '' };
  } catch (err) {
    return { indices: [], why: `judge failed: ${(err as Error).message}` };
  }
}

async function main(): Promise<void> {
  const manifest = loadRetrievalManifest();
  if (!manifest.fixtures.length) {
    console.error('No fixtures. Run scripts/capture-retrieval-fixtures.ts first.');
    process.exit(1);
  }

  const hosts = [...new Set(manifest.fixtures.map((f) => f.host))].filter(
    (h) => !onlyHost || h === onlyHost
  );

  let labelled = 0;
  for (const host of hosts) {
    const forHost = manifest.fixtures.filter((f) => f.host === host);
    console.log(`\n${host}`);
    for (const plant of PLANTS) {
      /* A Shopify catalogue carries no plantId - it answers for every plant, so
       * it is in scope for all of them. */
      const relevant = forHost.filter((f) => f.plantId === plant.id || f.plantId === null);
      if (!relevant.length) continue;
      if (!force && relevant.every((f) => f.truth !== undefined)) continue;

      const { titles, priceOf } = titlesFor(relevant);
      const { indices, why } = await judge(plant.latin, plant.hebrew, titles);
      const productNames = indices.map((i) => titles[i]);
      const first = productNames[0];
      const truth = {
        listed: productNames.length > 0,
        ...(productNames.length ? { productNames } : {}),
        ...(first && priceOf.has(first) ? { price: priceOf.get(first)! } : {}),
      };
      /* Written onto the per-plant rows only. A catalogue row answers for all
       * twelve plants, so it cannot carry one plant's truth. */
      for (const f of relevant) if (f.plantId === plant.id) f.truth = truth;
      labelled++;
      console.log(
        `  ${plant.id.padEnd(24)} ${
          truth.listed
            ? `LISTED  ${first}${productNames.length > 1 ? ` (+${productNames.length - 1} more)` : ''}`
            : `absent  (${why})`
        }`
      );
    }
  }

  fs.writeFileSync(
    path.join(RETRIEVAL_FIXTURE_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  const total = manifest.fixtures.filter((f) => f.truth !== undefined).length;
  console.log(`\nlabelled ${labelled} pairs this run; ${total} fixture rows now carry truth`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
