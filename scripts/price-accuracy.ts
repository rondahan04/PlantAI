#!/usr/bin/env npx tsx
/**
 * Price-accuracy report over the captured fixtures (SCRAPE-ACCURACY-PLAN
 * Phase 0). Offline: reads scraper/fixtures/, spends nothing, calls no model.
 *
 * The metric is graded against the hand-written labels in the manifest (see
 * scripts/label-price-fixtures.ts), never against the extractor's own output.
 * Two numbers, because they fail in opposite directions:
 *
 *   recall     of the pages that DO show priced products, how many did we read?
 *   quiet      of the pages that show NO products, how many did we correctly
 *              report nothing for? A reader that invents prices on an empty
 *              search page is worse than useless - it puts a shop in front of
 *              the user that does not sell the plant.
 *
 * The markdown column is shown for contrast only. It counts price-bearing lines
 * in what the LLM is handed, and it is NOT an accuracy figure: on a page with no
 * results those lines are an empty cart total ("₪0.00 עגלת קניות") and a
 * free-shipping threshold, which is exactly the noise the model then has to
 * reason its way out of.
 *
 *   npx tsx scripts/price-accuracy.ts
 */

import { priceFocusedExcerpt } from '../scraper/core.ts';
import { extractStructuredProducts, hasCurrency } from '../scraper/structuredPrice.ts';
import { labelledFixtures, readFixture } from '../scraper/fixtures.ts';

/* Price-bearing lines in the model's input - noise included. */
function pricedExcerptLines(md: string): number {
  if (!md) return 0;
  return priceFocusedExcerpt(md).split('\n').filter(hasCurrency).length;
}

function main(): void {
  const manifest = labelledFixtures();
  const rows: string[] = [];
  let withProducts = 0;
  let recalled = 0;
  let empty = 0;
  let quiet = 0;
  let samples = 0;
  let samplesOk = 0;

  for (const f of manifest) {
    const md = readFixture(f.markdownFile);
    const html = readFixture(f.htmlFile);
    const mdPrices = pricedExcerptLines(md);
    const found = extractStructuredProducts(html, f.url ?? '');

    let verdict: string;
    if (f.pricedProducts > 0) {
      withProducts++;
      if (found.length > 0) recalled++;
      verdict = found.length > 0 ? 'ok' : 'MISS';
    } else {
      empty++;
      if (found.length === 0) quiet++;
      verdict = found.length === 0 ? 'ok' : 'FALSE POSITIVE';
    }

    if (f.sample) {
      samples++;
      const hit = found.find((p) => p.name.includes(f.sample!.name));
      const priceOk = hit ? Math.abs(hit.price - f.sample.price) < 0.005 : false;
      if (priceOk) samplesOk++;
      else verdict += hit ? ` price ${hit.price} != ${f.sample.price}` : ' sample not found';
    }

    rows.push(
      `${f.host.padEnd(24)} ${f.slug.padEnd(9)} ${String(f.pricedProducts).padStart(5)} ` +
        `${String(found.length).padStart(7)} ${String(mdPrices).padStart(5)}  ${verdict}`
    );
  }

  console.log(`${'host'.padEnd(24)} ${'query'.padEnd(9)}  true   found    md  verdict`);
  console.log('-'.repeat(84));
  for (const r of rows) console.log(r);
  console.log('-'.repeat(84));
  const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) : '-');
  console.log(`recall  ${recalled}/${withProducts} pages with products read (${pct(recalled, withProducts)}%)`);
  console.log(`quiet   ${quiet}/${empty} empty pages correctly reported empty (${pct(quiet, empty)}%)`);
  console.log(`prices  ${samplesOk}/${samples} verified name+price pairs exact (${pct(samplesOk, samples)}%)`);
}

main();
