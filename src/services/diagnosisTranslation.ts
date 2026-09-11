import { apiFetch, apiHeaders, readApiError } from '../lib/api';
import { getLanguage } from './language';
import { needsTranslation } from '../lib/diagnosisLanguage';
import type { PlantDiagnosis } from '../types';

/*
 * Bringing an old diagnosis into the language the user now reads.
 *
 * The network half of `lib/diagnosisLanguage.ts`, split the same way
 * services/genusCarePlans.ts is split from lib/genusCarePlan.ts: the decision
 * (is this record stale) is pure and tested under `node --test`; the fetch and
 * the in-flight bookkeeping live here.
 *
 * The call is billable, so it is fired at most ONCE per plant per process even
 * if the screen remounts, and only for a record that actually is in the wrong
 * language. The result is saved, so a translated plant costs nothing on every
 * subsequent open - the point of writing it back rather than translating for
 * display.
 */

/* Prose for a whole diagnosis, not a word - the care-plan call measured ~19s
 * for a comparable amount of text, so this is sized against that rather than
 * against the short lookups elsewhere. */
const TIMEOUT_MS = 45_000;

/*
 * One promise per plant id, shared by every caller.
 *
 * A plant screen can mount twice in quick succession (a back-navigation, a
 * re-render on focus) and both mounts would otherwise pay for the same
 * translation. Entries are never evicted: the map is bounded by the number of
 * plants opened in one session, and an entry that resolved is exactly the
 * answer a second caller wants.
 */
const inFlight = new Map<string, Promise<PlantDiagnosis | null>>();

/*
 * Plants this process has already tried and failed to translate.
 *
 * Without it a screen that fails - no network, the model down - retries on
 * every focus, and each retry is a billable call that is failing for a reason
 * that has not changed. Cleared on relaunch, which is the right granularity:
 * the user who fixes their connection and reopens the app gets another go.
 */
const failed = new Set<string>();

/*
 * Translate `diagnosis` if it is not already in the app's language.
 *
 * Resolves to null when there is nothing to do (already right, nothing to
 * translate, already tried) and when the call fails - a failure here is not
 * the caller's problem. The plant still renders; it renders in the language it
 * was written in, which is what it was doing before this function existed.
 */
export async function translateIfStale(
  plantId: string,
  diagnosis: PlantDiagnosis
): Promise<PlantDiagnosis | null> {
  const lang = getLanguage();
  if (!needsTranslation(diagnosis, lang)) return null;
  if (failed.has(plantId)) return null;

  const existing = inFlight.get(plantId);
  if (existing) return existing;

  const work = run(diagnosis, lang).catch(() => {
    failed.add(plantId);
    return null;
  });
  inFlight.set(plantId, work);
  return work;
}

async function run(diagnosis: PlantDiagnosis, lang: string): Promise<PlantDiagnosis | null> {
  const res = await apiFetch('/api/translate-diagnosis', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    /*
     * Only the prose. The enums, names and numbers the client branches on stay
     * here and are merged back below, so nothing the app depends on can be
     * changed by a translation - the same rule server/diagnose.ts applies to
     * its own Hebrew output.
     */
    body: JSON.stringify({
      lang,
      diagnosis: {
        description: diagnosis.description,
        issues: diagnosis.issues,
        treatments: diagnosis.treatments.map((t) => ({
          title: t.title,
          description: t.description,
          /* Falls back to the search term, which is what a pre-split record
           * was showing on the button anyway - so an old English label gets
           * translated rather than left behind. */
          productLabel: t.productLabel ?? t.product ?? '',
        })),
        carePlan: diagnosis.carePlan,
      },
    }),
    timeoutMs: TIMEOUT_MS,
  });

  if (!res.ok) {
    const { error, message } = await readApiError(res);
    throw new Error(`${res.status} ${error}${message ? `: ${message}` : ''}`);
  }

  const t = (await res.json()) as {
    description?: string;
    issues?: string[];
    treatments?: { title?: string; description?: string; productLabel?: string }[];
    carePlan?: PlantDiagnosis['carePlan'];
  };

  /*
   * Merged field by field onto the ORIGINAL record rather than replacing it.
   * Everything the translator was never sent - condition, confidence,
   * scientificName, the treatments' `product` search terms, the photo - is
   * carried through untouched by construction, so a translation cannot quietly
   * drop a field this function has not been taught about.
   */
  return {
    ...diagnosis,
    description: t.description ?? diagnosis.description,
    issues: t.issues ?? diagnosis.issues,
    treatments: diagnosis.treatments.map((original, i) => ({
      ...original,
      title: t.treatments?.[i]?.title ?? original.title,
      description: t.treatments?.[i]?.description ?? original.description,
      productLabel: t.treatments?.[i]?.productLabel ?? original.productLabel,
    })),
    carePlan: t.carePlan ?? diagnosis.carePlan,
  };
}
