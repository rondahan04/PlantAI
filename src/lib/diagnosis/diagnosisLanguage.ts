/*
 * Is a saved diagnosis written in the language the app is currently speaking?
 *
 * The model writes the prose ONCE, on the day the photo was taken, and nothing
 * re-runs it because a setting changed. A library built in English and then
 * switched to Hebrew therefore keeps showing English paragraphs on a Hebrew
 * screen - not a rendering bug, a record that predates the choice.
 *
 * Detection is by script, not by a stored language tag, on purpose: the tag
 * does not exist on any record saved before this file did, which is precisely
 * the population that needs translating. A script test needs nothing from the
 * record but its own text.
 *
 * Pure - no react-native import - so `node --test` covers it.
 */

import type { Language } from '../i18n/language';

/* Hebrew block, plus the two presentation forms blocks that Unicode keeps
 * separately and that some keyboards still emit. */
const HEBREW = /[֐-׿יִ-ﭏ]/;
const LATIN_LETTER = /[A-Za-z]/;

/*
 * Everything on a diagnosis that a human reads, flattened.
 *
 * `plantName`, `scientificName` and `variety` are deliberately NOT here.
 * Botanical names are Latin in every language, and a Hebrew common name is
 * already handled at its own source (server/commonNames.ts) - feeding either
 * into a script test would report a perfectly good Hebrew record as English
 * the moment it happened to name a Monstera.
 */
export interface TranslatableDiagnosis {
  description?: string;
  issues?: string[];
  treatments?: { title?: string; description?: string }[];
  carePlan?: { light?: string; water?: string; humidity?: string; soil?: string; warnings?: string[] };
}

export function prose(d: TranslatableDiagnosis): string[] {
  const plan = d.carePlan;
  return [
    d.description,
    ...(d.issues ?? []),
    ...(d.treatments ?? []).flatMap((tr) => [tr.title, tr.description]),
    plan?.light,
    plan?.water,
    plan?.humidity,
    plan?.soil,
    ...(plan?.warnings ?? []),
  ].filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
}

/*
 * Which language the prose LOOKS like, for a record that does not say.
 *
 * Any Hebrew character means Hebrew. A Hebrew diagnosis routinely carries
 * English fragments - a cultivar, a product name, "pH" - and none of those
 * make it an English record, whereas an English one cannot accidentally
 * contain Hebrew.
 *
 * Prose-free records answer English, matching DEFAULT_LANGUAGE. There is
 * nothing to read, so this is a floor rather than a finding, and callers skip
 * empty records before it matters.
 */
export function scriptOf(d: TranslatableDiagnosis): Language {
  return HEBREW.test(prose(d).join(' ')) ? 'he' : 'en';
}

/*
 * True when the saved prose is in some language OTHER than `lang`.
 *
 * Biased hard towards saying no. A false positive costs a billed translation
 * call and rewrites a record that was already correct; a false negative just
 * leaves the user reading what they are reading today. So:
 *
 * - No prose at all is not evidence of anything. An empty diagnosis is left
 *   alone rather than sent to be translated into nothing.
 * - For Hebrew, ANY Hebrew character anywhere means the record is already
 *   Hebrew. A Hebrew diagnosis routinely carries English fragments - a
 *   cultivar, a product name, "pH" - and none of those make it an English
 *   record.
 * - For English, the test is the mirror: Hebrew characters and no Latin
 *   letters at all. A Hebrew record quoting a Latin binomial still reads as
 *   Hebrew to the person looking at it.
 */
export function needsTranslation(d: TranslatableDiagnosis, lang: Language): boolean {
  const lines = prose(d);
  if (lines.length === 0) return false;
  const text = lines.join(' ');

  if (lang === 'he') return !HEBREW.test(text);
  return HEBREW.test(text) && !LATIN_LETTER.test(text);
}
