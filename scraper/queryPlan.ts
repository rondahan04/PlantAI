/*
 * Query planning and candidate ranking: ask the shop a question it can answer,
 * then decide for ourselves which of its answers is the plant.
 *
 * THE BUG THIS EXISTS TO FIX. The pipeline translated a plant name once and
 * typed the whole thing into every shop's search box. WordPress `?s=` and the
 * WooCommerce Store API both require EVERY word to appear, so measured across
 * the nine WooCommerce nurseries we know:
 *
 *   "אלוקסיה ריגל שילד"   real results on 1 of 9 - eight answered no-results
 *   "אלוקסיה"             real results on 5 of 9
 *
 * The shops were not missing the plant. We were asking a question their search
 * engines cannot answer. al-haderech stocks 64 Alocasia; we asked for a
 * three-word string and it said no.
 *
 * THE FIX, IN ONE LINE. Send the genus, rank locally. A shop's search is good
 * at "show me the Alocasia shelf" and bad at "show me this exact cultivar"; we
 * are the opposite, because we can see all the candidates at once and compare
 * them character by character. So the request gets broader and the filtering
 * moves here. It costs the same number of requests it always did.
 *
 * WHY THE SCORING IS ARITHMETIC AND NOT A DISTANCE METRIC. Every rule below has
 * to be explainable when it gets something wrong, because the failure mode of a
 * broad query is confidently offering the wrong cultivar - telling someone a
 * shop has their Regal Shield when it has a Zebrina. Edit distance would make
 * those two look similar. Token coverage plus a penalty for foreign cultivar
 * words makes them look as different as they are.
 *
 * Everything here is pure: strings in, scores out. No network, no model.
 */

import type { StructuredProduct } from './structuredPrice.ts';

/* Full cultivar coverage and nothing foreign: we are sure, and the LLM has
 * nothing to add that the shop's own catalogue has not already said. */
export const STRONG_MATCH = 0.85;
/* Below this a row is not a candidate at all - not shown, not sent to a model.
 * This is the threshold that stops "any Alocasia" answering for "Regal Shield". */
export const WEAK_MATCH = 0.45;

export interface QueryTokens {
  /* The genus. Required in a title for it to be a candidate at all. */
  core: string[];
  /* Cultivar words: "ריגל", "שילד". Coverage of these IS the score. */
  cultivar: string[];
}

export interface QueryPlan {
  /* What the user typed, or what the diagnosis produced. */
  original: string;
  /* Full Hebrew name, as the transliteration step gives it. */
  hebrew: string;
  /* Latin/English form, for shops that list in Latin. */
  latin: string;
  /*
   * What to actually send, narrow first. The ladder stops at the first rung
   * that returns rows; the narrow rungs are cheap to try and precise when they
   * land, and the broad rung is the one that reliably returns a shelf.
   */
  terms: string[];
  hebrewTokens: QueryTokens;
  latinTokens: QueryTokens;
  /*
   * Other names the same plant is sold under, tokenized the same way.
   *
   * Not a nicety. Some shops use the established Hebrew name rather than a
   * transliteration - h-shtilshop lists Ficus lyrata as "פיקוס כינורי" - and
   * that is not a spelling variant: no folding rule will ever turn ליראטה into
   * כינורי. Without these the ladder would find the product and the ranker
   * would then throw it away for carrying a word we did not ask for.
   */
  altTokens: QueryTokens[];
  /* The alternate names as WRITTEN. `altTokens` is folded for comparison, and a
   * folded token is not a string any shop's search box will match - לשונ is not
   * לשון - so the ladder has to send these instead. */
  altNames: string[];
}

// --- normalization -----------------------------------------------------------

/*
 * Fold away the ways two shops can spell the same transliterated name.
 *
 * Israeli nurseries transliterate Latin binomials by ear, so the same plant is
 * סנסוויריה in one catalogue and סנסיווריה in the next, קלתיאה here and קלטיאה
 * there. None of that is a different plant, and comparing raw strings makes it
 * look like one.
 *
 * Deliberately NOT folded: ק/כ and ס/ש. Those distinguish real Hebrew words,
 * and the gain on plant names is small enough not to be worth conflating זית
 * with something else.
 */
export function normalizeHebrew(s: string): string {
  return (
    (s || '')
      .normalize('NFKD')
      /* Niqqud, cantillation and the bidi control marks Hebrew pages are full
       * of. Invisible characters that make two identical strings compare
       * unequal are the worst kind of bug to look at. */
      .replace(/[֑-ׇ]/g, '')
      .replace(/[‎‏‪-‮⁦-⁩]/g, '')
      /* Geresh and gershayim, in both their typographic and ASCII spellings:
       * ג'קלין and ג׳קלין and ג'קלין are one name. */
      .replace(/["'׳״‘’“”]/g, '')
      /* Final forms are positional, not semantic: a word only ends in ם because
       * it ended there. Matching a token inside a longer string has to see past
       * that. */
      .replace(/ם/g, 'מ')
      .replace(/ן/g, 'נ')
      .replace(/ץ/g, 'צ')
      .replace(/ף/g, 'פ')
      .replace(/ך/g, 'כ')
      /* ט and ת are the same sound and are chosen arbitrarily in
       * transliteration: קלתיאה / קלטיאה. */
      .replace(/ט/g, 'ת')
      /* Doubled mater lectionis marks a consonant in Hebrew spelling and is
       * optional in transliteration: סנסוויריה ≡ סנסויריה. */
      .replace(/וו+/g, 'ו')
      .replace(/יי+/g, 'י')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/*
 * Packaging and size words, which are never part of a plant's identity.
 *
 * decogarden lists the plant we could not find as "אלוקסיה ריגל שילד 10 ליטר".
 * The pot size is the shop's business, not the plant's, and leaving it in makes
 * a perfect match look like a partial one - and worse, makes "10" a token that
 * could match some other product's "10".
 */
const SIZE_WORDS =
  /(?:ליטר|ליטרים|לטר|סמ|ס"מ|מ"ר|קוטר|גובה|עציצ|עציץ|אדנית|כד|שתיל|שתילים|מבצע|חדש|גדול|קטנ|קטן|בינוני|בייבי|ענק|מארז|יחידה|pot|cm|mm|litre|liter|size|small|medium|large|baby|new|sale)/gi;

export function stripSizeTokens(s: string): string {
  return (s || '')
    .replace(SIZE_WORDS, ' ')
    /* Bare numbers, including decimals: a size that lost its unit is still a
     * size. Latin cultivar names never carry digits. */
    .replace(/\d+(?:[.,]\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Words worth comparing. Single characters are dropped: they carry no evidence
 * and match everything. */
export function tokenize(s: string): string[] {
  return (s || '')
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/*
 * One pipeline for both sides of every comparison, so a title and a query are
 * never normalized differently.
 *
 * Sizes are stripped BEFORE normalizing, and the order is load-bearing:
 * normalizeHebrew folds ט into ת, which turns ליטר into ליתר and hides it from
 * the size-word list. Caught by the decogarden title "אלוקסיה ריגל שילד 10
 * ליטר" scoring 0.8 instead of an exact 1.
 */
export function canonical(s: string): string[] {
  return tokenize(normalizeHebrew(stripSizeTokens(s)));
}

const HEBREW_RE = /[֐-׿]/;
export function hasHebrew(s: string): boolean {
  return HEBREW_RE.test(s || '');
}

// --- the plan ----------------------------------------------------------------

/*
 * Split a name into "which plant family" and "which one of those".
 *
 * The genus leads in both languages we care about - "Alocasia Regal Shield",
 * "אלוקסיה ריגל שילד" - so the first token is the core and the rest describe
 * the cultivar. A one-word name has no cultivar, which is a meaningful state
 * and not an empty one: it means any member of the genus is a correct answer.
 */
function splitTokens(name: string): QueryTokens {
  const tokens = canonical(name);
  return { core: tokens.slice(0, 1), cultivar: tokens.slice(1) };
}

export function buildQueryPlan(opts: {
  original: string;
  hebrew: string;
  latin?: string;
  /* Alternate transliterations from the planning call, tried after the genus. */
  altSpellings?: string[];
}): QueryPlan {
  const original = (opts.original || '').trim();
  const hebrew = (opts.hebrew || '').trim() || original;
  const latin = (opts.latin || '').trim() || (hasHebrew(original) ? '' : original);

  const hebrewTokens = splitTokens(hebrew);
  const latinTokens = splitTokens(latin);

  /*
   * The ladder, narrow to broad. The narrow rungs are here because when a shop
   * CAN answer the precise question the answer needs no adjudication at all;
   * the genus rung is the one that reliably returns rows. Latin last, for the
   * shops that keep binomials.
   *
   * De-duplicated because a one-word plant collapses every rung into the same
   * string, and asking the same shop the same question four times would be the
   * cost of the ladder with none of the benefit.
   */
  const words = hebrew.split(/\s+/).filter(Boolean);
  const rungs = [
    hebrew,
    /* Drop the last word: shops abbreviate long cultivar names more often than
     * they abbreviate the genus. */
    words.length > 2 ? words.slice(0, -1).join(' ') : '',
    /* The genus, in the shop's own spelling of it. */
    words[0] ?? '',
    ...(opts.altSpellings ?? []),
    latin.split(/\s+/)[0] ?? '',
  ];

  const seen = new Set<string>();
  const terms = rungs
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .filter((t) => {
      const key = normalizeHebrew(t);
      return seen.has(key) ? false : (seen.add(key), true);
    });

  const altNames = (opts.altSpellings ?? []).map((s) => s.trim()).filter(Boolean);
  const altTokens = altNames.map(splitTokens).filter((t) => t.core.length > 0);

  return { original, hebrew, latin, terms, hebrewTokens, latinTokens, altTokens, altNames };
}

/* The rung to send first when only one request is affordable. The genus is what
 * a shop's search can actually answer, so it is the default, not a fallback. */
export function broadTerm(plan: QueryPlan): string {
  return plan.hebrew.split(/\s+/).filter(Boolean)[0] || plan.terms[0] || plan.original;
}

/*
 * What to send a per-query search endpoint, in order, stopping at the first
 * rung that returns rows.
 *
 * Capped at two requests on purpose. The genus is what the shop's search can
 * answer and it lands on the large majority of hosts; the Latin genus is the
 * one genuinely different question worth a second request, for shops that keep
 * binomials. A third rung would mostly re-ask the same question in a spelling
 * the shop does not use, and a fan-out pays that cost once per host.
 */
export function ladderTerms(plan: QueryPlan, max = 2): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  /*
   * Genus first, then the plant's OTHER Hebrew name, then Latin.
   *
   * The second rung is not a spelling retry - it is a different word. A shop
   * that stocks Sansevieria but files it as "לשון החמות" answers nothing to
   * "סנסוויריה" however it is spelled, and that is a shop we would otherwise
   * report as not stocking a plant it has on the shelf.
   */
  const alt = plan.altNames[0] ?? '';
  for (const term of [broadTerm(plan), alt, plan.latinTokens.core[0] ?? '', plan.hebrew]) {
    const key = normalizeHebrew(term);
    if (!key || key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

// --- scoring -----------------------------------------------------------------

/* A token counts as present if it appears as a word OR inside one: shops write
 * "ריגל-שילד" and "רגלשילד" as often as they write two clean words. */
function hits(token: string, titleTokens: string[], titleJoined: string): boolean {
  return titleTokens.includes(token) || titleJoined.includes(token);
}

/*
 * How well one catalogue title answers this plan, 0..1.
 *
 * The shape of the rule:
 *   no core token          → 0      "this is not even the right genus"
 *   core, no cultivar asked→ 1      "any Alocasia was a correct answer"
 *   core + all cultivar    → 1      "this is exactly it"
 *   core + some cultivar   → 0.5..1 proportional, the LLM adjudicates the middle
 *   minus foreign cultivar words, which is what separates Regal Shield from
 *   Zebrina without asking a model anything.
 */
export function scoreCandidate(title: string, plan: QueryPlan): number {
  const titleTokens = canonical(title);
  if (titleTokens.length === 0) return 0;

  /*
   * Score against every name the plant is sold under and keep the best.
   *
   * A shop lists one plant under one name; which name is its choice, not ours.
   * The Hebrew title of a Latin-listing shop scores zero against the Hebrew
   * name and one against the Latin, so taking the maximum is what makes the
   * comparison about the plant rather than about which vocabulary we happened
   * to lead with.
   */
  const candidates = [plan.hebrewTokens, plan.latinTokens, ...plan.altTokens].filter(
    (t) => t.core.length > 0
  );
  let best = 0;
  for (const tokens of candidates) {
    best = Math.max(best, scoreAgainst(titleTokens, tokens));
    if (best === 1) break;
  }
  return best;
}

function scoreAgainst(titleTokens: string[], tokens: QueryTokens): number {
  const joined = titleTokens.join(' ');

  const coreHit = tokens.core.some((t) => hits(t, titleTokens, joined));
  if (!coreHit) return 0;

  if (tokens.cultivar.length === 0) {
    /*
     * A genus-only query is genuinely answered by any cultivar, so extra words
     * in the title are not evidence against it. "מונסטרה" is fully answered by
     * "מונסטרה דליסיוזה".
     */
    return 1;
  }

  const matched = tokens.cultivar.filter((t) => hits(t, titleTokens, joined));
  const coverage = matched.length / tokens.cultivar.length;
  const base = 0.5 + 0.5 * coverage;

  /*
   * Cultivar words the title has and we did not ask for.
   *
   * This is the whole defence against the broad ladder's failure mode. Asking
   * for "אלוקסיה ריגל שילד" and being offered "אלוקסיה זברינה" scores 0.5 on
   * coverage alone - a candidate - but זברינה is a cultivar word we never
   * mentioned, and one such word is enough to drop it below WEAK_MATCH so it is
   * never shown and never sent to a model.
   *
   * Core and matched words are excluded, and the penalty is capped so a shop
   * with a verbose title ("אלוקסיה ריגל שילד עלה כהה מיוחד") is demoted, never
   * eliminated.
   */
  const known = new Set([...tokens.core, ...matched]);
  const foreign = titleTokens.filter((t) => !known.has(t) && ![...known].some((k) => t.includes(k) || k.includes(t)));
  const penalty = Math.min(0.4, 0.2 * foreign.length);

  return Math.max(0, base - penalty);
}

export interface RankedProduct extends StructuredProduct {
  score: number;
}

/*
 * Rank a shop's candidates against the plan, dropping everything below
 * WEAK_MATCH.
 *
 * The cut is not an optimization. Whatever survives is what the user may be
 * told this shop sells, and what the model - if it is asked at all - is allowed
 * to choose from. A row that is not this plant must not be in that list.
 */
export function rankCandidates(
  products: StructuredProduct[],
  plan: QueryPlan,
  opts: { limit?: number; threshold?: number } = {}
): RankedProduct[] {
  const threshold = opts.threshold ?? WEAK_MATCH;
  const ranked = products
    .map((p) => ({ ...p, score: scoreCandidate(p.name, plan) }))
    .filter((p) => p.score >= threshold)
    .sort((a, b) => b.score - a.score || a.price - b.price);
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

/*
 * Can we answer without a model?
 *
 * Only when the best candidate is strong AND nothing else is nearly as good.
 * Two rows within a hair of each other mean the title text does not actually
 * distinguish them, and picking by price would be picking arbitrarily - which
 * is precisely the "quoted ₪999.90 because that row came first" failure the
 * pipeline already learned once.
 */
export function isDecisive(ranked: RankedProduct[]): boolean {
  if (ranked.length === 0) return false;
  if (ranked[0].score < STRONG_MATCH) return false;
  const rivals = ranked.filter((r) => r.score >= STRONG_MATCH);
  /* Several equally strong rows are fine when they are the same plant in
   * different sizes - cheapestMatch picks between them downstream. What is not
   * fine is a strong row sitting next to a merely-plausible one. */
  return rivals.length === ranked.length || ranked[rivals.length].score < STRONG_MATCH - 0.1;
}
