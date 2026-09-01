# Hebrew Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run PlantAI entirely in Hebrew - its own copy, the model's analysis, and the species catalog - selected from the device locale and overridable in Settings.

**Architecture:** A typed copy tree (`he.ts` declared as `typeof en`) so TypeScript enforces that the two languages stay in step. The active language resolves once at module import and is read synchronously, because flipping RTL requires a relaunch and therefore the language cannot change mid-session. The server takes a `lang` parameter; the fields the client branches on stay English.

**Tech Stack:** React Native 0.85 / Expo SDK 56, `expo-localization`, `expo-sqlite/kv-store`, Node `http` server, `node --test`.

Spec: `docs/superpowers/specs/2026-09-01-hebrew-i18n-foundation-design.md`

---

## File structure

**Phase 1 - foundation**

| File | Responsibility |
|---|---|
| `src/lib/copy/en.ts` (create) | English copy tree; exports `type Copy = typeof en` |
| `src/lib/copy/he.ts` (create) | Hebrew tree, declared `Copy` |
| `src/lib/copy/index.ts` (create) | Assembles `TREES` |
| `src/lib/language.ts` (create) | Pure: resolve, RTL, locale tag |
| `src/lib/language.test.ts` (create) | Tests for the above |
| `src/services/language.ts` (create) | Only file touching `expo-localization` / kv-store |
| `src/screens/SettingsScreen.tsx` (modify) | Language row |
| `src/screens/LanguageScreen.tsx` (create) | The picker plus the relaunch notice |
| 25 screens/components (modify) | Read `copy.*` instead of literals |

**Phase 2 - analysis in Hebrew**

| File | Responsibility |
|---|---|
| `src/types/index.ts` (modify) | `Treatment.product?: string` |
| `server/diagnose.ts` (modify) | `lang` in prompt; emit `product` |
| `server/carePlan.ts` (modify) | `lang` in prompt |
| `server/index.ts` (modify) | Read `lang` off both request bodies |
| `src/lib/api.ts` (modify) | Send `lang` |
| `src/lib/genusCarePlan.ts` (modify) | `cacheKeyFor(genus, lang)` |
| `src/services/genusCarePlans.ts` (modify) | Pass the active language |
| `src/lib/treatments.ts` (modify) | `product` field wins; parser is the fallback |

**Phase 3 - catalog**

| File | Responsibility |
|---|---|
| `src/data/catalogTypes.ts` (modify) | `nameHe?`, `synonymsHe?` |
| `src/data/catalogAroids.ts` (modify) | Hebrew names |
| `src/data/catalogHouseplants.ts` (modify) | Hebrew names |
| `src/lib/catalogSearch.ts` (modify) | Match Hebrew, fall back to English |
| `src/lib/portfolio.ts` (modify) | `plantDisplayName` prefers Hebrew |

---

# Phase 1 - foundation

### Task 1: Verify RTL on a Hebrew simulator

The whole design assumes iOS sets RTL by itself on a Hebrew device because
`app.json` declares `CFBundleLocalizations: ["en","he"]`. This has never been
tested. If it is false, Task 6 gains a forced relaunch on first run.

**Run this AFTER Task 4**, not before. Verifying needs a native build and so
does installing `expo-localization`; doing them in one build instead of two
saves a full compile. Tasks 2, 3 and 5 are pure TypeScript and do not need a
build at all, so nothing is blocked by waiting. The risk of deferring is
bounded: if RTL turns out not to apply itself, only Task 6 changes, and Task 6
comes after this anyway.

- [ ] **Step 1: Boot a simulator and set it to Hebrew**

```bash
xcrun simctl boot "iPhone 17 Pro" || true
xcrun simctl spawn "iPhone 17 Pro" defaults write -g AppleLanguages -array he
xcrun simctl spawn "iPhone 17 Pro" defaults write -g AppleLocale -string he_IL
xcrun simctl shutdown "iPhone 17 Pro" && xcrun simctl boot "iPhone 17 Pro"
```

- [ ] **Step 2: Build and run**

Run: `npx expo run:ios --device "iPhone 17 Pro"`
Expected: the app builds and launches.

- [ ] **Step 3: Record the answer**

Add a temporary `console.log('isRTL', I18nManager.isRTL)` in `App.tsx`, read it
off the Metro log, then remove it.
Expected: `isRTL true`. If it prints `false`, stop and report - Task 6 changes.

- [ ] **Step 4: Commit nothing.** This task produces a fact, not a diff.

### Task 2: The pure language module

**Files:**
- Create: `src/lib/language.ts`
- Test: `src/lib/language.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANGUAGE,
  isRTLLanguage,
  localeTag,
  needsDirectionChange,
  resolveLanguage,
} from './language.ts';

test('a saved choice beats the device locale', () => {
  assert.equal(resolveLanguage('en', 'he'), 'en');
  assert.equal(resolveLanguage('he', 'en'), 'he');
});

test('with nothing saved, the device locale decides', () => {
  assert.equal(resolveLanguage(null, 'he'), 'he');
  assert.equal(resolveLanguage(null, 'he-IL'), 'he');
  assert.equal(resolveLanguage(null, 'en-US'), 'en');
});

test('an unknown locale falls to English rather than guessing', () => {
  assert.equal(resolveLanguage(null, 'fr-FR'), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null, null), DEFAULT_LANGUAGE);
  assert.equal(resolveLanguage(null, ''), DEFAULT_LANGUAGE);
});

test('a corrupt saved value is ignored, not trusted', () => {
  // A hand-edited or half-written kv value must not wedge the app in a
  // language that does not exist.
  assert.equal(resolveLanguage('klingon', 'he'), 'he');
  assert.equal(resolveLanguage('', 'he'), 'he');
});

test('Hebrew is right-to-left and English is not', () => {
  assert.equal(isRTLLanguage('he'), true);
  assert.equal(isRTLLanguage('en'), false);
});

test('locale tags are explicit, so dates never follow the device by accident', () => {
  assert.equal(localeTag('he'), 'he-IL');
  assert.equal(localeTag('en'), 'en-US');
});

test('a relaunch is needed only when the running direction disagrees', () => {
  assert.equal(needsDirectionChange('he', false), true);
  assert.equal(needsDirectionChange('he', true), false);
  assert.equal(needsDirectionChange('en', true), true);
  assert.equal(needsDirectionChange('en', false), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test src/lib/language.test.ts`
Expected: FAIL, `Cannot find module './language.ts'`.

- [ ] **Step 3: Implement**

```ts
/*
 * Which language the app speaks, decided without touching a native module so
 * `node --test` can exercise every branch. The device binding is
 * src/services/language.ts - same split as plantStore -> plantLibrary.
 */

export type Language = 'en' | 'he';

/* English is the floor, not a preference: it is what an unknown locale and a
 * damaged saved value both fall back to. */
export const DEFAULT_LANGUAGE: Language = 'en';

const LANGUAGES: readonly Language[] = ['en', 'he'];

function asLanguage(value: string | null): Language | null {
  if (!value) return null;
  /* Locales arrive as 'he', 'he-IL' or 'iw' (the legacy Hebrew code some
   * Android builds still report). Only the primary subtag decides. */
  const primary = value.split('-')[0].toLowerCase();
  if (primary === 'iw') return 'he';
  return LANGUAGES.includes(primary as Language) ? (primary as Language) : null;
}

/*
 * Saved choice, then device locale, then English.
 *
 * The saved value is validated rather than trusted: it is a string in a kv
 * store, and a half-written or hand-edited one must not wedge the app in a
 * language that has no copy tree.
 */
export function resolveLanguage(stored: string | null, deviceLocale: string | null): Language {
  return asLanguage(stored) ?? asLanguage(deviceLocale) ?? DEFAULT_LANGUAGE;
}

/* A function rather than a constant so adding Arabic later does not mean
 * revisiting every call site. */
export function isRTLLanguage(lang: Language): boolean {
  return lang === 'he';
}

/*
 * For `toLocaleDateString` and friends. Passing `undefined` there means the
 * DEVICE locale, which is wrong the moment someone picks Hebrew on an English
 * phone - they would read Hebrew copy over English dates.
 */
export function localeTag(lang: Language): 'en-US' | 'he-IL' {
  return lang === 'he' ? 'he-IL' : 'en-US';
}

/*
 * React Native fixes the layout direction at launch, so this is the only
 * condition that forces a relaunch.
 */
export function needsDirectionChange(lang: Language, currentlyRTL: boolean): boolean {
  return isRTLLanguage(lang) !== currentlyRTL;
}
```

- [ ] **Step 4: Run the test again**

Run: `node --test src/lib/language.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/language.ts src/lib/language.test.ts
git commit -m "feat(i18n): pure language resolution - saved choice, then locale, then English"
```

### Task 3: The copy trees

**Files:**
- Create: `src/lib/copy/en.ts`, `src/lib/copy/he.ts`, `src/lib/copy/index.ts`
- Test: `src/lib/copy/copy.test.ts`

Start with only the strings Task 6 needs (the Settings/Language screens) plus
one interpolating example, so the machinery is proven before 320 strings ride
on it. Tasks 8-12 grow the trees screen by screen.

- [ ] **Step 1: Write the failing test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TREES } from './index.ts';

test('every language names itself in its own script', () => {
  assert.equal(TREES.en.language.english, 'English');
  assert.equal(TREES.he.language.hebrew, 'עברית');
});

test('the relaunch notice exists in both languages and is not left in English', () => {
  assert.notEqual(TREES.he.language.relaunchNotice, TREES.en.language.relaunchNotice);
  assert.match(TREES.he.language.relaunchNotice, /[א-ת]/);
});

test('a count reads naturally in both languages', () => {
  // Hebrew does not say "1 plants". The tree holds functions precisely so
  // agreement is written as logic rather than squeezed into a format string.
  assert.equal(TREES.en.importBanner.title(1), 'Import your 1 saved plant?');
  assert.equal(TREES.en.importBanner.title(3), 'Import your 3 saved plants?');
  assert.equal(TREES.he.importBanner.title(1), 'לייבא את הצמח השמור שלך?');
  assert.equal(TREES.he.importBanner.title(3), 'לייבא את 3 הצמחים השמורים שלך?');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test src/lib/copy/copy.test.ts`
Expected: FAIL, cannot find `./index.ts`.

- [ ] **Step 3: Write `en.ts`**

```ts
/*
 * Every word the app itself writes, in English.
 *
 * This file defines the SHAPE. `he.ts` is declared as `Copy`, so TypeScript
 * refuses to compile a Hebrew tree that is missing a key, has an extra one, or
 * whose function arity drifted. That makes the most likely failure of a
 * two-language app - one file falling behind the other - impossible to commit
 * rather than something to catch in review.
 *
 * Plain strings where the copy is fixed, functions where it is not. A function
 * is the point: Hebrew number and gender agreement is Hebrew logic, and it
 * gets to be written as code instead of squeezed into a placeholder syntax.
 */
export const en = {
  language: {
    title: 'Language',
    english: 'English',
    hebrew: 'עברית',
    relaunchNotice: 'Language changed. Close and reopen PlantAI to finish.',
    ok: 'OK',
  },
  importBanner: {
    title: (n: number) => `Import your ${n} saved plant${n === 1 ? '' : 's'}?`,
    sub: 'They will follow you to any device you log into.',
    partial: (ok: number, failed: number) =>
      `${ok} imported, ${failed} couldn't - tap to retry.`,
    importAction: 'Import',
    importA11y: 'Import saved plants',
    dismissA11y: 'Not now',
  },
} as const;

export type Copy = typeof en;
```

- [ ] **Step 4: Write `he.ts`**

```ts
import type { Copy } from './en';

/*
 * The Hebrew tree. Declared as `Copy`, which is what makes drift a compile
 * error - see the note in en.ts.
 *
 * Hebrew number agreement: 1 takes the singular and the noun carries no
 * numeral ("הצמח השמור" not "1 הצמח השמור"), which is why these are functions.
 */
export const he: Copy = {
  language: {
    title: 'שפה',
    english: 'English',
    hebrew: 'עברית',
    relaunchNotice: 'השפה שונתה. סגור ופתח מחדש את PlantAI כדי לסיים.',
    ok: 'אישור',
  },
  importBanner: {
    title: (n: number) =>
      n === 1 ? 'לייבא את הצמח השמור שלך?' : `לייבא את ${n} הצמחים השמורים שלך?`,
    sub: 'הם ילוו אותך לכל מכשיר שתתחבר ממנו.',
    partial: (ok: number, failed: number) =>
      `${ok} יובאו, ${failed} נכשלו - הקש לניסיון נוסף.`,
    importAction: 'ייבוא',
    importA11y: 'ייבוא הצמחים השמורים',
    dismissA11y: 'לא עכשיו',
  },
};
```

- [ ] **Step 5: Write `index.ts`**

```ts
import type { Language } from '../language';
import { en, type Copy } from './en';
import { he } from './he';

export type { Copy };
export const TREES: Record<Language, Copy> = { en, he };
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/lib/copy/copy.test.ts && npx tsc --noEmit`
Expected: PASS, 3 tests, and a clean typecheck.

- [ ] **Step 7: Prove the guarantee is real**

Temporarily delete the `sub` line from `he.ts` and run `npx tsc --noEmit`.
Expected: an error naming `sub` as missing. Restore the line.
This is the only step that verifies the central design claim.

- [ ] **Step 8: Commit**

```bash
git add src/lib/copy/
git commit -m "feat(i18n): typed copy trees - tsc is the drift test"
```

### Task 4: Install expo-localization

- [ ] **Step 1: Install**

Run: `npx expo install expo-localization`
Expected: added to `package.json` dependencies.

- [ ] **Step 2: Verify the API against the SDK 56 docs**

Read https://docs.expo.dev/versions/v56.0.0/sdk/localization/ and confirm
`getLocales()` is exported and synchronous, and that the returned objects carry
`languageCode`. Do not skip this - AGENTS.md requires the versioned docs.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add expo-localization for device locale detection"
```

### Task 5: The device binding

**Files:**
- Create: `src/services/language.ts`

No test file: this module is the native binding, exactly like
`src/services/location.ts` and `src/services/plantLibrary.ts`, and all of its
logic lives in the tested pure module.

- [ ] **Step 1: Implement**

```ts
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
 * The one place the language is bound to the device.
 *
 * Resolved ONCE at module import and read synchronously afterwards, for the
 * same reason plantLibrary and sessionHint are synchronous: screens need the
 * answer during their first render, and a language that arrived a frame later
 * would repaint every label on the screen.
 *
 * Nothing here can change the running language. Flipping RTL requires a
 * relaunch, so the language is fixed for the lifetime of the process - which
 * is exactly why `copy` can be a plain constant instead of a React context.
 */

const KEY = 'plantai.language';

function readStored(): string | null {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    return null;
  }
}

function readDeviceLocale(): string | null {
  try {
    return getLocales()[0]?.languageCode ?? null;
  } catch {
    /* A locale we cannot read is not an error worth surfacing - English is a
     * working app, and a crash on the first line of startup is not. */
    return null;
  }
}

const language: Language = resolveLanguage(readStored(), readDeviceLocale());

export const copy: Copy = TREES[language];

export function getLanguage(): Language {
  return language;
}

export function localeTag(): string {
  return pureLocaleTag(language);
}

/*
 * Persist a choice and align the layout direction for the NEXT launch.
 *
 * `forceRTL` is deliberately called here and not awaited by anything: it takes
 * effect when the app next starts, which is why the caller shows a relaunch
 * notice rather than pretending the switch already happened.
 */
export function setLanguage(next: Language): void {
  Storage.setItemSync(KEY, next);
  if (needsDirectionChange(next, I18nManager.isRTL)) {
    I18nManager.allowRTL(isRTLLanguage(next));
    I18nManager.forceRTL(isRTLLanguage(next));
  }
}

/* True when the running layout no longer matches the saved choice. */
export function relaunchPending(): boolean {
  return needsDirectionChange(language, I18nManager.isRTL);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/services/language.ts
git commit -m "feat(i18n): bind the language to the device, resolved once at import"
```

### Task 6: The Language screen and the Settings row

**Files:**
- Create: `src/screens/LanguageScreen.tsx`
- Modify: `src/screens/SettingsScreen.tsx`, `src/types/index.ts` (route params), `src/navigation` registration

- [ ] **Step 1: Add the route**

Add `Language: undefined;` to `RootStackParamList` in `src/types/index.ts` and
register `LanguageScreen` alongside the other Settings-stack screens, following
exactly how `Notifications` is registered.

- [ ] **Step 2: Write the screen**

Two rows, current language checked. On a change: call `setLanguage`, then
`Alert.alert(copy.language.title, copy.language.relaunchNotice, [{ text: copy.language.ok }])`.
Follow `SettingsCard` / `SettingsRow` as used in `SettingsScreen.tsx:98-119`.

- [ ] **Step 3: Add the Settings row**

```tsx
<SettingsRow
  icon="language-outline"
  label={copy.language.title}
  value={getLanguage() === 'he' ? copy.language.hebrew : copy.language.english}
  onPress={() => navigation.navigate('Language')}
/>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && node --test`
Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(i18n): a language picker in Settings"
```

### Task 7: Dates stop following the device

**Files:**
- Modify: `src/screens/PlantDetailScreen.tsx:560`, `src/screens/WateringHistoryScreen.tsx:313,382,390`, `src/lib/calendar.ts:79`

`calendar.ts` is pure and must stay pure, so it takes the tag as an argument
rather than importing the service.

Two things here, not one. `monthView` formats its title against the device
locale, and `WEEKDAY_LABELS` is a hardcoded English `['S','M','T','W','T','F','S']` -
a Hebrew calendar with English day initials is the kind of detail that makes a
translation look machine-made.

- [ ] **Step 1: Add the failing tests for calendar.ts**

```ts
test('a month title is rendered in the language asked for, not the device default', () => {
  assert.match(monthView(2026, 8, 'he-IL').title, /[א-ת]/);
  assert.match(monthView(2026, 8, 'en-US').title, /September/);
});

test('the locale is optional, so existing callers keep the device default', () => {
  assert.ok(monthView(2026, 8).title.length > 0);
});

test('weekday initials exist in both languages and start on Sunday', () => {
  // Both calendars start on Sunday, which is the Israeli week as well as the
  // American one - so only the glyphs change, not the column order.
  assert.deepEqual(weekdayLabels('en'), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  assert.deepEqual(weekdayLabels('he'), ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']);
});
```

- [ ] **Step 2: Run them**

Run: `node --test src/lib/calendar.test.ts`
Expected: FAIL - `monthView` takes two arguments and `weekdayLabels` does not exist.

- [ ] **Step 3: Thread the tag through and replace the labels**

`monthView(year, month, locale?: string)`, with line 79 becoming
`first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })` - optional
so the signature change cannot break a caller silently.

Replace the `WEEKDAY_LABELS` constant with:

```ts
/* Sunday-first in both languages: that is the Israeli week as well as the
 * American one, so only the glyphs change and the grid stays put. */
const WEEKDAY_LABELS: Record<Language, readonly string[]> = {
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
  he: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
};

export function weekdayLabels(lang: Language): readonly string[] {
  return WEEKDAY_LABELS[lang];
}
```

Update `WateringHistoryScreen` to call `weekdayLabels(getLanguage())`, and in
the four date call sites replace `undefined` with `localeTag()` imported from
`../services/language`.

- [ ] **Step 4: Verify**

Run: `node --test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(i18n): dates follow the chosen language, not the device"
```

### Tasks 8-12: Extract the copy, screen by screen

Same recipe per file. Split into five commits so each is reviewable:

- **Task 8:** `PortfolioScreen`, `PlantCard`, `ImportBanner`, `ScheduleCard`
- **Task 9:** `PlantDetailScreen`, `CarePlanCard`, `SoilCard`, `WateringHistoryScreen`
- **Task 10:** `CameraScreen`, `DiagnosisScreen`, `NurseriesScreen`
- **Task 11:** `AddPlantScreen`, `SpeciesPickerScreen`, `PlantSearchScreen`, `SoilMediumIcon`, `StatusView`
- **Task 12:** `OnboardingScreen`, `SettingsScreen`, `ManageAccountScreen`, `LoginScreen`, `SignupScreen`, `ForgotPasswordScreen`, `ResetPasswordConfirmScreen`, `ChangePasswordScreen`, `EditProfileFieldScreen`, `NotificationsScreen`, `AuthTextField`, `SettingsCard`, `SettingsRow`

Recipe for each file:

- [ ] **Step 1:** Add a section to `en.ts` named after the file, holding every
  user-facing string in it - including every `accessibilityLabel`, which is
  read aloud and is just as much copy as a button.
- [ ] **Step 2:** Add the matching Hebrew section to `he.ts`. Run
  `npx tsc --noEmit` - it will name anything missed.
- [ ] **Step 3:** Replace the literals with `copy.<section>.<key>`.
- [ ] **Step 4:** Run `npx tsc --noEmit && node --test`. Expected: clean.
- [ ] **Step 5:** Commit, e.g.
  `git commit -m "feat(i18n): Hebrew copy for the portfolio screens"`

Do not translate: `scientificName`, anything from `plant.diagnosis`, catalog
names, or scraped nursery text. Those are phases 2 and 3, and touching them
here produces a half-translated record with no way to tell which half is which.

- [ ] **Final step: prove nothing was missed**

Run: `grep -rnE '>[A-Z][a-z]+ [a-z]' src/screens src/components --include='*.tsx' | grep -v copy\.`
Expected: no user-facing sentences left. Anything that appears is either a
missed string or a deliberate exception worth a comment.

---

# Phase 2 - the analysis answers in Hebrew

### Task 13: `Treatment.product`, so the buy button survives Hebrew

**Files:**
- Modify: `src/types/index.ts`, `src/lib/treatments.ts`
- Test: `src/lib/treatments.test.ts`

`treatmentProduct` parses English titles against English substance and action
words. Hand it Hebrew and it returns null for everything, so the "Find Confidor
nearby" button silently stops rendering. The model gets to state the product
instead of the client guessing it from prose.

- [ ] **Step 1: Write the failing tests**

```ts
test('an explicit product from the model wins over parsing the title', () => {
  const treatment = {
    title: 'ריסוס בשמן נים כל שבוע',
    description: '',
    urgent: true,
    product: 'Neem oil',
  };
  assert.equal(treatmentProduct(treatment), 'Neem oil');
});

test('a treatment the model marked as not purchasable offers nothing to buy', () => {
  // An empty string is the model saying "there is no product here", which is
  // different from the field being absent on an older saved diagnosis.
  const treatment = { title: 'נגב את הכנימות ביד', description: '', urgent: false, product: '' };
  assert.equal(treatmentProduct(treatment), null);
});

test('a diagnosis saved before the field existed still parses its English title', () => {
  const treatment = { title: 'Neem oil spray weekly', description: '', urgent: true };
  assert.equal(treatmentProduct(treatment), 'neem oil');
});
```

- [ ] **Step 2: Run them**

Run: `node --test src/lib/treatments.test.ts`
Expected: FAIL - `treatmentProduct` takes a string, not a `Treatment`.

- [ ] **Step 3: Change the type**

```ts
export interface Treatment {
  title: string;
  description: string;
  urgent: boolean;
  /*
   * What to search a nursery for, in English or as a brand name, or an empty
   * string when this treatment is advice rather than a purchase.
   *
   * Supplied by the model, which already knows whether it just recommended a
   * buyable thing. Optional because every diagnosis saved before this field
   * existed has none - those fall back to `parseProductFromTitle`, which is
   * why that parser is kept rather than deleted.
   */
  product?: string;
}
```

- [ ] **Step 4: Change `treatmentProduct` to take the treatment**

Rename the existing body to `parseProductFromTitle(title: string)`, keep every
existing test pointed at it, and add:

```ts
export function treatmentProduct(treatment: Treatment): string | null {
  /* `undefined` means an older record with no opinion; `''` means the model
   * said there is nothing to buy. Only the first should fall through to the
   * parser. */
  if (treatment.product !== undefined) return treatment.product || null;
  return parseProductFromTitle(treatment.title);
}
```

- [ ] **Step 5: Update the two call sites**

`DiagnosisScreen.tsx` and `PlantDetailScreen.tsx` both call
`treatmentProduct(tr.title)`; both become `treatmentProduct(tr)`.

- [ ] **Step 6: Verify**

Run: `node --test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(diagnosis): the model names the product instead of the client parsing it"
```

### Task 14: `lang` reaches the server

**Files:**
- Modify: `server/index.ts`, `server/diagnose.ts`, `server/carePlan.ts`, `src/lib/api.ts`
- Test: `server/carePlan.test.ts`, `server/diagnose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('a Hebrew request asks the model for Hebrew and keeps the enums English', async () => {
  let seenPrompt = '';
  const openai = async (prompt: string) => {
    seenPrompt = prompt;
    return JSON.stringify(hebrewFixture);
  };
  const result = await buildCarePlan({ genus: 'Monstera', family: 'Araceae', lang: 'he' }, { openai });

  assert.match(seenPrompt, /Hebrew/);
  // Every soil medium key is a client-side enum. A model that helpfully
  // translated them would produce a plan the client cannot index into.
  assert.deepEqual(Object.keys(result.bySoil).sort(), SOIL_MEDIUM_IDS.slice().sort());
});

test('no lang means English, so an older installed build keeps working', async () => {
  let seenPrompt = '';
  const openai = async (p: string) => { seenPrompt = p; return JSON.stringify(englishFixture); };
  await buildCarePlan({ genus: 'Monstera', family: 'Araceae' }, { openai });
  assert.doesNotMatch(seenPrompt, /Hebrew/);
});
```

- [ ] **Step 2: Run it**

Run: `node --test server/carePlan.test.ts`
Expected: FAIL - `lang` is not a parameter.

- [ ] **Step 3: Implement**

Add `lang?: 'en' | 'he'` to both request shapes. When `lang === 'he'`, append to
the prompt:

```
Respond in Hebrew. Translate only the human-readable text.
Do NOT translate: the JSON keys, the `condition` value (one of healthy, mild,
moderate, severe, critical), `identificationSource`, `scientificName` (botanical
Latin), `genus` (used as a lookup key), the soil medium keys, or `product`.
```

Validate it in `server/index.ts` the same way `genus` is validated: anything
other than `'he'` is treated as English rather than rejected.

- [ ] **Step 4: Send it from the client**

`src/lib/api.ts` adds `lang: getLanguage()` to both request bodies.

- [ ] **Step 5: Verify**

Run: `node --test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(api): diagnose and care-plan answer in the caller's language"
```

### Task 15: The care-plan cache splits by language

**Files:**
- Modify: `src/lib/genusCarePlan.ts`, `src/services/genusCarePlans.ts`
- Test: `src/lib/genusCarePlan.test.ts`

Without this a user who switches to Hebrew reads their own cached English plans
forever, and the first Hebrew fetch overwrites the English entry for every genus
they own.

- [ ] **Step 1: Write the failing test**

```ts
test('two languages cannot share a cache entry', () => {
  assert.notEqual(cacheKeyFor('Monstera', 'en'), cacheKeyFor('Monstera', 'he'));
});

test('the key is still case and whitespace insensitive within a language', () => {
  assert.equal(cacheKeyFor('  Monstera ', 'he'), cacheKeyFor('monstera', 'he'));
});

test('the prefix bumped, so plans cached before languages existed are not served', () => {
  assert.match(cacheKeyFor('Monstera', 'en'), /v2/);
});
```

- [ ] **Step 2: Run it**

Run: `node --test src/lib/genusCarePlan.test.ts`
Expected: FAIL - `cacheKeyFor` takes one argument.

- [ ] **Step 3: Implement**

```ts
/* v2: the key gained a language. A v1 entry holds English text under a key a
 * Hebrew reader would have hit, so the prefix bump retires them rather than
 * serving one language's advice to the other. */
const CACHE_KEY_PREFIX = 'plantai.carePlan.v2.';

export function cacheKeyFor(genus: string, lang: Language): string {
  return `${CACHE_KEY_PREFIX}${lang}.${genus.trim().toLowerCase()}`;
}
```

Thread `lang` through `get`, `peek` and the in-flight dedupe map in
`src/services/genusCarePlans.ts`, taking it from `getLanguage()`.

- [ ] **Step 4: Verify**

Run: `node --test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(care): cache care plans per language, not per genus alone"
```

---

# Phase 3 - the species catalog

### Task 16: Hebrew fields on the catalog

**Files:**
- Modify: `src/data/catalogTypes.ts`, `src/lib/catalogSearch.ts`, `src/lib/portfolio.ts`
- Test: `src/lib/catalogSearch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('a Hebrew query finds an entry by its Hebrew name', () => {
  assert.ok(searchCatalog('מונסטרה').some((r) => r.entry.id === 'monstera-deliciosa'));
});

test('the English name still finds it, because growers type both', () => {
  assert.ok(searchCatalog('monstera').some((r) => r.entry.id === 'monstera-deliciosa'));
});

test('an entry with no Hebrew name shows its English one rather than nothing', () => {
  assert.equal(catalogDisplayName({ ...entry, nameHe: undefined }, 'he'), entry.name);
});
```

- [ ] **Step 2: Run them**

Run: `node --test src/lib/catalogSearch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the type**

```ts
  /*
   * The name Israeli growers use. Absent where no Hebrew name is genuinely in
   * circulation - inventing one produces a label nobody recognises and a search
   * term nobody types, which is worse than showing the English name they know.
   */
  nameHe?: string;
  /* Hebrew spellings the search should match, same role as `synonyms`. */
  synonymsHe?: string[];
```

`scientificName`, `genus`, `group` and `family` are unchanged: Latin is Latin,
and `genus` is a key.

- [ ] **Step 4: Index and display**

Fold `nameHe` and `synonymsHe` into the same search index as `name` and
`synonyms`, so one query matches either script. Add
`catalogDisplayName(entry, lang)` returning `lang === 'he' ? entry.nameHe ?? entry.name : entry.name`,
and use it in `SpeciesPickerScreen` and wherever `plantDisplayName` renders a
catalog-sourced name.

- [ ] **Step 5: Verify**

Run: `node --test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(catalog): Hebrew names and bilingual search"
```

### Task 17: Author the Hebrew names

**Files:**
- Modify: `src/data/catalogAroids.ts`, `src/data/catalogHouseplants.ts`

- [ ] **Step 1: Add `nameHe` to the aroids**

Work genus by genus. Most are established transliterations (מונסטרה,
פילודנדרון, אלוקזיה, אנתוריום). Leave `nameHe` absent where no Hebrew name is
actually in use rather than transliterating a cultivar name nobody says in
Hebrew.

- [ ] **Step 2: Run the tests**

Run: `node --test && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/data/catalogAroids.ts
git commit -m "feat(catalog): Hebrew names for the aroids"
```

- [ ] **Step 4: Repeat for the non-aroids and commit separately**

```bash
git add src/data/catalogHouseplants.ts
git commit -m "feat(catalog): Hebrew names for the non-aroid houseplants"
```

---

### Task 18: Build and hand over

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx tsc --noEmit -p tsconfig.node.json && node --test`
Expected: clean, every test passing.

- [ ] **Step 2: No physical edges crept back in**

Run: `grep -rn "marginLeft\|marginRight\|paddingLeft\|paddingRight" src/`
Expected: no output.

- [ ] **Step 3: Boot a Hebrew simulator and run**

```bash
xcrun simctl boot "iPhone 17 Pro"
xcrun simctl spawn "iPhone 17 Pro" defaults write -g AppleLanguages -array he
xcrun simctl spawn "iPhone 17 Pro" defaults write -g AppleLocale -string he_IL
xcrun simctl shutdown "iPhone 17 Pro" && xcrun simctl boot "iPhone 17 Pro"
npx expo run:ios --device "iPhone 17 Pro"
```

- [ ] **Step 4: Hand Ron a numbered checklist**

Manual testing is Ron's - synthetic taps do not register in the RN view. The
list must cover: the app opening in Hebrew and mirrored; a diagnosis returning
Hebrew text while its condition colour and the buy button still work; a care
plan in Hebrew; the catalog searchable by Hebrew name; switching to English in
Settings and relaunching; and an English-diagnosed plant keeping its English
text after the switch.
