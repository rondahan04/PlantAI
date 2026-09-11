/*
 * A diagnosis in more than one language at once.
 *
 * Translating a record used to REPLACE its prose, which made the switch back
 * cost exactly as much as the switch out: a user moving between Hebrew and
 * English paid for the same paragraphs over and over, and every round trip
 * went through the model again rather than through anything we already had.
 *
 * So a translated record keeps both. The top-level fields are always the
 * language the app is currently speaking - every existing reader keeps working
 * untouched, which is the whole reason the cache is shaped this way rather
 * than as a `diagnosis.he` the screens would have to learn about - and
 * `translations` holds one copy per language, including the ORIGINAL. After
 * one translation both directions are free forever.
 *
 * WHAT IS AND IS NOT PROSE. Only the words move. `condition` picks a colour,
 * `product` is a search term typed into an Israeli shop, `waterEveryDays` is
 * what an OS reminder is scheduled from, and `confidence` is a number - none
 * of those mean anything different in Hebrew, and a translation that touched
 * them would not read as a translation, it would read as a different
 * diagnosis. `withProse` rebuilds around them by construction, so a field this
 * module has not been taught about cannot be lost.
 *
 * Pure - no react-native import - so `node --test` covers the lot.
 */

import type { Language } from '../i18n/language';
import type { PlantDiagnosis } from '../../types/index';
/* Explicit `.ts` is required, not stylistic: without it `node --test`
 * cannot resolve a runtime import. Same as copy/index.ts. */
import { scriptOf } from './diagnosisLanguage.ts';

export interface DiagnosisProse {
  description: string;
  issues: string[];
  /* `productLabel` only. Its twin `product` is the shop query and stays put. */
  treatments: { title: string; description: string; productLabel: string }[];
  /* The three sentences. The intervals beside them are numbers and stay. */
  carePlan?: { soil: string; light: string; water: string };
}

export function proseOf(d: PlantDiagnosis): DiagnosisProse {
  return {
    description: d.description,
    issues: d.issues,
    treatments: d.treatments.map((t) => ({
      title: t.title,
      description: t.description,
      productLabel: t.productLabel ?? t.product ?? '',
    })),
    ...(d.carePlan
      ? { carePlan: { soil: d.carePlan.soil, light: d.carePlan.light, water: d.carePlan.water } }
      : {}),
  };
}

/*
 * Put `prose` on the record, keeping everything that is not prose.
 *
 * The treatments are walked by index against the ORIGINAL list, so a cached
 * translation with the wrong number of entries cannot add or drop a treatment
 * - a missing one simply keeps its original words.
 */
export function withProse(d: PlantDiagnosis, prose: DiagnosisProse): PlantDiagnosis {
  return {
    ...d,
    description: prose.description,
    issues: prose.issues,
    treatments: d.treatments.map((original, i) => ({
      ...original,
      title: prose.treatments[i]?.title ?? original.title,
      description: prose.treatments[i]?.description ?? original.description,
      productLabel: prose.treatments[i]?.productLabel ?? original.productLabel,
    })),
    ...(d.carePlan
      ? {
          carePlan: {
            /* Spread FIRST so waterEveryDays and waterEveryDaysMax survive: the
             * watering reminder is scheduled from them, and a translation that
             * dropped them would silently unschedule the plant. */
            ...d.carePlan,
            soil: prose.carePlan?.soil ?? d.carePlan.soil,
            light: prose.carePlan?.light ?? d.carePlan.light,
            water: prose.carePlan?.water ?? d.carePlan.water,
          },
        }
      : {}),
  };
}

/*
 * Which language the top-level prose is in.
 *
 * `lang` is authoritative when present. It is absent on every record written
 * before this field existed - which is exactly the population that needs
 * sorting out - so those fall back to reading the script, the same test
 * `needsTranslation` has always used.
 */
export function languageOf(d: PlantDiagnosis): Language {
  if (d.lang === 'he' || d.lang === 'en') return d.lang;
  return scriptOf(d);
}

export function cachedProse(d: PlantDiagnosis, lang: Language): DiagnosisProse | undefined {
  if (languageOf(d) === lang) return proseOf(d);
  return d.translations?.[lang];
}

/*
 * File a freshly translated copy, keeping the one already in hand.
 *
 * Storing the ORIGINAL alongside the new one is the half that makes switching
 * back free: without it, translating en->he throws the English away and
 * he->en has to be bought again.
 */
export function rememberProse(
  d: PlantDiagnosis,
  lang: Language,
  prose: DiagnosisProse
): PlantDiagnosis {
  const from = languageOf(d);
  const translated = withProse(d, prose);
  return {
    ...translated,
    lang,
    translations: { ...d.translations, [from]: proseOf(d), [lang]: prose },
  };
}

/*
 * The record as it should be shown in `lang`, and whether that needed nothing.
 *
 * `hit: true` means the answer came from what we already had - either the
 * record is already in that language or a cached copy was. Only a miss is
 * worth a billable call.
 */
export function resolveForLanguage(
  d: PlantDiagnosis,
  lang: Language
): { diagnosis: PlantDiagnosis; hit: boolean } {
  if (languageOf(d) === lang) {
    /* Already right. Stamp `lang` on a record that predates the field so the
     * script test is not re-run on every future read. */
    return { diagnosis: d.lang === lang ? d : { ...d, lang }, hit: true };
  }

  const cached = d.translations?.[lang];
  if (cached) return { diagnosis: rememberProse(d, lang, cached), hit: true };

  return { diagnosis: d, hit: false };
}

/* Plants a "translate everything" pass actually has to pay for. */
export function needsCallFor(d: PlantDiagnosis | undefined, lang: Language): boolean {
  if (!d) return false;
  if (resolveForLanguage(d, lang).hit) return false;
  /* Nothing written down is nothing to translate - an empty diagnosis would
   * bill for turning nothing into nothing. */
  return proseOf(d).description.trim() !== '' || proseOf(d).issues.length > 0;
}
