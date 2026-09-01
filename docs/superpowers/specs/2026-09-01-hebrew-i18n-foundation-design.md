# Hebrew Support - Design

Date: 2026-09-01
Status: approved, ready for implementation planning
Revised: 2026-09-01, phases 2 and 3 pulled into scope. Ron: "when the language
is Hebrew I want the analysis also to happen in Hebrew." A Hebrew shell around
an English diagnosis is not the product; all three phases ship together.

## Goal

Make every word the app itself writes available in Hebrew, and let the app run
in Hebrew: resolved from the device locale on first launch, overridable by an
explicit choice in Settings that is remembered.

This is the first of three phases. It covers the machinery and the ~320 static
UI strings. It does **not** translate anything the model writes or anything in
the species catalog - see [Scope boundary](#scope-boundary).

## Current state

- **RTL layout is already done** (TODOS item 15, 2026-08-19). Every physical
  edge in `src/` is logical (`marginStart`/`End`, `paddingStart`/`End`,
  `start`/`end`); `grep -rn "marginLeft\|marginRight\|paddingLeft\|paddingRight"
  src/` returns nothing and must keep returning nothing.
- `src/lib/rtl.ts` exports `isRTL`, `mirrorInRTL`, `directionalIconStyle`,
  applied to every back/forward chevron. Yoga cannot flip an icon.
- `writingDirection: 'auto'` is set on every style that renders AI or user text.
- `app.json` declares `CFBundleLocalizations: ["en","he"]` and
  `CFBundleAllowMixedLocalizations`, so iOS can report a Hebrew locale at all.
- **Never verified on a Hebrew device.** Item 15 flags that the layout work
  needs a rebuild and a device set to Hebrew, and that Android's
  `android:supportsRtl="true"` needs confirming after the next prebuild.
- No i18n module, no i18n dependency, ~320 user-facing strings hardcoded across
  19 screens and 10 components. `expo-localization` is not installed.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Copy shape | A typed object, not string keys | `tsc` enforces that Hebrew and English stay in step; drift cannot be committed |
| Delivery | Module-level singleton, read synchronously | The language cannot change mid-session, so context and re-render plumbing buy nothing |
| Language source | Device locale, overridden by a saved preference | A Hebrew phone gets Hebrew without hunting for a setting; an explicit choice wins forever |
| Restart | Ask the user to relaunch | `Updates.reloadAsync()` rejects in Expo Go and development builds and needs EAS Update, which this project does not have |
| Dependencies | `expo-localization` only | `getLocales()` is synchronous and callable at module import, which is what a first-paint decision requires |
| Copy authorship | Claude drafts, Ron reviews | Ron is a native speaker; machine-ish Hebrew will not survive his read |

## Architecture

Five files, following the pure-logic / device-binding split already used by
`plantStore ↔ plantLibrary`, `photoStore ↔ photos` and `location ↔ services/location`.

### `src/lib/copy/en.ts` - the copy tree

Nested by screen and component. Plain strings where the copy is fixed;
functions where it is not:

```ts
export const en = {
  portfolio: {
    title: 'Portfolio',
    dueThisWeek: 'Due this week',
    moreBelow: (n: number) => `+${n} more in your plants below`,
    noneDiagnosed: 'None of your plants have been diagnosed yet. Scan one to see what it needs.',
  },
  importBanner: {
    title: (n: number) => `Import your ${n} saved plants?`,
    sub: 'They will follow you to any device you log into.',
    partial: (ok: number, failed: number) => `${ok} imported, ${failed} couldn't - tap to retry.`,
  },
  // ...
} as const;
```

A function rather than a format string is the whole point of choosing this
shape: Hebrew number agreement is Hebrew logic, and it gets to be written as
code in `he.ts` instead of squeezed into a placeholder syntax.

### `src/lib/copy/he.ts` - the Hebrew tree

```ts
import type { Copy } from './en';
export const he: Copy = { /* same shape, Hebrew strings */ };
```

Declaring the type is what does the work. A missing key, an extra key, or a
function whose arity drifted is a compile error, so there is no runtime
fallback path, no dev-time missing-key warning, and no drift test to write.
`tsc` is the drift test.

`Copy` is exported from `en.ts` (`export type Copy = typeof en`), not from
`index.ts`. Same reasoning as `catalogTypes.ts`: if the type lived in the
assembler, `he.ts` would import from `index.ts` while `index.ts` imports
`he.ts`. The type-only import would be erased and it would happen to work, but
it reads as a cycle and the next person to add a runtime export there would
make it a real one.

### `src/lib/copy/index.ts`

```ts
import { en, type Copy } from './en';
import { he } from './he';
export type { Copy };
export const TREES: Record<Language, Copy> = { en, he };
```

### `src/lib/language.ts` - pure, tested

```ts
export type Language = 'en' | 'he';
export const DEFAULT_LANGUAGE: Language = 'en';

/* Saved choice wins; device locale seeds; English is the floor. */
export function resolveLanguage(stored: string | null, deviceLocale: string | null): Language;

/* Hebrew is RTL. Kept as a function rather than a constant so a third
 * language does not have to touch every call site. */
export function isRTLLanguage(lang: Language): boolean;

/* For Intl / toLocaleDateString. */
export function localeTag(lang: Language): 'en-US' | 'he-IL';

/* Whether the running layout direction disagrees with the resolved language,
 * which is the only condition that requires a relaunch. */
export function needsDirectionChange(lang: Language, currentlyRTL: boolean): boolean;
```

No native imports, so it runs under bare `node --test`.

### `src/services/language.ts` - the only file touching natives

Reads the device locale via `getLocales()[0].languageCode`, reads the saved
preference from `expo-sqlite/kv-store` synchronously, resolves once at module
import, and exports:

```ts
export const copy: Copy;
export function getLanguage(): Language;
export function setLanguage(lang: Language): void;
export function directionNeedsRelaunch(): boolean;
```

## Data flow

**Startup.** `services/language.ts` is imported → synchronous kv read →
synchronous `getLocales()` → `resolveLanguage()` → `copy` is bound before the
first render. Screens read it directly:

```ts
import { copy } from '../services/language';
<Text style={s.libTitle}>{copy.portfolio.title}</Text>
```

**RTL.** On a Hebrew phone, iOS and Android are expected to set RTL themselves
at launch, because `CFBundleLocalizations` declares Hebrew - so first launch
needs no intervention. **This expectation is unverified and Task 1 of the plan
is to verify it on a real Hebrew device before anything is built on top of it.**
If it does not hold, `I18nManager.forceRTL` has to run before first paint and
the first-launch case gains a relaunch it should not need.

**Switching.** Settings → Language → `setLanguage('he')` persists the choice.
Because en↔he always reverses direction, the screen then calls
`I18nManager.forceRTL(true)` and shows a dismissible notice: *"Language changed.
Close and reopen PlantAI to finish."* No automatic restart -
`Updates.reloadAsync()` is unavailable here (see Decisions).

**Dates.** `toLocaleDateString(undefined, …)` means *device* locale, so a user
who picks Hebrew on an English phone would read Hebrew copy over English dates.
Five call sites (`PlantDetailScreen:560`, `WateringHistoryScreen:313,382,390`,
`lib/calendar.ts:79`) pass `localeTag(getLanguage())` instead of `undefined`.

## Scope boundary

Phases 2 and 3 are specified below. Untouched: scraped nursery data, which is
already Hebrew.

**Plants keep the language they were diagnosed in.** A stored `diagnosis` is a
paid artifact. Re-fetching one because a setting changed would spend money to
overwrite a record the user already trusts, and would silently rewrite history
on a screen they were reading. Phase 2 applies to new diagnoses only.

## Phase 2 - the analysis answers in Hebrew

`/api/diagnose` and `/api/care-plan` gain a `lang` field on the request body,
defaulting to `'en'` when absent so an older installed build keeps working.

### What the model may translate, and what it must not

This is the whole risk of phase 2. `PlantDiagnosis` mixes prose the user reads
with values the code branches on, and translating the second kind breaks the
app quietly.

| Field | Language | Why |
|---|---|---|
| `conditionLabel`, `issues[]`, `description` | Hebrew | Pure display prose |
| `treatments[].title`, `treatments[].description` | Hebrew | Display prose - but see the product note below |
| `carePlan` prose, all `bySoil` guidance | Hebrew | Display prose |
| `plantName` | Hebrew | Display, *and* it is the nursery search term - a Hebrew query is better against Israeli shops, and `scraper/core.ts` already handles Hebrew (`hasHebrew`) |
| `condition` | **English enum** | The client switches on it for colour and icon |
| `canBeSaved`, `confidence`, `genusConfidence` | **Unchanged types** | Boolean and numbers |
| `identificationSource` | **English enum** | Branched on |
| `scientificName` | **Latin** | Botanical names are universal; "translating" one destroys it |
| `genus` | **Latin** | The care-plan cache key AND the catalog match key. Hebrew here fragments the cache and silently breaks every catalog lookup |

### `treatmentProduct` must stop parsing prose

`src/lib/treatments.ts` finds the buyable product in a treatment by parsing the
English title against English substance names and English action words
(`'neem oil'`, `'wipe'`, `'apply'`). Hand it Hebrew and it returns null for
everything, so the "Find Confidor nearby" button - the app's entire commerce
path out of a diagnosis - silently stops rendering.

The fix is a contract change, not a Hebrew word list: `Treatment` gains an
optional `product?: string`, in English or a brand name, supplied by the model
which already knows whether it just recommended a purchasable thing. The client
reads that field instead of guessing from prose.

`treatmentProduct` stays as the fallback for diagnoses saved before the field
existed, and for a model response that omits it. It keeps its tests. It just
stops being the primary path, which it never should have been.

### Cache keys

`cacheKeyFor(genus)` becomes `cacheKeyFor(genus, lang)` and the prefix version
bumps. Without this a user who switches to Hebrew reads their own cached
English plans forever, and the first Hebrew fetch overwrites the English one
for every genus they own. There is no server-side care-plan cache, so the cost
of the split is one extra model call per genus per language per install.

### Saved plants keep the language they were diagnosed in

A stored `diagnosis` is a paid artifact. Re-fetching one because a setting
changed would spend money to overwrite a record the user already trusts, and
would rewrite history under someone reading it. Switching to Hebrew makes *new*
analyses Hebrew; existing plants keep their text. Their care plan, which is
cached by genus rather than stored on the plant, does re-fetch in Hebrew.

## Phase 3 - the species catalog

`CatalogEntry` gains optional Hebrew fields; the English ones stay required and
authoritative.

```ts
nameHe?: string;        // 'מונסטרה דליציוזה'
synonymsHe?: string[];  // what Israelis actually type
```

`scientificName`, `genus`, `group` and `family` stay as they are: Latin is
Latin, and `genus` is a key.

**Display** goes through `plantDisplayName`-style helpers that fall back to the
English name when `nameHe` is absent. **Search** matches Hebrew and English at
once, so typing "מונסטרה" or "monstera" finds the same entry - Israeli growers
mix both constantly.

**Authoring, not translating.** Most of these names are established
transliterations (מונסטרה, פילודנדרון, אלוקזיה) and those are unambiguous. Where
no Hebrew name is in real use, the field is left absent and the English name
shows - inventing a Hebrew name nobody searches for is worse than showing the
one they know. All 359 entries are drafted by Claude and reviewed by Ron.

## Error handling

| Failure | Behaviour |
|---|---|
| `getLocales()` returns empty or throws | English |
| Saved preference is not a known language | English, and the bad value is overwritten |
| Hebrew tree somehow missing at runtime | Cannot happen - `tsc` guarantees the shape |
| User ignores the relaunch notice | App stays in the old direction with the old copy until relaunch; the choice is already persisted, so the next launch is correct either way |

## Testing

- `src/lib/language.test.ts` - the `resolveLanguage` matrix (saved beats locale,
  locale seeds, unknown values fall to English, null-safe), `isRTLLanguage`,
  `localeTag`, and `needsDirectionChange`.
- `src/lib/copy/copy.test.ts` - every *function* in both trees: interpolation
  and Hebrew number agreement. The shape needs no test; `tsc` owns it.
- Screens remain untested - there is still no component runner (Trello #23).
  That is precisely why the language decision lives in `lib/` and the screens
  only read a value.

Phase 2 adds `server/carePlan.test.ts` and `server/diagnose.test.ts` cases for
the `lang` parameter and for the enum fields surviving a Hebrew response, a
`genusCarePlan.test.ts` case proving two languages cannot share a cache entry,
and a `treatments.test.ts` case proving the new `product` field wins over the
prose parser while the parser still covers older saved diagnoses.

Phase 3 adds `catalogSearch.test.ts` cases for Hebrew query matching and for
falling back to the English name when `nameHe` is absent.

Existing gate stays: `npm run typecheck` and `node --test` green, and the
no-physical-edges grep still returns nothing.

## Work shape

Extraction proceeds screen by screen so each slice typechecks on its own,
heaviest first (Portfolio, Nurseries, PlantDetail, Camera, AddPlant, Diagnosis
are ~170 of the ~320 strings). Accessibility labels are copy too - they are read
aloud, and an English `accessibilityLabel` on a Hebrew button is worse than no
label.

`expo-localization` is a native module, so this needs `expo run:ios` and a
reinstall. The Metro reload currently in use will not pick it up.

Order is phase 1, then 2, then 3, each committed separately. Phase 1 is the
largest edit but the least risky; phase 2 carries the contract risk described
above; phase 3 is bulk data authoring. Verification is a Hebrew iOS simulator
(`xcrun simctl` sets the locale) driven by Ron - the app has no component test
runner, so the screens can only be checked by looking at them.
