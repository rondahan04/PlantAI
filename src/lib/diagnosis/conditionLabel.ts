/*
 * The words on the health badge.
 *
 * `conditionLabel` arrives written by the model, which means it is frozen in
 * whatever language the app was speaking on the day that plant was diagnosed.
 * A library built in English and then switched to Hebrew shows "Moderate
 * decline" on a Hebrew screen forever, because nothing re-runs a diagnosis
 * just because a setting changed.
 *
 * `condition` does not have that problem: it is a five-value enum the server
 * is forbidden to translate (see languageRule in server/diagnose.ts), so the
 * badge can be derived from it in the current language every render, offline,
 * for records of any age. The model's own sentence is still worth reading -
 * it is in `description`, where prose belongs - but a badge is a label, and a
 * label keyed on an enum should come from the copy tree.
 *
 * Pure, so `node --test` covers it without a native import.
 */

export type Condition = 'healthy' | 'mild' | 'moderate' | 'severe' | 'critical';

export type ConditionCopy = Record<Condition, string>;

/* English, matching the phrasing the model was already producing, so nothing
 * visibly changes for an English user. */
export const EN_CONDITION_COPY: ConditionCopy = {
  healthy: 'Healthy',
  mild: 'Mild concern',
  moderate: 'Moderate decline',
  severe: 'Serious decline',
  critical: 'Critical',
};

const CONDITIONS: readonly string[] = ['healthy', 'mild', 'moderate', 'severe', 'critical'];

export function isCondition(value: string | undefined): value is Condition {
  return value !== undefined && CONDITIONS.includes(value);
}

/*
 * The badge text for a diagnosis.
 *
 * `fallback` is the model's stored label and is used ONLY when `condition` is
 * not one of the five we know. That is not a hypothetical: the enum is
 * something a model is asked to honour rather than something it is prevented
 * from breaking, and an unrecognised condition with a readable sentence next
 * to it should show the sentence rather than nothing at all.
 */
export function conditionLabel(
  condition: string | undefined,
  fallback: string | undefined,
  words: ConditionCopy = EN_CONDITION_COPY
): string | undefined {
  if (isCondition(condition)) return words[condition];
  return fallback;
}
