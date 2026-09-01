import { getLocales } from 'expo-localization';
import { I18nManager } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import {
  isRTLLanguage,
  localeTag as pureLocaleTag,
  needsDirectionChange,
  resolveLanguage,
  type Language,
} from '../lib/language';
import { TREES, type Copy } from '../lib/copy';

/*
 * The one place the language is bound to the device - same split as
 * plantStore -> plantLibrary and lib/location -> services/location. Every
 * decision lives in the pure module; this file only reads the world and
 * writes to it.
 *
 * RESOLVED ONCE AT MODULE IMPORT, then read synchronously. Screens need the
 * answer during their first render, and a language that arrived a frame later
 * would repaint every label on screen - the same reason plantLibrary and
 * sessionHint are synchronous.
 *
 * Nothing here can change the language of the running process. Flipping RTL
 * takes effect only at launch, so the language is fixed for the lifetime of
 * the app - which is exactly why `copy` can be a plain constant rather than a
 * React context with a provider and a re-render on every change.
 */

const KEY = 'plantai.language';

function readStored(): string | null {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    /* An unreadable preference is not worth crashing the first line of
     * startup over. English is a working app. */
    return null;
  }
}

function readDeviceLocale(): string | null {
  try {
    return getLocales()[0]?.languageCode ?? null;
  } catch {
    return null;
  }
}

const language: Language = resolveLanguage(readStored(), readDeviceLocale());

/* The active copy tree. Import this, not TREES. */
export const copy: Copy = TREES[language];

export function getLanguage(): Language {
  return language;
}

/*
 * For `toLocaleDateString` and friends, which default to the DEVICE locale -
 * wrong the moment someone picks Hebrew on an English phone.
 */
export function localeTag(): string {
  return pureLocaleTag(language);
}

/*
 * Persist a choice and line the layout direction up for the NEXT launch.
 *
 * `forceRTL` does not affect the running process, which is why the caller
 * shows a relaunch notice instead of pretending the switch already happened.
 * `allowRTL` is called first because on iOS forceRTL is ignored while RTL is
 * disallowed, which would silently leave a Hebrew user in a mirrored-wrong
 * layout forever.
 */
export function setLanguage(next: Language): void {
  Storage.setItemSync(KEY, next);
  if (needsDirectionChange(next, I18nManager.isRTL)) {
    I18nManager.allowRTL(isRTLLanguage(next));
    I18nManager.forceRTL(isRTLLanguage(next));
  }
}

/*
 * True when the layout the user is looking at no longer matches the language
 * they chose - i.e. they changed it and have not relaunched yet.
 */
export function relaunchPending(): boolean {
  return needsDirectionChange(language, I18nManager.isRTL);
}
