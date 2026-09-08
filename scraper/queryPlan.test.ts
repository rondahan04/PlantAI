/*
 * Tests for query planning and candidate ranking.
 *
 * Every case here is a real string from a real Israeli nursery catalogue, and
 * most name the shop they came from. The two behaviours worth breaking a build
 * over are at the ends of the scale: an exact cultivar with a pot size appended
 * must score as an exact match, and a SIBLING cultivar of the same genus must
 * not survive ranking at all. The second is the failure mode a broad query
 * ladder introduces, so it is tested harder than the first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHebrew,
  stripSizeTokens,
  canonical,
  buildQueryPlan,
  scoreCandidate,
  rankCandidates,
  isDecisive,
  ladderTerms,
  STRONG_MATCH,
  WEAK_MATCH,
} from './queryPlan.ts';
import type { StructuredProduct } from './structuredPrice.ts';

const REGAL = buildQueryPlan({
  original: 'Alocasia Regal Shield',
  hebrew: 'אלוקסיה ריגל שילד',
  latin: 'Alocasia Regal Shield',
});
const MONSTERA = buildQueryPlan({
  original: 'Monstera deliciosa',
  hebrew: 'מונסטרה',
  latin: 'Monstera deliciosa',
});

const product = (name: string, price = 100): StructuredProduct => ({
  name,
  price,
  currency: 'ILS',
  availability: 'in_stock',
  source: 'api',
});

// --- normalization ----------------------------------------------------------

test('final letters fold, so a token can be found inside a longer word', () => {
  assert.equal(normalizeHebrew('שילדם'), normalizeHebrew('שילדמ'));
  assert.equal(normalizeHebrew('כהן'), 'כהנ');
});

test('doubled vav and yod fold - סנסוויריה and סנסויריה are one plant', () => {
  assert.equal(normalizeHebrew('סנסוויריה'), normalizeHebrew('סנסויריה'));
});

test('tet and tav fold - קלתיאה and קלטיאה are one plant', () => {
  assert.equal(normalizeHebrew('קלתיאה'), normalizeHebrew('קלטיאה'));
});

test('geresh spellings collapse - ג׳קלין, ג\'קלין and גקלין are one name', () => {
  assert.equal(normalizeHebrew('ג׳קלין'), normalizeHebrew("ג'קלין"));
  assert.equal(normalizeHebrew('ג׳קלין'), 'גקלינ');
});

test('bidi marks and niqqud are invisible and must not affect comparison', () => {
  assert.equal(normalizeHebrew('‏אלוקסיה‎'), 'אלוקסיה');
});

test('pot sizes are the shop\'s business, not the plant\'s', () => {
  // decogarden.co.il lists exactly this.
  assert.equal(stripSizeTokens('אלוקסיה ריגל שילד 10 ליטר'), 'אלוקסיה ריגל שילד');
  // al-haderech.co.il prefixes sale items.
  assert.deepEqual(canonical('מבצע אלוקסיה זברינה'), canonical('אלוקסיה זברינה'));
});

// --- the ladder -------------------------------------------------------------

test('the ladder runs narrow to broad and ends at the genus', () => {
  assert.equal(REGAL.terms[0], 'אלוקסיה ריגל שילד');
  assert.ok(REGAL.terms.includes('אלוקסיה'));
  assert.ok(
    REGAL.terms.indexOf('אלוקסיה ריגל שילד') < REGAL.terms.indexOf('אלוקסיה'),
    'the precise term must be tried before the broad one'
  );
});

test('a one-word plant does not ask the same question four times', () => {
  // Every rung collapses to "מונסטרה"; only the Latin genus is genuinely different.
  assert.deepEqual(MONSTERA.terms, ['מונסטרה', 'Monstera']);
});

test('the genus is split off as the core, the rest is the cultivar', () => {
  assert.deepEqual(REGAL.hebrewTokens.core, ['אלוקסיה']);
  assert.deepEqual(REGAL.hebrewTokens.cultivar, ['ריגל', 'שילד']);
});

// --- scoring ----------------------------------------------------------------

test('the exact plant with a pot size appended is an exact match', () => {
  // The literal decogarden.co.il title for the plant this whole change is about.
  assert.equal(scoreCandidate('אלוקסיה ריגל שילד 10 ליטר', REGAL), 1);
});

test('a different genus scores zero, whatever else it shares', () => {
  assert.equal(scoreCandidate('מונסטרה דליסיוזה', REGAL), 0);
});

test('a SIBLING cultivar is rejected outright - this is the broad-query risk', () => {
  // h-shtilshop.co.il and al-haderech.co.il both stock these; asking for Regal
  // Shield and being handed a Zebrina is the exact way a broad ladder lies.
  for (const sibling of ['אלוקסיה זברינה', 'אלוקסיה פולי', 'אלוקסיה דרגון סקייל אלבו']) {
    assert.ok(
      scoreCandidate(sibling, REGAL) < WEAK_MATCH,
      `${sibling} scored ${scoreCandidate(sibling, REGAL)} and would have been offered`
    );
  }
});

test('a partial cultivar match lands in the middle, for the model to adjudicate', () => {
  const s = scoreCandidate('אלוקסיה שילד', REGAL);
  assert.ok(s >= WEAK_MATCH && s < STRONG_MATCH, `expected an undecided score, got ${s}`);
});

test('a genus-only query is genuinely answered by any cultivar', () => {
  assert.equal(scoreCandidate('מונסטרה דליסיוזה', MONSTERA), 1);
  assert.equal(scoreCandidate('מונסטרה אדנסוני עציץ 3 ליטר', MONSTERA), 1);
});

test('a Latin title is scored against the Latin name, not against zero', () => {
  assert.equal(scoreCandidate('Alocasia Regal Shield', REGAL), 1);
  assert.ok(scoreCandidate('Alocasia Zebrina', REGAL) < WEAK_MATCH);
});

test('a shop that spells the cultivar differently still matches', () => {
  // ריגל / רגל, and ט for ת elsewhere in the same catalogue.
  assert.ok(scoreCandidate('אלוקסיה ריגל-שילד', REGAL) >= STRONG_MATCH);
});

test('a plant sold under its Hebrew NAME is matched, not just its transliteration', () => {
  // h-shtilshop.co.il lists Ficus lyrata as "פיקוס כינורי". No folding rule
  // turns ליראטה into כינורי, so without altTokens the ladder finds this
  // product and the ranker then discards it for carrying a word we never asked
  // for - a shop reported as not stocking a plant it has on the shelf.
  const withAlt = buildQueryPlan({
    original: 'Ficus lyrata',
    hebrew: 'פיקוס ליראטה',
    latin: 'Ficus lyrata',
    altSpellings: ['פיקוס כינורי'],
  });
  const withoutAlt = buildQueryPlan({
    original: 'Ficus lyrata',
    hebrew: 'פיקוס ליראטה',
    latin: 'Ficus lyrata',
  });
  assert.ok(scoreCandidate('פיקוס כינורי', withAlt) >= STRONG_MATCH);
  assert.ok(scoreCandidate('פיקוס כינורי', withoutAlt) < WEAK_MATCH);
});

test('an alternate name is a second rung on the ladder, not just a scoring aid', () => {
  // A shop that files Sansevieria under לשון החמות answers nothing to
  // "סנסוויריה", however it is spelled.
  const plan = buildQueryPlan({
    original: 'Sansevieria trifasciata',
    hebrew: 'סנסוויריה',
    latin: 'Sansevieria trifasciata',
    altSpellings: ['לשון החמות'],
  });
  // The name AS WRITTEN. A folded token (לשונ) is not a string any shop's
  // search box will ever match.
  assert.deepEqual(ladderTerms(plan), ['סנסוויריה', 'לשון החמות']);
});

/*
 * Found live, not in a fixture. planQuery returns "מונסטרה" among the alternate
 * names for Monstera deliciosa - correct, shops do sell it that way - and
 * scoring takes the best match across every name, so a bare genus made every
 * cultivar on the shelf an exact match. al-haderech duly offered "מונסטרה
 * מאנקי" (adansonii) at 1.00, its cheapest row, with no model asked.
 */
test('a genus-only alternate name does not make every cultivar an exact match', () => {
  const plan = buildQueryPlan({
    original: 'Monstera deliciosa',
    hebrew: 'מונסטרה דליסיוזה',
    latin: 'Monstera deliciosa',
    altSpellings: ['מונסטרה דליסיוסה', 'מונסטרה'],
  });
  assert.ok(
    scoreCandidate('מונסטרה מאנקי', plan) < WEAK_MATCH,
    'an adansonii is not a deliciosa, whatever the shop calls the genus'
  );
  // The real spelling variant is still an exact match, which is the whole point
  // of keeping alternate names at all.
  assert.equal(scoreCandidate('מונסטרה דליסיוסה ע׳ 12', plan), 1);
  // And the bare genus is still a search term, because shops do file it so.
  assert.ok(plan.altNames.includes('מונסטרה'));
});

test('a genus-only query keeps its genus-only alternates', () => {
  // Nothing is lost by dropping a bare genus from a query that asks for a
  // cultivar; a query that asks for none has only the genus to match with.
  const plan = buildQueryPlan({
    original: 'Zamioculcas',
    hebrew: 'זמיוקולקס',
    latin: 'Zamioculcas',
    altSpellings: ['זמיה'],
  });
  assert.equal(scoreCandidate('זמיה', plan), 1);
});

test('an alternate name never overrides a genuine mismatch', () => {
  const plan = buildQueryPlan({
    original: 'Ficus lyrata',
    hebrew: 'פיקוס ליראטה',
    latin: 'Ficus lyrata',
    altSpellings: ['פיקוס כינורי'],
  });
  assert.equal(scoreCandidate('מונסטרה דליסיוזה', plan), 0);
});

// --- ranking ----------------------------------------------------------------

/*
 * Ranking's job is now the genus bar and the ORDER, not the final cut. A
 * sibling cultivar stays in the list - the adjudicating model is asked about it
 * - but it must sit below WEAK_MATCH, which is the bar for reaching a user with
 * no model asked, and it must never outrank the plant itself.
 */
test('ranking drops everything that is not even this genus', () => {
  const shelf = [
    product('אלוקסיה זברינה', 385),
    product('אלוקסיה ריגל שילד 10 ליטר', 249),
    product('אלוקסיה פולי', 69),
    product('מונסטרה דליסיוזה', 120),
  ];
  const ranked = rankCandidates(shelf, REGAL);
  assert.ok(!ranked.some((r) => r.name.includes('מונסטרה')), 'a Monstera is not an Alocasia');
  assert.equal(ranked[0].name, 'אלוקסיה ריגל שילד 10 ליטר');
  for (const sibling of ranked.slice(1)) {
    assert.ok(
      sibling.score < WEAK_MATCH,
      `"${sibling.name}" scored ${sibling.score} - a sibling cultivar must never be shown on ranking alone`
    );
  }
});

/*
 * The failure this change was made for: there is no single Hebrew spelling of a
 * Latin species name, and an exact-token cut reported shops as not stocking
 * plants they had on the shelf.
 */
test('a differently transliterated cultivar is still the same plant', () => {
  const plan = buildQueryPlan({
    original: 'Monstera deliciosa',
    hebrew: 'מונסטרה דלישיוזה',
    latin: 'Monstera deliciosa',
  });
  const ranked = rankCandidates([product('מונסטרה דליסיוסה ע׳ 12', 39)], plan);
  assert.equal(ranked.length, 1);
  assert.ok(
    ranked[0].score >= WEAK_MATCH,
    `spelling variant scored ${ranked[0].score} - it is the plant that was asked for`
  );
});

test('a plain species listing is a candidate for a species query', () => {
  // "מונסטרה בכלי קרמיקה" is a Monstera deliciosa in a pot. It named no
  // cultivar, so it cannot be excluded on the strength of one it does not have.
  const plan = buildQueryPlan({
    original: 'Monstera deliciosa',
    hebrew: 'מונסטרה דליסיוסה',
    latin: 'Monstera deliciosa',
  });
  const ranked = rankCandidates([product('מונסטרה בכלי קרמיקה', 99)], plan);
  assert.equal(ranked.length, 1, 'a plain genus listing must reach the adjudicating model');
});

test('equal scores break by price, because the cheapest is the answer asked for', () => {
  const ranked = rankCandidates(
    [product('מונסטרה גדולה', 300), product('מונסטרה קטנה', 80)],
    MONSTERA
  );
  assert.equal(ranked[0].price, 80);
});

test('a lone strong match is decisive and needs no model', () => {
  assert.ok(isDecisive(rankCandidates([product('אלוקסיה ריגל שילד'), product('אלוקסיה זברינה')], REGAL)));
});

test('nothing found is never decisive', () => {
  assert.equal(isDecisive(rankCandidates([product('אלוקסיה זברינה')], REGAL)), false);
});

test('a strong row next to a merely-plausible one is NOT decisive', () => {
  // Same genus, one cultivar word each way: the title text does not actually
  // settle it, so the model has to look.
  const ranked = rankCandidates([product('אלוקסיה ריגל שילד'), product('אלוקסיה שילד')], REGAL);
  assert.equal(ranked.length, 2);
  assert.equal(isDecisive(ranked), false);
});
