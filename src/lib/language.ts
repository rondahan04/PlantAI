/*
 * Which language the app speaks.
 *
 * Pure, and deliberately free of native imports so `node --test` can exercise
 * every branch - the same split as plantStore -> plantLibrary and
 * lib/location -> services/location. The device binding is
 * src/services/language.ts.
 */

export type Language = 'en' | 'he';

/*
 * English is the floor rather than a preference: it is what an unknown locale
 * and a damaged saved value both land on. Hebrew is never assumed, because a
 * user who gets a language they cannot read has no way to navigate back to the
 * setting that would fix it.
 */
export const DEFAULT_LANGUAGE: Language = 'en';

export const LANGUAGES: readonly Language[] = ['en', 'he'];

/*
 * Coerce whatever a locale or a stored preference happens to say into a
 * language we actually have copy for, or null.
 *
 * Locales arrive in several shapes - 'he', 'he-IL', 'HE', and on some Android
 * builds 'iw', the pre-1989 ISO code for Hebrew that the platform never fully
 * stopped emitting. Only the primary subtag decides, and 'iw' is mapped rather
 * than rejected: a phone reporting it is a Hebrew phone, and answering English
 * would be the most visible bug this module could have.
 */
function asLanguage(value: string | null): Language | null {
  if (!value) return null;
  const primary = value.split('-')[0].toLowerCase();
  if (primary === 'iw') return 'he';
  return LANGUAGES.includes(primary as Language) ? (primary as Language) : null;
}

/*
 * Saved choice, then device locale, then English.
 *
 * The saved value is validated rather than trusted. It is a string in a kv
 * store, so a half-written or hand-edited one is possible, and it must not be
 * able to wedge the app into a language that has no copy tree.
 */
export function resolveLanguage(stored: string | null, deviceLocale: string | null): Language {
  return asLanguage(stored) ?? asLanguage(deviceLocale) ?? DEFAULT_LANGUAGE;
}

/*
 * A function rather than a constant, so adding Arabic later is one line here
 * instead of a hunt through every call site.
 */
export function isRTLLanguage(lang: Language): boolean {
  return lang === 'he';
}

/*
 * For `toLocaleDateString` and friends.
 *
 * Passing `undefined` to those means the DEVICE locale, which is wrong the
 * moment someone picks Hebrew on an English phone: they would read Hebrew copy
 * over English dates. Every date call site passes this instead.
 */
export function localeTag(lang: Language): 'en-US' | 'he-IL' {
  return lang === 'he' ? 'he-IL' : 'en-US';
}

/*
 * React Native fixes the layout direction at launch, so this is the only
 * condition that forces a relaunch - and the only reason the app has to ask
 * the user to do anything at all when they change language.
 */
export function needsDirectionChange(lang: Language, currentlyRTL: boolean): boolean {
  return isRTLLanguage(lang) !== currentlyRTL;
}
