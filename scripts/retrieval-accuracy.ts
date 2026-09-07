#!/usr/bin/env npx tsx
/**
 * The acceptance metric: given a plant name, do we retrieve the right product
 * from each shop?
 *
 * This is the number the scrape upgrade is judged on, and it is deliberately
 * NOT the one scripts/price-accuracy.ts reports. That one grades price parsing
 * on pages we already fetched, scores 100%, and is blind to the failure the
 * whole change is about: asking al-haderech for "אלוקסיה ריגל שילד" returned a
 * page with no results at all, so there were no prices to misread and nothing
 * looked wrong.
 *
 * Offline and free. Every shop response is replayed from
 * scraper/fixtures-retrieval, so this can gate CI and be run as often as you
 * like. The scoring lives in scraper/retrievalMetric.ts, which
 * scraper/retrieval.test.ts asserts against - the report and the gate must
 * never be able to disagree.
 *
 * WHAT IT DOES AND DOES NOT MEASURE. It runs the real retrieval path - the
 * platformApi mappers, the query ladder, ranking - and stops where the model
 * would start. So it grades the deterministic half. Rows it cannot settle are
 * reported as `undecided`: those are what production sends to the LLM, and a
 * change that moves work INTO that column is making the system slower and more
 * expensive even when `retrieval` holds.
 *
 *   npx tsx scripts/retrieval-accuracy.ts
 *   npx tsx scripts/retrieval-accuracy.ts --verbose
 */

import { scoreRetrieval } from '../scraper/retrievalMetric.ts';

const verbose = process.argv.includes('--verbose');

function main(): void {
  const m = scoreRetrieval();
  if (!m.rows.length) {
    console.error(
      'No labelled fixtures. Run scripts/capture-retrieval-fixtures.ts then scripts/label-retrieval-fixtures.ts.'
    );
    process.exit(1);
  }

  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const pct = (r: number) => `${Math.round(r * 100)}%`.padStart(5);

  if (verbose) {
    console.log(`${pad('host', 24)} ${pad('plant', 22)} ${pad('outcome', 10)} detail`);
    console.log('-'.repeat(110));
    for (const r of m.rows) {
      if (r.outcome === 'quiet') continue; // the silent majority, and correct
      const want = r.expected[0] ?? '';
      const detail =
        r.outcome === 'hit'
          ? r.got!
          : r.outcome === 'wrong'
            ? `got "${r.got}" want "${want}"`
            : r.outcome === 'miss'
              ? `want "${want}"`
              : r.outcome === 'noisy'
                ? `offered "${r.got}" for a plant this shop does not stock`
                : '';
      console.log(`${pad(r.host, 24)} ${pad(r.plantId, 22)} ${pad(r.outcome, 10)} ${detail}`);
    }
    console.log('');
  }

  console.log('-'.repeat(76));
  console.log(
    `retrieval  ${m.hits}/${m.listed} plants retrieved where the shop lists them (${pct(m.retrieval)})`
  );
  console.log(
    `precision  ${m.hits}/${m.offered} of what we would show a user is the right plant (${pct(m.precision)})`
  );
  console.log(
    `quiet      ${m.quiet}/${m.absent} shops correctly reported as not stocking it (${pct(m.quietRate)})`
  );
  console.log(`undecided  ${m.undecided}/${m.rows.length} rows ranking could not settle - these cost an LLM call`);
  if (m.wrong) {
    console.log(
      `\n⚠  ${m.wrong} WRONG products offered without a model - see --verbose. This is the number that must be zero.`
    );
  }
  console.log('-'.repeat(76));
  console.log(`national shippers  retrieval ${pct(m.nationalRetrieval)}`);
  console.log(`pickup shops       retrieval ${pct(m.pickupRetrieval)}`);

  /*
   * The control, on the same fixtures and the same truth: what the pipeline
   * scored when it sent the whole plant name to each shop's search. Printed
   * every run because a metric that only ever says 100% is indistinguishable
   * from a broken one, and this line is what shows it can move.
   */
  const before = scoreRetrieval('full');
  console.log(
    `\nfull-phrase search (the old behaviour, same fixtures): retrieval ${pct(before.retrieval)} (${before.hits}/${before.listed})`
  );
  console.log(`\ncaptured ${m.capturedAt.slice(0, 10)}; ${m.rows.length} labelled shop/plant pairs`);
}

main();
