import { ApiHttpError, apiFetch, apiHeaders, isPermanentStatus, readApiError, warmUp } from '../../lib/api';
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
 * Plant-and-language pairs this process has already tried and been REFUSED.
 *
 * Without it a screen that is turned down retries on every focus, and each
 * retry is a billable call failing for a reason that has not changed.
 *
 * Only a permanent refusal is remembered - a malformed request, a bad key, a
 * payload over the cap. A timeout, a dropped connection, a 429 or a 5xx is
 * about the moment and is deliberately NOT recorded. That distinction is the
 * whole point of this set: the API sleeps when idle and takes half a minute to
 * wake, and every plant unlucky enough to be at the front of the queue used to
 * eat that cold start, time out, and be written off for the life of the
 * process. On the next launch the server was asleep again and the same plants
 * were written off again - so a handful of plants simply never translated,
 * looking for all the world like a rule about which plants qualify.
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
    .catch((err: unknown) => {
      /* Remembered only if asking again cannot help. See `failed` above. */
      if (err instanceof ApiHttpError && isPermanentStatus(err.status)) failed.add(key);
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

  /*
   * Wake the server on someone else's time, not out of this call's timeout.
   * Free, and shared across the whole batch - only the first plant waits.
   */
  await warmUp();

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
    /* Carries the status, so the caller above can tell a refusal that will
     * repeat from one that is only about right now. */
    throw new ApiHttpError(res.status, error, message);
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

  /*
   * Nothing moved, so nothing was translated.
   *
   * The server refuses this too, but the check belongs here as well because
   * THIS is the caching layer: filing an unchanged copy is what stamps the
   * record with the target language and makes every later reader believe it.
   * One such write and the plant is stuck in the wrong language for good, with
   * no call ever made again - so the cheap comparison is worth more than
   * trusting the other end to be correct.
   *
   * Thrown rather than returned as null: null means "nothing to do", which
   * would be the same lie one layer up. This is a failure, and a transient one
   * - the next pass asks again.
   */
  if (sameProse(translated, source)) {
    throw new Error('translate returned the text it was given');
  }

  return rememberProse(diagnosis, lang, translated);
}

/* Field by field, did anything actually move? Mirrors the server's own check
 * in server/translateDiagnosis.ts - both ends fall back to the original, so
 * both ends have to notice when every fallback fired. */
function sameProse(a: DiagnosisProse, b: DiagnosisProse): boolean {
  const flat = (f: DiagnosisProse): string[] => [
    f.description,
    ...f.issues,
    ...f.treatments.flatMap((t) => [t.title, t.description, t.productLabel]),
    ...(f.carePlan ? [f.carePlan.soil, f.carePlan.light, f.carePlan.water] : []),
  ];
  const x = flat(a);
  const y = flat(b);
  return x.length === y.length && x.every((line, i) => line === y[i]);
}
