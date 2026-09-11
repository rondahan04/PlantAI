import { apiFetch, apiHeaders, readApiError } from '../../lib/api';
import { getLanguage } from '../language';
import { proseOf, rememberProse, resolveForLanguage, type DiagnosisProse } from '../../lib/diagnosis/diagnosisProse';
import type { Language } from '../../lib/i18n/language';
import type { PlantDiagnosis } from '../../types/index';

/*
 * Bringing a saved diagnosis into the language the user now reads.
 *
 * The network half of `lib/diagnosisProse.ts`, split the same way
 * services/genusCarePlans.ts is split from lib/genusCarePlan.ts: what to show
 * and what is already cached is pure and tested under `node --test`; the fetch
 * and the in-flight bookkeeping live here.
 *
 * A call is only ever made on a cache MISS. A record already in the right
 * language, or one carrying a copy from an earlier switch, resolves offline -
 * so this costs one call per plant per language, once, for the lifetime of the
 * record.
 */

/* Prose for a whole diagnosis, not a word - the care-plan call measured ~19s
 * for a comparable amount of text, so this is sized against that rather than
 * against the short lookups elsewhere. */
const TIMEOUT_MS = 45_000;

/*
 * One promise per plant-and-language, shared by every caller.
 *
 * A plant screen can mount twice in quick succession (a back-navigation, a
 * re-render on focus), and the startup batch can reach a plant the user has
 * just opened. Both would otherwise pay for the same translation. Keyed by
 * language too, so switching mid-run cannot hand back the previous language's
 * promise.
 */
const inFlight = new Map<string, Promise<PlantDiagnosis | null>>();

/*
 * Plant-and-language pairs this process has already tried and failed.
 *
 * Without it a screen that fails - no network, the model down - retries on
 * every focus, and each retry is a billable call failing for a reason that has
 * not changed. Cleared on relaunch, which is the right granularity: the user
 * who fixes their connection and reopens the app gets another go.
 */
const failed = new Set<string>();

const keyFor = (plantId: string, lang: Language) => `${plantId}:${lang}`;

/*
 * The diagnosis to show, in the app's language.
 *
 * Resolves to null when there is nothing to change - already right, already
 * cached and applied by the caller, previously failed - and when the call
 * fails. A failure is silent by design: the plant still renders, in the
 * language it was written in, which is what it did before this existed.
 */
export async function translateIfStale(
  plantId: string,
  diagnosis: PlantDiagnosis
): Promise<PlantDiagnosis | null> {
  const lang = getLanguage();

  /*
   * Free first. A cache hit still returns a record - `resolveForLanguage` may
   * have swapped in a stored copy, or stamped `lang` on an old one - so the
   * caller saves it, but nothing was spent and nothing was waited for.
   */
  const resolved = resolveForLanguage(diagnosis, lang);
  if (resolved.hit) return resolved.diagnosis === diagnosis ? null : resolved.diagnosis;

  const key = keyFor(plantId, lang);
  if (failed.has(key)) return null;

  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = run(diagnosis, lang)
    .catch(() => {
      failed.add(key);
      return null;
    })
    .finally(() => {
      /* Dropped once settled: a later language switch back to this one is a
       * cache hit and never reaches here, and holding a resolved promise for
       * every plant ever opened is a leak with no reader. */
      inFlight.delete(key);
    });

  inFlight.set(key, work);
  return work;
}

async function run(diagnosis: PlantDiagnosis, lang: Language): Promise<PlantDiagnosis> {
  const source = proseOf(diagnosis);

  const res = await apiFetch('/api/translate-diagnosis', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    /*
     * Only the prose. The enums, names and numbers the client branches on never
     * leave this function - `rememberProse` rebuilds the record around them -
     * so nothing the app depends on can be changed by a translation. Same rule
     * server/diagnose.ts applies to its own Hebrew output.
     */
    body: JSON.stringify({ lang, diagnosis: source }),
    timeoutMs: TIMEOUT_MS,
  });

  if (!res.ok) {
    const { error, message } = await readApiError(res);
    throw new Error(`${res.status} ${error}${message ? `: ${message}` : ''}`);
  }

  const body = (await res.json()) as Partial<DiagnosisProse>;

  /*
   * Rebuilt from what we SENT, line by line, never from the shape that came
   * back. A model that drops a treatment or omits the care plan leaves that
   * line in its original language; it cannot put a hole in a saved record.
   */
  const translated: DiagnosisProse = {
    description: body.description ?? source.description,
    issues: source.issues.map((original, i) => body.issues?.[i] ?? original),
    treatments: source.treatments.map((original, i) => ({
      title: body.treatments?.[i]?.title ?? original.title,
      description: body.treatments?.[i]?.description ?? original.description,
      productLabel: body.treatments?.[i]?.productLabel ?? original.productLabel,
    })),
    ...(source.carePlan
      ? {
          carePlan: {
            soil: body.carePlan?.soil ?? source.carePlan.soil,
            light: body.carePlan?.light ?? source.carePlan.light,
            water: body.carePlan?.water ?? source.carePlan.water,
          },
        }
      : {}),
  };

  return rememberProse(diagnosis, lang, translated);
}
