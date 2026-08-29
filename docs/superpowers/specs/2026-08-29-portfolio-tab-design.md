# Portfolio Tab — Design

Date: 2026-08-29
Status: approved, ready for implementation planning

## Goal

Replace the "My Plants" tab with a **Portfolio** tab that holds every plant a
user owns — the ones they photographed for a diagnosis and the healthy ones
they add by hand. Adding by hand means a photo plus a species picked from a
searchable, sectioned catalog. Each plant carries a growing medium, and the care
plan it is shown is the one for its genus **in that medium**. Watering and
fertilizer schedules move onto the plant's own screen, with a rolled-up view on
Portfolio.

## Current state

- `src/navigation/Tabs.tsx` — three tabs: `MyPlants` (HomeScreen), `Scan`
  (pushes the root-stack Camera), `Find` (PlantSearchScreen, nursery search).
- `src/screens/HomeScreen.tsx` (415 lines) — adaptive: marketing copy on first
  run, the library afterwards, grouped by `triageSections`.
- `src/screens/PlantDetailScreen.tsx` (705 lines) — care plan rows, care log
  rows, watering card, nursery link.
- `src/screens/WateringHistoryScreen.tsx` (509 lines) — calendar for water /
  repot / fertilizer.
- `src/services/plantStore.ts` — synchronous AsyncStorage-backed library.
  `LIBRARY_VERSION = 1`, migration machinery already in place. `StoredPlant`
  **requires** `diagnosis`, so there is no way to record a plant that was never
  scanned.
- `src/lib/watering.ts` / `src/lib/care.ts` — pure schedule engine.
  `careState(kind, carePlan, lastAt, now)` returns a `WateringState`. Repot and
  fertilizer intervals are hardcoded constants because no care plan has ever
  carried them.
- No species catalog, no soil field, no manual-add path.

## Architecture

### 1. Species catalog — `src/data/plantCatalog.ts`

A hand-authored four-level tree, shipped in the bundle:

```
Family (Aroids)
  └── Genus (Alocasia)
        └── Group (Rare Alocasias)
              └── Cultivar (Dragon Scale Mint Variegated)
```

```ts
export interface CatalogEntry {
  id: string;               // 'alocasia-dragon-scale-mint-variegated'
  name: string;             // 'Dragon Scale Mint Variegated'
  scientificName: string;   // 'Alocasia baginda'
  genus: string;            // 'Alocasia'
  group: string;            // 'Rare Alocasias'
  family: string;           // 'Aroids'
  synonyms?: string[];      // 'dragon scale', 'baginda'
}
```

The module builds a flat index once at load. `searchCatalog(query)` matches
case- and diacritic-insensitive substrings across `name`, `scientificName` and
`synonyms`, and returns SectionList-shaped sections grouped family → genus →
group. An empty query returns the browsable tree rather than nothing, so the
picker is useful before the user types.

Seed size: roughly 350 entries, aroid-heavy (Alocasia, Philodendron, Monstera,
Anthurium, Syngonium, Scindapsus, Epipremnum) plus about 60 common non-aroid
houseplants (Ficus, Calathea, Hoya, Sansevieria, Peperomia, succulents).

A Trello card is filed to move the catalog server-side later. The service
boundary — everything goes through `searchCatalog` / `getEntry` — is designed so
a network source can replace the static file without touching the UI.

### 2. Genus care plans, per soil — `src/services/genusCarePlans.ts`

One LLM call per **genus**, returning a plan for **every soil medium** in a
single response. Adding a second Alocasia costs nothing regardless of which
medium the user picks, because the genus is already cached.

```ts
export interface SoilCarePlan {
  water: string;                 // prose advice
  waterEveryDays: number;        // what the schedule is built on
  waterEveryDaysMax?: number;
  fertilizer: string;
  fertilizeEveryDays: number;
  light: string;
  humidity: string;
  warnings?: string[];           // 'Pon wants a reservoir, not top-watering'
}

export interface GenusCarePlan {
  genus: string;
  family: string;
  fetchedAt: string;             // ISO-8601
  bySoil: Record<SoilMediumId, SoilCarePlan>;
}
```

- Cache: AsyncStorage, one key per genus, the whole `bySoil` map stored
  together. Cache hit means zero network.
- Server: new route `POST /api/care-plan { genus, family }`, validated the way
  `server/diagnose.ts` validates its model output. **A response missing any
  soil key is rejected and never cached** — a partial answer would leave a
  medium permanently planless.
- Detail screen renders `bySoil[plant.soilMedium]`. Changing the medium on a
  saved plant swaps the plan and reschedules watering immediately, offline.

### 3. Soil media — `src/lib/soilMedia.ts`

Eight media: potting mix, LECA, Pon, sphagnum, bark/orchid, perlite mix,
semi-hydro, water.

```ts
export interface SoilMedium {
  id: SoilMediumId;
  label: string;
  description: string;           // one line, shown under the label
  icon: keyof typeof Ionicons.glyphMap;
  tint: keyof Theme['color'];
  /* Fallback only — see below. */
  waterMultiplier: number;
}
```

Each renders as a layered Ionicons composition — glyph over a tinted backing
disc with a texture treatment — so the picker reads as illustration rather than
a toolbar. Theme-aware, no binary assets.

`waterMultiplier` is a **fallback**, used only in the window before a genus plan
is cached (first launch offline, or a failed call): base interval from the
diagnosis `carePlan.waterEveryDays`, scaled by the medium. Once `bySoil` lands,
the genus plan wins and the multiplier is ignored.

### 4. Store — `src/services/plantStore.ts`, `LIBRARY_VERSION` 1 → 2

```ts
export interface StoredPlant {
  // ...existing fields unchanged...
  diagnosis?: PlantDiagnosis;    // was required
  addedVia: 'scan' | 'manual';
  catalogId?: string;
  species?: {
    name: string;
    scientificName: string;
    genus: string;
    family: string;
  };
  soilMedium?: SoilMediumId;
  nickname?: string;
}
```

- Migration step 1 → 2 stamps every existing record `addedVia: 'scan'`.
- `isStoredPlant` relaxes the `diagnosis` requirement and gains a check that
  **either** `diagnosis` **or** `species` is present — a record with neither has
  no identity and cannot be rendered.
- New `saveManual({ photoUri, species, catalogId, soilMedium, nickname })`.
- `update()` widens its patch to `soilMedium | nickname | catalogId | species`.
  `diagnosis` stays unpatchable, for the reason already documented there.

One record type, not two: a scanned plant can gain a soil medium and a catalog
link; a manual plant can later be scanned and gain a diagnosis.

### 5. Portfolio tab

- `MainTabParamList.MyPlants` → `Portfolio`; tab title "Portfolio". The root
  stack route stays `Home`, so the eleven existing `navigate('Home')` call sites
  are untouched.
- One list of all plants. Filter chips: **All / Diagnosed**. A diagnosed plant's
  card carries a "Diagnosed" badge on its trailing edge, so the user can see at
  a glance which plants have been through the camera.
- A "Due this week" strip above the list, rolled up across every plant and every
  care kind.
- FAB "Add plant" opens the add flow.
- First-run marketing copy behaves as it does today when the library is empty.

### 6. Add-plant flow — root-stack `AddPlant`

Photo (camera or library, via the existing `photos` service) → species picker →
soil medium → optional nickname → save. The species picker is its own screen
(`SpeciesPickerScreen`): a search field over a sectioned list, keyboard-driven,
with the browsable tree when the query is empty. On save, the genus care plan is
fetched or read from cache.

### 7. Schedules in both places

`PlantDetailScreen` becomes the home of the full watering and fertilizer
schedule: next due, interval, log buttons, calendar link, the soil card and the
genus care plan. It is already 705 lines, so this work splits it into
`WateringScheduleCard`, `FertilizerScheduleCard`, `CarePlanCard` and `SoilCard`
components under `src/components/`.

Fertilizer stops being a hardcoded constant when a genus plan exists:
`intervalPlanFor('fertilizer', ...)` reads `fertilizeEveryDays` from the soil
plan and falls back to `FERTILIZE_EVERY_DAYS` when there is none. Repot keeps
its constant — no genus plan carries a repot interval.

## Data flow

```
AddPlant → SpeciesPicker → CatalogEntry
         → SoilPicker    → SoilMediumId
         → plantStore.saveManual()
         → genusCarePlans.get(genus)  ── cache hit ─→ done
                                      └─ miss ─→ POST /api/care-plan → cache

PlantDetail → plant.soilMedium + genusCarePlans.get(plant.species.genus)
            → bySoil[medium] → careState() → schedule UI
```

## Error handling

- Care-plan call fails or the device is offline: fall back to the diagnosis care
  plan (scanned plants) or to genus-agnostic defaults scaled by
  `waterMultiplier` (manual plants). The plant saves either way — a failed
  network call must never block adding a plant.
- Care-plan response missing a soil key: rejected server-side, nothing cached,
  client takes the fallback path.
- Catalog entry id no longer in the bundle after an app update: the plant keeps
  its denormalized `species` snapshot, so it still renders and still resolves a
  genus plan. `catalogId` is a convenience, not the source of truth.
- Library migration failure: existing quarantine behaviour, unchanged.

## Testing

- `plantCatalog.test.ts` — search matches name / scientific / synonym, is
  diacritic-insensitive, sections nest correctly, empty query returns the tree,
  every entry id is unique.
- `soilMedia.test.ts` — every `SoilMediumId` has a medium, multipliers within a
  sane range.
- `genusCarePlans.test.ts` — cache hit avoids the call, miss calls once, a
  response missing a soil key is rejected, a second species in a cached genus
  costs nothing.
- `plantStore.test.ts` — migration 1 → 2 stamps `addedVia`, `saveManual`
  round-trips, a record with neither diagnosis nor species is dropped,
  `update()` patches the new fields and still refuses `diagnosis`.
- `care.test.ts` — fertilizer interval comes from the soil plan when present,
  falls back to the constant when absent.
- Portfolio due-rollup — a pure function, tested without a device.

Manual testing (device, Ron's): the add-plant flow end to end, the species
search with a physical keyboard, the soil picker's appearance in light and dark,
and the schedule swap when a saved plant's medium changes.

## Out of scope

- Supabase sync for the new fields. The epic3 plants-sync migration in the
  working tree stays untouched.
- A server-hosted catalog (Trello card filed).
- Editing or authoring catalog entries in-app.
