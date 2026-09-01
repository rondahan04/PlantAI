import type { StoredPlant } from '../services/plantStore';

/*
 * Triage grouping for the plant library (D7).
 *
 * `PlantDiagnosis.condition` already carries the five-step scale, so grouping
 * by health costs nothing and matches why someone opens the app: a plant is in
 * trouble. Chronological order was the alternative and was rejected because a
 * critical plant sinks out of view as the library grows - the one record that
 * needs acting on becomes the hardest to find.
 *
 * Three buckets, not five. Five sections for a library of four plants is more
 * chrome than content, and the actionable split is really binary - needs help
 * now, or does not.
 */

export type TriageKey = 'attention' | 'watching' | 'healthy';

export interface TriageSection {
  key: TriageKey;
  title: string;
  data: StoredPlant[];
}

const BUCKET: Record<string, TriageKey> = {
  critical: 'attention',
  severe: 'attention',
  moderate: 'watching',
  mild: 'healthy',
  healthy: 'healthy',
};

/* English defaults; the caller passes translated titles - same seam as the
 * other pure modules. */
export const EN_TRIAGE_TITLES: Record<TriageKey, string> = {
  attention: 'Needs attention',
  watching: 'Watching',
  healthy: 'Healthy',
};

/* Severity first, then newest - the order within a bucket still matters. */
const SEVERITY: Record<string, number> = {
  critical: 0,
  severe: 1,
  moderate: 2,
  mild: 3,
  healthy: 4,
};

/*
 * A plant with no diagnosis has no condition to read - it was added by hand,
 * which means the user believes it is fine. 'healthy' rather than the unknown
 * bucket on purpose: "Needs attention" is a claim about a plant nobody has
 * examined, and putting a plant there that the user just told us is fine reads
 * as the app arguing with them.
 */
const NO_DIAGNOSIS = 'healthy';

export function bucketFor(condition: string): TriageKey {
  // An unrecognised condition is surfaced rather than hidden: a plant whose
  // health we cannot read is not evidence that it is fine.
  return BUCKET[condition] ?? 'watching';
}

/*
 * Group into sections in fixed order, dropping empties so a healthy library
 * does not render two empty headers above its only section.
 */
export function triageSections(
  plants: StoredPlant[],
  titles: Record<TriageKey, string> = EN_TRIAGE_TITLES
): TriageSection[] {
  const order: TriageKey[] = ['attention', 'watching', 'healthy'];
  const byKey = new Map<TriageKey, StoredPlant[]>(order.map((k) => [k, []]));

  for (const p of plants) byKey.get(bucketFor(p.diagnosis?.condition ?? NO_DIAGNOSIS))!.push(p);

  return order
    .map((key) => ({
      key,
      title: titles[key],
      data: byKey.get(key)!.sort((a, b) => {
        const sev =
          (SEVERITY[a.diagnosis?.condition ?? NO_DIAGNOSIS] ?? 9) -
          (SEVERITY[b.diagnosis?.condition ?? NO_DIAGNOSIS] ?? 9);
        if (sev !== 0) return sev;
        return b.savedAt.localeCompare(a.savedAt);
      }),
    }))
    .filter((section) => section.data.length > 0);
}
