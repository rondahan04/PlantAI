/*
 * The acceptance gate for the scrape upgrade.
 *
 * This suite asserts the retrieval metric - "given a plant name, do we get the
 * right product out of each shop" - against hand-judged truth for every
 * shop/plant pair in scraper/fixtures-retrieval. It is the number the change
 * was commissioned against, and it is deliberately not the number
 * structuredPrice.test.ts reports: that one grades price parsing on pages we
 * already fetched, scores 100%, and was blind to the failure that prompted all
 * of this.
 *
 * Offline and free - every shop response is replayed - so this runs in CI on
 * every push with no spend and no network.
 *
 * The thresholds are floors, set below the measured numbers so ordinary
 * variation does not fail a build, but high enough that a real regression
 * cannot pass. Raise them when the numbers rise; never lower one to make a
 * build green.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRetrieval } from './retrievalMetric.ts';
import { PLANTS, loadRetrievalFixtures } from './retrievalFixtures.ts';

const m = scoreRetrieval();
const pct = (r: number) => `${Math.round(r * 100)}%`;

test('the fixture set exists and carries hand-judged truth', () => {
  assert.ok(loadRetrievalFixtures().length > 100, 'capture-retrieval-fixtures.ts has not been run');
  assert.ok(m.rows.length >= 150, `only ${m.rows.length} labelled pairs - run label-retrieval-fixtures.ts`);
  assert.ok(m.listed >= 15, `only ${m.listed} pairs where a shop actually stocks the plant`);
});

/*
 * The headline number, and the reason this file exists. Before the change the
 * pipeline sent the whole plant name to search engines that AND every word, and
 * eight of nine WooCommerce shops answered "no results" to a plant they stocked.
 */
test('we retrieve the plant from at least 80% of shops that list it', () => {
  assert.ok(
    m.retrieval >= 0.8,
    `retrieval ${pct(m.retrieval)} (${m.hits}/${m.listed}) - run: npm run retrieval:score -- --verbose`
  );
});

/*
 * The risk the broad ladder introduces, and the one worth failing a build over.
 * Offering someone an Alocasia Zebrina when they asked for a Regal Shield is
 * worse than offering nothing: it is a confident wrong answer, and the user has
 * no way to tell.
 */
test('we never confidently offer the wrong plant', () => {
  const wrong = m.rows.filter((r) => r.outcome === 'wrong');
  assert.equal(
    wrong.length,
    0,
    `offered the wrong product without a model for: ${wrong.map((r) => `${r.host}/${r.plantId} (got "${r.got}")`).join('; ')}`
  );
});

test('a shop that does not stock the plant is reported as not stocking it', () => {
  // Guards the other end of the same trade-off: a ladder loose enough to answer
  // "any Alocasia" would show every shop for every query.
  assert.ok(
    m.quietRate >= 0.9,
    `quiet ${pct(m.quietRate)} (${m.quiet}/${m.absent}) - ranking is offering plants shops do not stock`
  );
});

test('what we would show a user is the right plant', () => {
  assert.ok(m.precision >= 0.9, `precision ${pct(m.precision)} (${m.hits}/${m.offered})`);
});

/*
 * The two national shippers are the entire Deliver tab. A local nursery we
 * cannot read costs the user one of many options; one of these costs them the
 * whole tab.
 */
test('the national shippers are near-perfect', () => {
  assert.ok(
    m.nationalRetrieval >= 0.9,
    `national retrieval ${pct(m.nationalRetrieval)} - al-haderech and rootine are the whole Deliver tab`
  );
});

test('pickup shops clear the 80% bar this change was commissioned against', () => {
  assert.ok(m.pickupRetrieval >= 0.8, `pickup retrieval ${pct(m.pickupRetrieval)}`);
});

/*
 * Not an accuracy claim - a cost one. Every undecided row is an LLM call in
 * production, so a change that "holds retrieval" while pushing everything into
 * the model has made the system slower and more expensive, and this is the only
 * place that would show it.
 */
test('most rows are settled without an LLM call at all', () => {
  const settled = 1 - m.undecided / m.rows.length;
  assert.ok(
    settled >= 0.9,
    `only ${pct(settled)} of rows settled locally; ${m.undecided} would each cost an LLM call`
  );
});

/*
 * The control, and the guard against a metric that cannot fail.
 *
 * Same fixtures, same truth, same ranker, same JSON routes - the ONLY change is
 * which term is sent: the whole plant name (what the pipeline did before)
 * against the genus (what it does now). Everything else held constant, so this
 * isolates the query change and nothing else. It does not measure the JSON
 * routes, which the old pipeline did not have at all; the real-world gap is
 * therefore wider than this line shows, not narrower.
 *
 * If this ever reports parity, the metric has stopped measuring anything and no
 * other assertion in this file means what it says.
 */
test('sending the genus beats sending the whole name, on identical fixtures', () => {
  const before = scoreRetrieval('full');
  assert.ok(
    m.retrieval > before.retrieval,
    `broad ${pct(m.retrieval)} vs full-phrase ${pct(before.retrieval)} - the metric is not measuring the query change`
  );
});

test('every plant in the matrix is actually exercised', () => {
  // A plant that quietly stops being scored would take its whole class of bug
  // with it - the size suffix, the Hebrew common name, the sibling cultivar.
  for (const plant of PLANTS) {
    assert.ok(
      m.rows.some((r) => r.plantId === plant.id),
      `${plant.id} is in the matrix but scored nowhere: ${plant.why}`
    );
  }
});
