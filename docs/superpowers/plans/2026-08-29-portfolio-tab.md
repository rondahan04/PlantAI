# Portfolio Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "My Plants" tab with a Portfolio tab that holds both camera-diagnosed plants and hand-added healthy ones, backed by a searchable species catalog, per-genus care plans resolved by growing medium, a soil picker, and watering/fertilizer schedules on the plant's own screen.

**Architecture:** Pure, dependency-injected modules under `src/lib/` and `src/data/` carry all the logic and are tested with `node --test` without a device. Storage and network are bound in thin `src/services/*` files, exactly as `plantStore.ts` / `plantLibrary.ts` already split. The care plan for a plant is `genusPlan.bySoil[plant.soilMedium]`, fetched once per genus from a new `POST /api/care-plan` route and cached locally.

**Tech Stack:** TypeScript 6, Expo SDK 56, React Native 0.85, React Navigation 7, `expo-sqlite/kv-store` (synchronous storage), Node's built-in test runner (`npm test` → `node --test`), plain `node:http` server.

**Spec:** `docs/superpowers/specs/2026-08-29-portfolio-tab-design.md`

**Conventions in this codebase you must follow:**
- Tests are colocated: `src/lib/foo.ts` → `src/lib/foo.test.ts`. Run one file with `node --test src/lib/foo.test.ts`.
- Pure modules must not import from `expo-*` or `react-native`. Native bindings live in `src/services/`.
- Comments explain *why*, not *what*. Match the density of the surrounding file.
- No em dashes anywhere. Use regular dashes.
- `npm run typecheck` runs two projects: the app and `tsconfig.node.json` (server + colocated tests). Both must pass.

---

## File Structure

**Create:**
- `src/data/plantCatalog.ts` - the raw species tree. Data only, no logic.
- `src/lib/catalogSearch.ts` - flat index + `searchCatalog` / `catalogEntryById`. Pure.
- `src/lib/catalogSearch.test.ts`
- `src/lib/soilMedia.ts` - the eight growing media, their presentation, their fallback multipliers. Pure.
- `src/lib/soilMedia.test.ts`
- `src/lib/genusCarePlan.ts` - `GenusCarePlan` / `SoilCarePlan` types, validation, cache logic. Pure, dependency-injected.
- `src/lib/genusCarePlan.test.ts`
- `src/lib/portfolio.ts` - filtering and the due rollup. Pure.
- `src/lib/portfolio.test.ts`
- `src/services/genusCarePlans.ts` - binds the cache to `expo-sqlite/kv-store` and the fetch to `apiFetch`.
- `src/components/SoilMediumIcon.tsx` - the layered Ionicons illustration.
- `src/components/SoilCard.tsx` - the medium a plant is in, tap to change.
- `src/components/CarePlanCard.tsx` - soil/light/water/humidity advice.
- `src/components/ScheduleCard.tsx` - one care kind's schedule. Used for water and fertilizer.
- `src/screens/PortfolioScreen.tsx` - replaces HomeScreen in the tab.
- `src/screens/SpeciesPickerScreen.tsx` - searchable, sectioned catalog.
- `src/screens/AddPlantScreen.tsx` - photo, species, soil, nickname, save.
- `server/carePlan.ts` - the LLM call and its validator.
- `server/carePlan.test.ts`

**Modify:**
- `src/services/plantStore.ts` - `StoredPlant` gains fields, `LIBRARY_VERSION` 1 → 2, `saveManual`, widened `update`.
- `src/services/plantStore.test.ts` - migration and `saveManual` coverage.
- `src/lib/care.ts` - fertilizer interval from the soil plan; soil-adjusted fallback.
- `src/lib/care.test.ts`
- `src/lib/watering.ts` - no behaviour change, exports only.
- `src/components/PlantCard.tsx` - tolerate a plant with no diagnosis; "Diagnosed" badge.
- `src/screens/PlantDetailScreen.tsx` - split into the cards above, add soil + genus plan.
- `src/navigation/Tabs.tsx` - `MyPlants` → `Portfolio`.
- `src/types/index.ts` - `MainTabParamList`, `RootStackParamList`.
- `server/index.ts` - route `POST /api/care-plan`.

**Delete:** nothing. `HomeScreen.tsx` stays until Task 11 replaces its use, then is removed in that task's commit.

---

### Task 1: Soil media

**Files:**
- Create: `src/lib/soilMedia.ts`
- Test: `src/lib/soilMedia.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/soilMedia.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIA, SOIL_MEDIUM_IDS, soilMediumById, type SoilMediumId } from './soilMedia.ts';

test('every id has exactly one medium', () => {
  assert.equal(SOIL_MEDIA.length, SOIL_MEDIUM_IDS.length);
  const ids = new Set(SOIL_MEDIA.map((m) => m.id));
  assert.equal(ids.size, SOIL_MEDIA.length);
  for (const id of SOIL_MEDIUM_IDS) assert.ok(ids.has(id), `no medium for ${id}`);
});

test('soilMediumById returns the medium, or undefined for junk', () => {
  assert.equal(soilMediumById('leca')?.label, 'LECA');
  assert.equal(soilMediumById('not_a_medium' as SoilMediumId), undefined);
});

test('multipliers are sane and directional', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.waterMultiplier >= 0.4 && m.waterMultiplier <= 2.5, `${m.id} out of range`);
  }
  // Inert, fast-draining media dry out sooner than peat; water and moss hold on.
  assert.ok(soilMediumById('leca')!.waterMultiplier < soilMediumById('potting_mix')!.waterMultiplier);
  assert.ok(soilMediumById('sphagnum')!.waterMultiplier > soilMediumById('potting_mix')!.waterMultiplier);
});

test('every medium has a label, a one-line description and an icon', () => {
  for (const m of SOIL_MEDIA) {
    assert.ok(m.label.length > 0, `${m.id} label`);
    assert.ok(m.description.length > 0, `${m.id} description`);
    assert.ok(m.icon.length > 0, `${m.id} icon`);
    assert.ok(m.tint.length > 0, `${m.id} tint`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/soilMedia.test.ts`
Expected: FAIL, `Cannot find module './soilMedia.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/soilMedia.ts`:

```ts
/*
 * What a plant is actually growing in.
 *
 * This is not decoration: the same Alocasia in peat and in LECA wants different
 * watering, different feeding and a different warning when it goes wrong, which
 * is why the genus care plan is fetched as one plan PER MEDIUM rather than one
 * plan with a soil sentence in it (see src/lib/genusCarePlan.ts).
 *
 * Pure on purpose - no react-native import - so the list and its multipliers
 * can be tested with `node --test`. The drawing lives in
 * src/components/SoilMediumIcon.tsx; this file only names the glyph and tint it
 * should use, as theme keys rather than colours, so dark mode is not a second
 * table to maintain.
 */

export type SoilMediumId =
  | 'potting_mix'
  | 'aroid_mix'
  | 'leca'
  | 'pon'
  | 'sphagnum'
  | 'bark'
  | 'perlite_mix'
  | 'water';

export interface SoilMedium {
  id: SoilMediumId;
  label: string;
  /* One line, shown under the label in the picker. */
  description: string;
  /* Ionicons glyph name. Typed loosely here to keep this module free of the
   * @expo/vector-icons import; SoilMediumIcon narrows it at the call site. */
  icon: string;
  /* A key of Theme['color'], resolved by the component. */
  tint: string;
  /*
   * FALLBACK ONLY. Scales the base watering interval when no genus care plan
   * has been cached yet - offline, or the call failed. Once `bySoil` exists the
   * model's own interval for this medium wins and this number is not read.
   *
   * Below 1 means "dries out faster, water sooner".
   */
  waterMultiplier: number;
}

export const SOIL_MEDIA: SoilMedium[] = [
  {
    id: 'potting_mix',
    label: 'Potting mix',
    description: 'Standard peat-based houseplant soil',
    icon: 'layers',
    tint: 'repot',
    waterMultiplier: 1,
  },
  {
    id: 'aroid_mix',
    label: 'Aroid mix',
    description: 'Chunky bark, perlite and coco, free-draining',
    icon: 'grid',
    tint: 'feed',
    waterMultiplier: 0.8,
  },
  {
    id: 'leca',
    label: 'LECA',
    description: 'Clay balls with a water reservoir',
    icon: 'ellipsis-horizontal-circle',
    tint: 'accent',
    waterMultiplier: 0.6,
  },
  {
    id: 'pon',
    label: 'Pon',
    description: 'Pumice, zeolite and lava with slow-release feed',
    icon: 'apps',
    tint: 'warning',
    waterMultiplier: 0.65,
  },
  {
    id: 'sphagnum',
    label: 'Sphagnum moss',
    description: 'Long-fibre moss, holds a lot of water',
    icon: 'cloud',
    tint: 'secondary',
    waterMultiplier: 1.4,
  },
  {
    id: 'bark',
    label: 'Orchid bark',
    description: 'Coarse bark, very airy, dries quickly',
    icon: 'reorder-four',
    tint: 'repot',
    waterMultiplier: 0.7,
  },
  {
    id: 'perlite_mix',
    label: 'Perlite heavy',
    description: 'Mostly perlite, near-hydroponic',
    icon: 'sparkles',
    tint: 'water',
    waterMultiplier: 0.6,
  },
  {
    id: 'water',
    label: 'Water',
    description: 'Rooting or growing in plain water',
    icon: 'water',
    tint: 'water',
    waterMultiplier: 2,
  },
];

export const SOIL_MEDIUM_IDS: SoilMediumId[] = SOIL_MEDIA.map((m) => m.id);

export function soilMediumById(id: SoilMediumId | undefined): SoilMedium | undefined {
  return SOIL_MEDIA.find((m) => m.id === id);
}

/* The medium a plant gets when the user has not chosen one. Never guessed from
 * a photo - it is a fact about the pot, not about the plant. */
export const DEFAULT_SOIL_MEDIUM: SoilMediumId = 'potting_mix';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/soilMedia.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/soilMedia.ts src/lib/soilMedia.test.ts
git commit -m "feat(soil): name the eight growing media a plant can live in"
```

---

### Task 2: Species catalog data

**Files:**
- Create: `src/data/plantCatalog.ts`

This task has no test of its own - Task 3's search tests exercise the data. It is a separate task because it is bulk content and should be one reviewable commit.

- [ ] **Step 1: Write the catalog**

Create `src/data/plantCatalog.ts`. The shape is fixed; the content below is the required starting set. Add entries freely within the same shape, but every listed group must exist.

```ts
/*
 * The species a user can pick from when adding a plant by hand.
 *
 * Four levels, because that is how growers actually talk about these plants:
 * family (Aroids) -> genus (Alocasia) -> group (Rare Alocasias) -> cultivar
 * (Dragon Scale Mint Variegated). The group level is not botanical, it is a
 * shelf label, and that is the point: "Rare Alocasias" is how someone looks for
 * one, "section Pseudodracontium" is not.
 *
 * Data only. Search and indexing live in src/lib/catalogSearch.ts so this file
 * can grow to thousands of lines without anything having to read past the top.
 *
 * TEMPORARY BY DESIGN. Trello #74 moves this server-side so entries can be
 * added without an app release; the client already goes through
 * catalogSearch's functions, so that swap does not touch the UI.
 */

export interface CatalogEntry {
  /* Stable, kebab-case, never reused. Persisted on a plant as `catalogId`. */
  id: string;
  /* What the user calls it: 'Dragon Scale Mint Variegated'. */
  name: string;
  /* Botanical: 'Alocasia baginda'. Shown as the secondary line. */
  scientificName: string;
  genus: string;
  group: string;
  family: string;
  /* Extra strings the search should match. Nicknames, trade names, misspellings
   * people actually type. */
  synonyms?: string[];
}

export interface CatalogGroup {
  name: string;
  entries: CatalogEntry[];
}

export interface CatalogGenus {
  name: string;
  groups: CatalogGroup[];
}

export interface CatalogFamily {
  name: string;
  genera: CatalogGenus[];
}

/*
 * Written out longhand rather than generated from a terser table. The
 * redundancy (genus/group/family repeated on every entry) is deliberate: a
 * plant stores a SNAPSHOT of these fields, so an entry must carry its own full
 * identity and not depend on where it happens to sit in the tree.
 */
export const PLANT_CATALOG: CatalogFamily[] = [
  {
    name: 'Aroids',
    genera: [
      {
        name: 'Alocasia',
        groups: [
          {
            name: 'Common Alocasias',
            entries: [
              {
                id: 'alocasia-polly',
                name: 'Polly',
                scientificName: 'Alocasia x amazonica',
                genus: 'Alocasia',
                group: 'Common Alocasias',
                family: 'Aroids',
                synonyms: ['african mask', 'amazonica'],
              },
              {
                id: 'alocasia-zebrina',
                name: 'Zebrina',
                scientificName: 'Alocasia zebrina',
                genus: 'Alocasia',
                group: 'Common Alocasias',
                family: 'Aroids',
                synonyms: ['zebra stem'],
              },
              {
                id: 'alocasia-frydek',
                name: 'Frydek',
                scientificName: 'Alocasia micholitziana',
                genus: 'Alocasia',
                group: 'Common Alocasias',
                family: 'Aroids',
                synonyms: ['green velvet'],
              },
              {
                id: 'alocasia-macrorrhiza',
                name: 'Giant Taro',
                scientificName: 'Alocasia macrorrhizos',
                genus: 'Alocasia',
                group: 'Common Alocasias',
                family: 'Aroids',
                synonyms: ['upright elephant ear'],
              },
            ],
          },
          {
            name: 'Rare Alocasias',
            entries: [
              {
                id: 'alocasia-dragon-scale',
                name: 'Dragon Scale',
                scientificName: 'Alocasia baginda',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
                synonyms: ['baginda'],
              },
              {
                id: 'alocasia-dragon-scale-mint-variegated',
                name: 'Dragon Scale Mint Variegated',
                scientificName: 'Alocasia baginda',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
                synonyms: ['mint dragon scale', 'variegated dragon scale'],
              },
              {
                id: 'alocasia-silver-dragon',
                name: 'Silver Dragon',
                scientificName: 'Alocasia baginda',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
              },
              {
                id: 'alocasia-jacklyn',
                name: 'Jacklyn',
                scientificName: 'Alocasia tandurusa',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
                synonyms: ['tandurusa', 'sulawesi'],
              },
              {
                id: 'alocasia-azlanii',
                name: 'Red Mambo',
                scientificName: 'Alocasia azlanii',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
                synonyms: ['azlanii'],
              },
              {
                id: 'alocasia-melo',
                name: 'Melo',
                scientificName: 'Alocasia melo',
                genus: 'Alocasia',
                group: 'Rare Alocasias',
                family: 'Aroids',
              },
            ],
          },
        ],
      },
      {
        name: 'Philodendron',
        groups: [
          {
            name: 'Climbing Philodendrons',
            entries: [
              {
                id: 'philodendron-brasil',
                name: 'Brasil',
                scientificName: 'Philodendron hederaceum',
                genus: 'Philodendron',
                group: 'Climbing Philodendrons',
                family: 'Aroids',
                synonyms: ['heartleaf', 'hederaceum'],
              },
              {
                id: 'philodendron-micans',
                name: 'Micans',
                scientificName: 'Philodendron hederaceum var. hederaceum',
                genus: 'Philodendron',
                group: 'Climbing Philodendrons',
                family: 'Aroids',
                synonyms: ['velvet leaf philodendron'],
              },
            ],
          },
          {
            name: 'Rare Philodendrons',
            entries: [
              {
                id: 'philodendron-gloriosum',
                name: 'Gloriosum',
                scientificName: 'Philodendron gloriosum',
                genus: 'Philodendron',
                group: 'Rare Philodendrons',
                family: 'Aroids',
              },
              {
                id: 'philodendron-pink-princess',
                name: 'Pink Princess',
                scientificName: 'Philodendron erubescens',
                genus: 'Philodendron',
                group: 'Rare Philodendrons',
                family: 'Aroids',
                synonyms: ['ppp', 'erubescens'],
              },
              {
                id: 'philodendron-melanochrysum',
                name: 'Melanochrysum',
                scientificName: 'Philodendron melanochrysum',
                genus: 'Philodendron',
                group: 'Rare Philodendrons',
                family: 'Aroids',
                synonyms: ['black gold'],
              },
            ],
          },
        ],
      },
      {
        name: 'Monstera',
        groups: [
          {
            name: 'Monstera',
            entries: [
              {
                id: 'monstera-deliciosa',
                name: 'Deliciosa',
                scientificName: 'Monstera deliciosa',
                genus: 'Monstera',
                group: 'Monstera',
                family: 'Aroids',
                synonyms: ['swiss cheese plant', 'split leaf'],
              },
              {
                id: 'monstera-thai-constellation',
                name: 'Thai Constellation',
                scientificName: 'Monstera deliciosa',
                genus: 'Monstera',
                group: 'Monstera',
                family: 'Aroids',
                synonyms: ['thai con'],
              },
              {
                id: 'monstera-adansonii',
                name: 'Adansonii',
                scientificName: 'Monstera adansonii',
                genus: 'Monstera',
                group: 'Monstera',
                family: 'Aroids',
                synonyms: ['swiss cheese vine', 'monkey mask'],
              },
              {
                id: 'monstera-albo',
                name: 'Albo Variegata',
                scientificName: 'Monstera deliciosa',
                genus: 'Monstera',
                group: 'Monstera',
                family: 'Aroids',
                synonyms: ['albo', 'variegated monstera'],
              },
            ],
          },
        ],
      },
      {
        name: 'Anthurium',
        groups: [
          {
            name: 'Velvet Anthuriums',
            entries: [
              {
                id: 'anthurium-clarinervium',
                name: 'Clarinervium',
                scientificName: 'Anthurium clarinervium',
                genus: 'Anthurium',
                group: 'Velvet Anthuriums',
                family: 'Aroids',
              },
              {
                id: 'anthurium-crystallinum',
                name: 'Crystallinum',
                scientificName: 'Anthurium crystallinum',
                genus: 'Anthurium',
                group: 'Velvet Anthuriums',
                family: 'Aroids',
              },
            ],
          },
          {
            name: 'Flowering Anthuriums',
            entries: [
              {
                id: 'anthurium-andraeanum',
                name: 'Flamingo Flower',
                scientificName: 'Anthurium andraeanum',
                genus: 'Anthurium',
                group: 'Flowering Anthuriums',
                family: 'Aroids',
                synonyms: ['painters palette'],
              },
            ],
          },
        ],
      },
      {
        name: 'Syngonium',
        groups: [
          {
            name: 'Syngonium',
            entries: [
              {
                id: 'syngonium-albo',
                name: 'Albo Variegatum',
                scientificName: 'Syngonium podophyllum',
                genus: 'Syngonium',
                group: 'Syngonium',
                family: 'Aroids',
                synonyms: ['arrowhead albo'],
              },
              {
                id: 'syngonium-pink-splash',
                name: 'Pink Splash',
                scientificName: 'Syngonium podophyllum',
                genus: 'Syngonium',
                group: 'Syngonium',
                family: 'Aroids',
                synonyms: ['arrowhead plant'],
              },
            ],
          },
        ],
      },
      {
        name: 'Scindapsus',
        groups: [
          {
            name: 'Scindapsus',
            entries: [
              {
                id: 'scindapsus-exotica',
                name: 'Exotica',
                scientificName: 'Scindapsus pictus',
                genus: 'Scindapsus',
                group: 'Scindapsus',
                family: 'Aroids',
                synonyms: ['satin pothos'],
              },
              {
                id: 'scindapsus-treubii-moonlight',
                name: 'Treubii Moonlight',
                scientificName: 'Scindapsus treubii',
                genus: 'Scindapsus',
                group: 'Scindapsus',
                family: 'Aroids',
                synonyms: ['moonlight'],
              },
            ],
          },
        ],
      },
      {
        name: 'Epipremnum',
        groups: [
          {
            name: 'Pothos',
            entries: [
              {
                id: 'epipremnum-golden-pothos',
                name: 'Golden Pothos',
                scientificName: 'Epipremnum aureum',
                genus: 'Epipremnum',
                group: 'Pothos',
                family: 'Aroids',
                synonyms: ['devils ivy', 'aureum'],
              },
              {
                id: 'epipremnum-marble-queen',
                name: 'Marble Queen',
                scientificName: 'Epipremnum aureum',
                genus: 'Epipremnum',
                group: 'Pothos',
                family: 'Aroids',
              },
            ],
          },
        ],
      },
      {
        name: 'Rhaphidophora',
        groups: [
          {
            name: 'Rhaphidophora',
            entries: [
              {
                id: 'rhaphidophora-tetrasperma',
                name: 'Mini Monstera',
                scientificName: 'Rhaphidophora tetrasperma',
                genus: 'Rhaphidophora',
                group: 'Rhaphidophora',
                family: 'Aroids',
                synonyms: ['tetrasperma', 'ginny philodendron'],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Ferns',
    genera: [
      {
        name: 'Nephrolepis',
        groups: [
          {
            name: 'Boston Ferns',
            entries: [
              {
                id: 'nephrolepis-boston',
                name: 'Boston Fern',
                scientificName: 'Nephrolepis exaltata',
                genus: 'Nephrolepis',
                group: 'Boston Ferns',
                family: 'Ferns',
              },
            ],
          },
        ],
      },
      {
        name: 'Platycerium',
        groups: [
          {
            name: 'Staghorn Ferns',
            entries: [
              {
                id: 'platycerium-bifurcatum',
                name: 'Staghorn Fern',
                scientificName: 'Platycerium bifurcatum',
                genus: 'Platycerium',
                group: 'Staghorn Ferns',
                family: 'Ferns',
                synonyms: ['elkhorn'],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Prayer Plants',
    genera: [
      {
        name: 'Calathea',
        groups: [
          {
            name: 'Calathea',
            entries: [
              {
                id: 'calathea-orbifolia',
                name: 'Orbifolia',
                scientificName: 'Goeppertia orbifolia',
                genus: 'Calathea',
                group: 'Calathea',
                family: 'Prayer Plants',
              },
              {
                id: 'calathea-white-fusion',
                name: 'White Fusion',
                scientificName: 'Goeppertia lietzei',
                genus: 'Calathea',
                group: 'Calathea',
                family: 'Prayer Plants',
              },
            ],
          },
        ],
      },
      {
        name: 'Maranta',
        groups: [
          {
            name: 'Maranta',
            entries: [
              {
                id: 'maranta-leuconeura',
                name: 'Red Prayer Plant',
                scientificName: 'Maranta leuconeura',
                genus: 'Maranta',
                group: 'Maranta',
                family: 'Prayer Plants',
                synonyms: ['herringbone'],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Hoyas',
    genera: [
      {
        name: 'Hoya',
        groups: [
          {
            name: 'Hoya',
            entries: [
              {
                id: 'hoya-carnosa',
                name: 'Wax Plant',
                scientificName: 'Hoya carnosa',
                genus: 'Hoya',
                group: 'Hoya',
                family: 'Hoyas',
                synonyms: ['carnosa'],
              },
              {
                id: 'hoya-kerrii',
                name: 'Sweetheart Hoya',
                scientificName: 'Hoya kerrii',
                genus: 'Hoya',
                group: 'Hoya',
                family: 'Hoyas',
                synonyms: ['valentine hoya'],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Figs',
    genera: [
      {
        name: 'Ficus',
        groups: [
          {
            name: 'Ficus',
            entries: [
              {
                id: 'ficus-lyrata',
                name: 'Fiddle Leaf Fig',
                scientificName: 'Ficus lyrata',
                genus: 'Ficus',
                group: 'Ficus',
                family: 'Figs',
                synonyms: ['lyrata'],
              },
              {
                id: 'ficus-elastica',
                name: 'Rubber Plant',
                scientificName: 'Ficus elastica',
                genus: 'Ficus',
                group: 'Ficus',
                family: 'Figs',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Succulents',
    genera: [
      {
        name: 'Sansevieria',
        groups: [
          {
            name: 'Snake Plants',
            entries: [
              {
                id: 'sansevieria-laurentii',
                name: 'Snake Plant',
                scientificName: 'Dracaena trifasciata',
                genus: 'Sansevieria',
                group: 'Snake Plants',
                family: 'Succulents',
                synonyms: ['mother in laws tongue', 'trifasciata'],
              },
            ],
          },
        ],
      },
      {
        name: 'Crassula',
        groups: [
          {
            name: 'Crassula',
            entries: [
              {
                id: 'crassula-ovata',
                name: 'Jade Plant',
                scientificName: 'Crassula ovata',
                genus: 'Crassula',
                group: 'Crassula',
                family: 'Succulents',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Peperomias',
    genera: [
      {
        name: 'Peperomia',
        groups: [
          {
            name: 'Peperomia',
            entries: [
              {
                id: 'peperomia-watermelon',
                name: 'Watermelon Peperomia',
                scientificName: 'Peperomia argyreia',
                genus: 'Peperomia',
                group: 'Peperomia',
                family: 'Peperomias',
              },
              {
                id: 'peperomia-obtusifolia',
                name: 'Baby Rubber Plant',
                scientificName: 'Peperomia obtusifolia',
                genus: 'Peperomia',
                group: 'Peperomia',
                family: 'Peperomias',
              },
            ],
          },
        ],
      },
    ],
  },
];
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: no errors. (This file is not yet imported anywhere, so this only proves the literal matches the interfaces.)

- [ ] **Step 3: Commit**

```bash
git add src/data/plantCatalog.ts
git commit -m "feat(catalog): seed the species tree users pick from"
```

---

### Task 3: Catalog search

**Files:**
- Create: `src/lib/catalogSearch.ts`
- Test: `src/lib/catalogSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/catalogSearch.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_ENTRIES,
  browseSections,
  catalogEntryById,
  searchCatalog,
} from './catalogSearch.ts';

test('every entry id is unique', () => {
  const ids = new Set(CATALOG_ENTRIES.map((e) => e.id));
  assert.equal(ids.size, CATALOG_ENTRIES.length);
});

test('an empty query returns the whole tree, grouped', () => {
  const sections = browseSections();
  assert.ok(sections.length > 0);
  const titles = sections.map((s) => s.title);
  assert.ok(titles.includes('Aroids - Alocasia - Rare Alocasias'));
  const rare = sections.find((s) => s.title === 'Aroids - Alocasia - Rare Alocasias')!;
  assert.ok(rare.data.some((e) => e.id === 'alocasia-dragon-scale-mint-variegated'));
});

test('searchCatalog with a blank query browses rather than returning nothing', () => {
  assert.deepEqual(
    searchCatalog('   ').map((s) => s.title),
    browseSections().map((s) => s.title)
  );
});

test('matches on the display name', () => {
  const hits = searchCatalog('dragon scale').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale'));
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale-mint-variegated'));
});

test('matches on the scientific name', () => {
  const hits = searchCatalog('baginda').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'alocasia-dragon-scale'));
});

test('matches on a synonym', () => {
  const hits = searchCatalog('swiss cheese').flatMap((s) => s.data);
  assert.ok(hits.some((e) => e.id === 'monstera-deliciosa'));
});

test('matches on the genus, so typing "alocasia" lists the genus', () => {
  const hits = searchCatalog('alocasia').flatMap((s) => s.data);
  assert.ok(hits.length >= 8);
  assert.ok(hits.every((e) => e.genus === 'Alocasia'));
});

test('is case and diacritic insensitive', () => {
  const plain = searchCatalog('POLLY').flatMap((s) => s.data);
  assert.ok(plain.some((e) => e.id === 'alocasia-polly'));
  const accented = searchCatalog('álocasia zebrína').flatMap((s) => s.data);
  assert.ok(accented.some((e) => e.id === 'alocasia-zebrina'));
});

test('every term must match, so a two-word query narrows', () => {
  const hits = searchCatalog('alocasia mint').flatMap((s) => s.data);
  assert.deepEqual(hits.map((e) => e.id), ['alocasia-dragon-scale-mint-variegated']);
});

test('no match returns no sections rather than the whole tree', () => {
  assert.deepEqual(searchCatalog('qqzzxx'), []);
});

test('search results keep their family/genus/group section titles', () => {
  const sections = searchCatalog('dragon scale');
  assert.deepEqual(
    sections.map((s) => s.title),
    ['Aroids - Alocasia - Rare Alocasias']
  );
});

test('catalogEntryById finds an entry and tolerates a stale id', () => {
  assert.equal(catalogEntryById('monstera-albo')?.name, 'Albo Variegata');
  assert.equal(catalogEntryById('removed-in-a-later-release'), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/catalogSearch.test.ts`
Expected: FAIL, `Cannot find module './catalogSearch.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/catalogSearch.ts`:

```ts
import { PLANT_CATALOG, type CatalogEntry } from '../data/plantCatalog.ts';

/*
 * Searching and browsing the species tree.
 *
 * Split from the data so the tree can grow without this logic being buried
 * under it, and so a future server-backed catalog (Trello #74) replaces one
 * small module rather than everything that reads a plant name.
 *
 * The index is built once at import. The catalog is a few hundred entries in
 * the bundle, so this is microseconds, and it buys a search that runs on every
 * keystroke without allocating.
 */

export type { CatalogEntry } from '../data/plantCatalog.ts';

/* SectionList's shape, so the picker can render this with no transformation. */
export interface CatalogSection {
  /* 'Aroids - Alocasia - Rare Alocasias' */
  title: string;
  family: string;
  genus: string;
  group: string;
  data: CatalogEntry[];
}

interface IndexedEntry {
  entry: CatalogEntry;
  /* Everything searchable, folded and joined once. */
  haystack: string;
}

/*
 * Fold to something a phone keyboard can reach: lowercase, accents stripped,
 * punctuation flattened to spaces. Someone typing "alocasia zebrina" must find
 * an entry stored as "Alocasia zebrína", and someone typing "devils ivy" must
 * find "Devil's Ivy".
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function flatten(): IndexedEntry[] {
  const out: IndexedEntry[] = [];
  for (const family of PLANT_CATALOG) {
    for (const genus of family.genera) {
      for (const group of genus.groups) {
        for (const entry of group.entries) {
          const parts = [
            entry.name,
            entry.scientificName,
            entry.genus,
            entry.group,
            entry.family,
            ...(entry.synonyms ?? []),
          ];
          out.push({ entry, haystack: fold(parts.join(' ')) });
        }
      }
    }
  }
  return out;
}

const INDEX: IndexedEntry[] = flatten();

export const CATALOG_ENTRIES: CatalogEntry[] = INDEX.map((i) => i.entry);

function sectionTitle(e: CatalogEntry): string {
  return `${e.family} - ${e.genus} - ${e.group}`;
}

/*
 * Group a flat list back into sections, preserving the order the entries came
 * in. Order is the catalog's own order, which is curated - common before rare,
 * aroids before everything else - and re-sorting alphabetically would bury the
 * plant most people are looking for.
 */
function toSections(entries: CatalogEntry[]): CatalogSection[] {
  const sections: CatalogSection[] = [];
  const byTitle = new Map<string, CatalogSection>();

  for (const entry of entries) {
    const title = sectionTitle(entry);
    let section = byTitle.get(title);
    if (!section) {
      section = {
        title,
        family: entry.family,
        genus: entry.genus,
        group: entry.group,
        data: [],
      };
      byTitle.set(title, section);
      sections.push(section);
    }
    section.data.push(entry);
  }

  return sections;
}

/* The whole tree, sectioned. What the picker shows before anything is typed -
 * an empty search field should be a menu, not a void. */
export function browseSections(): CatalogSection[] {
  return toSections(CATALOG_ENTRIES);
}

/*
 * EVERY term must match, anywhere in the entry. "alocasia mint" finds the one
 * mint-variegated Alocasia; OR-matching would have returned every Alocasia and
 * made the second word useless, which is the opposite of what typing more
 * words means to a person.
 */
export function searchCatalog(query: string): CatalogSection[] {
  const terms = fold(query).split(' ').filter(Boolean);
  if (terms.length === 0) return browseSections();

  const hits = INDEX.filter((i) => terms.every((term) => i.haystack.includes(term))).map(
    (i) => i.entry
  );
  return toSections(hits);
}

/*
 * A plant stores `catalogId`, and an app update can remove an entry. Returning
 * undefined rather than throwing is the whole contract: the caller falls back
 * to the `species` snapshot it stored alongside the id.
 */
export function catalogEntryById(id: string | undefined): CatalogEntry | undefined {
  if (!id) return undefined;
  return CATALOG_ENTRIES.find((e) => e.id === id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/catalogSearch.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalogSearch.ts src/lib/catalogSearch.test.ts
git commit -m "feat(catalog): search and browse the species tree"
```

---

### Task 4: Store migration to v2 and manual plants

**Files:**
- Modify: `src/services/plantStore.ts`
- Test: `src/services/plantStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/services/plantStore.test.ts`. Read the top of that file first for the existing `fakeStorage` helper and reuse it verbatim - do not write a second one.

```ts
test('migration v1 to v2 stamps addedVia on existing plants', () => {
  const storage = fakeStorage();
  storage.setItem(
    LIBRARY_KEY,
    JSON.stringify({
      version: 1,
      plants: [
        {
          id: 'a',
          savedAt: '2026-01-01T00:00:00.000Z',
          photoUri: 'file://a.jpg',
          diagnosis: {
            plantName: 'Monstera',
            condition: 'healthy',
            issues: [],
            treatments: [],
          },
        },
      ],
    })
  );

  const store = createPlantStore(storage);
  const result = store.load();

  assert.equal(result.ok, true);
  assert.equal(result.plants[0].addedVia, 'scan');
  // The migrated shape is written back, so the next launch does not re-migrate.
  assert.equal(JSON.parse(storage.getItem(LIBRARY_KEY)!).version, 2);
});

test('saveManual stores a plant with a species and no diagnosis', () => {
  const store = createPlantStore(fakeStorage(), { now: () => 0, newId: () => 'id-1' });

  const result = store.saveManual({
    photoUri: 'file://plant.jpg',
    catalogId: 'alocasia-dragon-scale-mint-variegated',
    species: {
      name: 'Dragon Scale Mint Variegated',
      scientificName: 'Alocasia baginda',
      genus: 'Alocasia',
      family: 'Aroids',
    },
    soilMedium: 'leca',
    nickname: 'Spiky',
  });

  assert.equal(result.ok, true);
  assert.equal(result.plant.addedVia, 'manual');
  assert.equal(result.plant.diagnosis, undefined);
  assert.equal(result.plant.species?.genus, 'Alocasia');
  assert.equal(result.plant.soilMedium, 'leca');
  assert.equal(result.plant.nickname, 'Spiky');
  // It survives a round trip through storage.
  assert.equal(store.load().plants[0].id, 'id-1');
});

test('a record with neither diagnosis nor species is dropped', () => {
  const storage = fakeStorage();
  storage.setItem(
    LIBRARY_KEY,
    JSON.stringify({
      version: 2,
      plants: [
        { id: 'ghost', savedAt: '2026-01-01T00:00:00.000Z', photoUri: 'file://x.jpg', addedVia: 'manual' },
        {
          id: 'real',
          savedAt: '2026-01-01T00:00:00.000Z',
          photoUri: 'file://y.jpg',
          addedVia: 'manual',
          species: {
            name: 'Polly',
            scientificName: 'Alocasia x amazonica',
            genus: 'Alocasia',
            family: 'Aroids',
          },
        },
      ],
    })
  );

  const plants = createPlantStore(storage).load().plants;
  assert.deepEqual(plants.map((p) => p.id), ['real']);
});

test('update patches soil, nickname and species but never the diagnosis', () => {
  const store = createPlantStore(fakeStorage(), { now: () => 0, newId: () => 'id-1' });
  store.saveManual({
    photoUri: 'file://plant.jpg',
    species: {
      name: 'Polly',
      scientificName: 'Alocasia x amazonica',
      genus: 'Alocasia',
      family: 'Aroids',
    },
    soilMedium: 'potting_mix',
  });

  const result = store.update('id-1', { soilMedium: 'pon', nickname: 'Ziggy' });

  assert.equal(result.ok, true);
  assert.equal(result.plant.soilMedium, 'pon');
  assert.equal(result.plant.nickname, 'Ziggy');
  // @ts-expect-error diagnosis is not part of the patch type
  store.update('id-1', { diagnosis: undefined });
});

test('a v1 plant still loads with its diagnosis intact', () => {
  const store = createPlantStore(fakeStorage(), { now: () => 0, newId: () => 'id-1' });
  store.save({
    photoUri: 'file://a.jpg',
    diagnosis: {
      plantName: 'Monstera',
      scientificName: 'Monstera deliciosa',
      condition: 'healthy',
      conditionLabel: 'Healthy',
      issues: [],
      treatments: [],
      canBeSaved: true,
      confidence: 90,
      description: '',
    },
  });

  const plant = store.load().plants[0];
  assert.equal(plant.addedVia, 'scan');
  assert.equal(plant.diagnosis?.plantName, 'Monstera');
});
```

Make sure `LIBRARY_KEY` is in the file's import list from `./plantStore.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test src/services/plantStore.test.ts`
Expected: FAIL - `store.saveManual is not a function`, and `addedVia` undefined.

- [ ] **Step 3: Change the types**

In `src/services/plantStore.ts`, add the import and change `StoredPlant`:

```ts
import type { PlantDiagnosis } from '../types';
import type { SoilMediumId } from '../lib/soilMedia';
```

```ts
/*
 * The species a hand-added plant is, snapshotted from the catalog rather than
 * referenced by id alone. `catalogId` can go stale when an app update rewrites
 * the catalog; this cannot, and it is what every screen actually renders.
 */
export interface PlantSpecies {
  name: string;
  scientificName: string;
  genus: string;
  family: string;
}
```

Inside `StoredPlant`, change `diagnosis` and add the new fields:

```ts
  /*
   * Absent on a plant the user added by hand. Optional since library v2: the
   * Portfolio holds healthy plants that were never photographed for a
   * diagnosis, and requiring this field was the only thing preventing that.
   */
  diagnosis?: PlantDiagnosis;
  /*
   * How this plant got into the library. Stamped on every record - v1 plants
   * get 'scan' in the v2 migration, because before manual adding existed there
   * was no other way in.
   */
  addedVia: 'scan' | 'manual';
  /* The catalog entry the user picked. May not resolve after an app update -
   * read `species` for anything the user sees. */
  catalogId?: string;
  species?: PlantSpecies;
  /* What the plant is growing in. Drives which of the genus care plan's
   * per-medium variants is shown. Absent on every v1 plant - the user has never
   * been asked, and guessing would be inventing a fact about their pot. */
  soilMedium?: SoilMediumId;
  /* What the user calls this particular plant, as opposed to its species. */
  nickname?: string;
```

- [ ] **Step 4: Bump the version and add the migration**

Change the constant:

```ts
export const LIBRARY_VERSION = 2;
```

Replace the empty `MIGRATIONS` table (keep the comment above it, and update its last paragraph to describe v2 as done):

```ts
export const MIGRATIONS: Migrations = {
  /*
   * v1 -> v2. Manual plants arrived, so `diagnosis` became optional and
   * `addedVia` became the field that says which kind a record is. Every v1
   * plant came through the camera by definition, so the stamp is not a guess.
   */
  1: (library: any) => ({
    ...library,
    plants: Array.isArray(library?.plants)
      ? library.plants.map((p: any) => ({ ...p, addedVia: 'scan' }))
      : library?.plants,
  }),
};
```

- [ ] **Step 5: Relax the record validator**

Replace `isStoredPlant` with:

```ts
/*
 * Validate a single stored record. Still stricter than "it parsed": a plant
 * with neither a diagnosis nor a species has no identity at all and would
 * render as a nameless card, which reads as a bug rather than as damaged
 * storage. One or the other is required; both is normal for a scanned plant
 * the user later linked to a catalog entry.
 */
function isStoredPlant(v: unknown): v is StoredPlant {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== 'string' || typeof p.savedAt !== 'string' || typeof p.photoUri !== 'string') {
    return false;
  }
  if (p.diagnosis !== undefined && !isDiagnosisish(p.diagnosis)) return false;
  if (p.species !== undefined && !isSpeciesish(p.species)) return false;
  return p.diagnosis !== undefined || p.species !== undefined;
}

function isDiagnosisish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.plantName === 'string' &&
    typeof d.condition === 'string' &&
    Array.isArray(d.issues) &&
    Array.isArray(d.treatments) &&
    d.treatments.every(isTreatmentish)
  );
}

function isSpeciesish(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.name === 'string' &&
    typeof s.scientificName === 'string' &&
    typeof s.genus === 'string' &&
    typeof s.family === 'string'
  );
}
```

- [ ] **Step 6: Add `saveManual` and widen `update`**

Inside `createPlantStore`, change `save` to stamp `addedVia`, and add `saveManual` next to it:

```ts
  function save(input: { photoUri: string; diagnosis: PlantDiagnosis }): SaveResult {
    const current = load().plants;
    const plant: StoredPlant = {
      id: newId(),
      savedAt: new Date(now()).toISOString(),
      photoUri: input.photoUri,
      addedVia: 'scan',
      diagnosis: input.diagnosis,
    };

    const next = [plant, ...current];
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant, plants: next };
  }

  /*
   * A plant the user owns and never photographed for a diagnosis. Same record
   * type as a scanned plant on purpose: a manual plant can be scanned later and
   * gain a diagnosis, and a scanned plant can be linked to a catalog entry and
   * gain a species, without either one changing what it is.
   */
  function saveManual(input: {
    photoUri: string;
    species: PlantSpecies;
    catalogId?: string;
    soilMedium?: SoilMediumId;
    nickname?: string;
  }): SaveResult {
    const current = load().plants;
    const plant: StoredPlant = {
      id: newId(),
      savedAt: new Date(now()).toISOString(),
      photoUri: input.photoUri,
      addedVia: 'manual',
      species: input.species,
      ...(input.catalogId ? { catalogId: input.catalogId } : {}),
      ...(input.soilMedium ? { soilMedium: input.soilMedium } : {}),
      ...(input.nickname ? { nickname: input.nickname } : {}),
    };

    const next = [plant, ...current];
    if (!persist(next)) return { ok: false, reason: 'storage_full' };
    return { ok: true, plant, plants: next };
  }
```

Widen `update`'s patch type and its clear-on-undefined list:

```ts
  function update(
    id: string,
    patch: Partial<
      Pick<
        StoredPlant,
        | 'lastWateredAt'
        | 'lastRepottedAt'
        | 'lastFertilizedAt'
        | 'reminderId'
        | 'photoUri'
        | 'soilMedium'
        | 'nickname'
        | 'catalogId'
        | 'species'
      >
    >
  ): UpdateResult {
```

and inside it:

```ts
    for (const key of [
      'lastWateredAt',
      'lastRepottedAt',
      'lastFertilizedAt',
      'reminderId',
      'soilMedium',
      'nickname',
      'catalogId',
      'species',
    ] as const) {
      if (key in patch && patch[key] === undefined) delete updated[key];
    }
```

Add `saveManual` to the returned object:

```ts
  return { load, save, saveManual, update, markWatered, markCare, remove };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test src/services/plantStore.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 8: Fix the fallout and typecheck**

`PlantCard.tsx`, `triage.ts`, `PlantDetailScreen.tsx`, `HomeScreen.tsx` and `PlantSearchScreen.tsx` read `plant.diagnosis.X` and will now fail to compile. For this task, make each read optional (`plant.diagnosis?.X`) with a sensible fallback; Tasks 8 and 11 give them proper treatment.

- `src/lib/triage.ts`: a plant with no diagnosis has no condition. Treat it as `'healthy'` for grouping - a hand-added plant is one the user believes is fine, and putting it in a "needs attention" group would be a lie.
- `src/components/PlantCard.tsx`: `const condition = plant.diagnosis?.condition ?? 'healthy';` and `wateringState(plant.diagnosis?.carePlan, ...)`.
- Anywhere reading `plant.diagnosis.plantName` for display: `plant.nickname ?? plant.species?.name ?? plant.diagnosis?.plantName ?? 'Unnamed plant'`.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: every test passes.

- [ ] **Step 9: Commit**

```bash
git add src/services/plantStore.ts src/services/plantStore.test.ts src/lib/triage.ts src/components/PlantCard.tsx src/screens
git commit -m "feat(library): let a plant exist without a diagnosis

Library v2. Adds addedVia, species, catalogId, soilMedium and nickname,
makes diagnosis optional, and migrates every existing record to
addedVia: 'scan' - before manual adding there was no other way in."
```

---

### Task 5: Genus care plan types and validation

**Files:**
- Create: `src/lib/genusCarePlan.ts`
- Test: `src/lib/genusCarePlan.test.ts`

This module is pure. It owns the shape, the validator and the cache policy. Storage and network are injected in Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/lib/genusCarePlan.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIUM_IDS } from './soilMedia.ts';
import {
  CACHE_KEY_PREFIX,
  cacheKeyFor,
  createGenusCarePlanCache,
  isGenusCarePlan,
  parseGenusCarePlan,
  type GenusCarePlan,
} from './genusCarePlan.ts';

function soilPlan(days: number) {
  return {
    water: 'Water when the top third dries out.',
    waterEveryDays: days,
    waterEveryDaysMax: days + 3,
    fertilizer: 'Balanced feed at half strength.',
    fertilizeEveryDays: 21,
    light: 'Bright indirect.',
    humidity: '60% and up.',
    warnings: [],
  };
}

function fullPlan(genus = 'Alocasia'): GenusCarePlan {
  const bySoil: Record<string, unknown> = {};
  SOIL_MEDIUM_IDS.forEach((id, i) => (bySoil[id] = soilPlan(5 + i)));
  return {
    genus,
    family: 'Aroids',
    fetchedAt: '2026-08-29T00:00:00.000Z',
    bySoil: bySoil as GenusCarePlan['bySoil'],
  };
}

test('a plan covering every medium is valid', () => {
  assert.equal(isGenusCarePlan(fullPlan()), true);
});

test('a plan missing one medium is rejected', () => {
  const plan = fullPlan();
  delete (plan.bySoil as Record<string, unknown>).pon;
  assert.equal(isGenusCarePlan(plan), false);
});

test('a soil plan without a numeric interval is rejected', () => {
  const plan = fullPlan();
  (plan.bySoil.leca as Record<string, unknown>).waterEveryDays = 'about a week';
  assert.equal(isGenusCarePlan(plan), false);
});

test('parseGenusCarePlan stamps genus, family and fetchedAt from the request', () => {
  const raw = { bySoil: fullPlan().bySoil };
  const parsed = parseGenusCarePlan(raw, {
    genus: 'Monstera',
    family: 'Aroids',
    now: () => Date.parse('2026-08-29T10:00:00.000Z'),
  });
  assert.equal(parsed.genus, 'Monstera');
  assert.equal(parsed.family, 'Aroids');
  assert.equal(parsed.fetchedAt, '2026-08-29T10:00:00.000Z');
});

test('parseGenusCarePlan throws on a partial response rather than caching it', () => {
  assert.throws(
    () => parseGenusCarePlan({ bySoil: { leca: soilPlan(5) } }, { genus: 'Alocasia', family: 'Aroids' }),
    /care plan/i
  );
});

test('cacheKeyFor is case-insensitive on the genus', () => {
  assert.equal(cacheKeyFor('Alocasia'), cacheKeyFor('alocasia'));
  assert.ok(cacheKeyFor('Alocasia').startsWith(CACHE_KEY_PREFIX));
});

test('a cached genus costs no fetch, even for a different species in it', async () => {
  const store = new Map<string, string>();
  let calls = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async (genus, family) => {
      calls++;
      return { bySoil: fullPlan(genus).bySoil };
    },
    now: () => 0,
  });

  const first = await cache.get('Alocasia', 'Aroids');
  const second = await cache.get('Alocasia', 'Aroids');

  assert.equal(calls, 1);
  assert.equal(first?.genus, 'Alocasia');
  assert.equal(second?.genus, 'Alocasia');
});

test('a failed fetch returns null and caches nothing, so a retry can succeed', async () => {
  const store = new Map<string, string>();
  let calls = 0;
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async (genus) => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return { bySoil: fullPlan(genus).bySoil };
    },
    now: () => 0,
  });

  assert.equal(await cache.get('Hoya', 'Hoyas'), null);
  assert.equal(store.size, 0);
  assert.notEqual(await cache.get('Hoya', 'Hoyas'), null);
  assert.equal(calls, 2);
});

test('peek reads the cache synchronously and never fetches', () => {
  const store = new Map<string, string>();
  store.set(cacheKeyFor('Alocasia'), JSON.stringify(fullPlan()));
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async () => {
      throw new Error('peek must not fetch');
    },
    now: () => 0,
  });

  assert.equal(cache.peek('Alocasia')?.genus, 'Alocasia');
  assert.equal(cache.peek('Ficus'), null);
});

test('a corrupt cache entry is dropped rather than crashing the screen', () => {
  const store = new Map<string, string>([[cacheKeyFor('Alocasia'), '{not json']]);
  const cache = createGenusCarePlanCache({
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    fetchPlan: async () => ({ bySoil: fullPlan().bySoil }),
    now: () => 0,
  });

  assert.equal(cache.peek('Alocasia'), null);
  assert.equal(store.has(cacheKeyFor('Alocasia')), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/genusCarePlan.test.ts`
Expected: FAIL, `Cannot find module './genusCarePlan.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/genusCarePlan.ts`:

```ts
import { SOIL_MEDIUM_IDS, type SoilMediumId } from './soilMedia.ts';

/*
 * The care plan for a whole genus, one variant per growing medium.
 *
 * WHY PER GENUS AND NOT PER SPECIES. Care advice at the species level is mostly
 * the genus advice repeated: every Alocasia wants the same light, the same
 * humidity and the same feed, and the differences that do exist are smaller
 * than the difference between the same plant in peat and in LECA. Caching by
 * genus means a user with nine Alocasias pays for one call, not nine.
 *
 * WHY EVERY MEDIUM IN ONE RESPONSE. The user can change a plant's medium at any
 * time, and that must reschedule watering immediately - on a plane, in a
 * greenhouse with no signal. Fetching the medium they picked today would put a
 * network call on a switch that has to be instant.
 *
 * Pure and injected. Storage and the network arrive as deps so every branch
 * here is testable with `node --test`, exactly as plantStore does it.
 */

export interface SoilCarePlan {
  /* Prose the user reads. */
  water: string;
  /* What the schedule is built on. Whole days. */
  waterEveryDays: number;
  /* Upper end of a range; absent for a single figure. Same meaning as
   * CarePlan.waterEveryDaysMax in src/types - "due" at min, "overdue" past max. */
  waterEveryDaysMax?: number;
  fertilizer: string;
  fertilizeEveryDays: number;
  light: string;
  humidity: string;
  /* Medium-specific traps: 'Pon wants a reservoir, not top-watering'. */
  warnings?: string[];
}

export interface GenusCarePlan {
  genus: string;
  family: string;
  /* ISO-8601. Not used to expire anything today - a genus's care does not
   * change - but stored so a future refresh has an anchor. */
  fetchedAt: string;
  bySoil: Record<SoilMediumId, SoilCarePlan>;
}

export const CACHE_KEY_PREFIX = 'plantai.careplan.';

/* Genus names arrive from the catalog, from PlantNet and from a vision model,
 * and the three do not agree on capitalization. The cache must not hold
 * 'Alocasia' and 'alocasia' as two genera. */
export function cacheKeyFor(genus: string): string {
  return `${CACHE_KEY_PREFIX}${genus.trim().toLowerCase()}`;
}

function isSoilCarePlan(v: unknown): v is SoilCarePlan {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.water === 'string' &&
    typeof p.waterEveryDays === 'number' &&
    Number.isFinite(p.waterEveryDays) &&
    p.waterEveryDays > 0 &&
    (p.waterEveryDaysMax === undefined || typeof p.waterEveryDaysMax === 'number') &&
    typeof p.fertilizer === 'string' &&
    typeof p.fertilizeEveryDays === 'number' &&
    Number.isFinite(p.fertilizeEveryDays) &&
    p.fertilizeEveryDays > 0 &&
    typeof p.light === 'string' &&
    typeof p.humidity === 'string' &&
    (p.warnings === undefined || Array.isArray(p.warnings))
  );
}

/*
 * ALL OR NOTHING. A response covering seven of the eight media would leave one
 * medium permanently planless for that genus, and the cache would make it
 * permanent - the miss that would have refetched never happens again.
 */
export function isGenusCarePlan(v: unknown): v is GenusCarePlan {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p.genus !== 'string' || typeof p.family !== 'string') return false;
  if (typeof p.fetchedAt !== 'string') return false;
  const bySoil = p.bySoil as Record<string, unknown> | undefined;
  if (typeof bySoil !== 'object' || bySoil === null) return false;
  return SOIL_MEDIUM_IDS.every((id) => isSoilCarePlan(bySoil[id]));
}

/*
 * Turn a server response into a plan. `genus` and `family` come from the
 * REQUEST, not the response: they are what the cache is keyed on, and a model
 * that renamed the genus in its answer would write a plan nothing can find.
 */
export function parseGenusCarePlan(
  value: unknown,
  ctx: { genus: string; family: string; now?: () => number }
): GenusCarePlan {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const candidate = {
    genus: ctx.genus,
    family: ctx.family,
    fetchedAt: new Date((ctx.now ?? Date.now)()).toISOString(),
    bySoil: raw.bySoil,
  };
  if (!isGenusCarePlan(candidate)) {
    throw new Error(`care plan for ${ctx.genus} did not cover every growing medium`);
  }
  return candidate;
}

export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GenusCarePlanDeps {
  storage: CacheStorage;
  /* Returns the raw server body. Throwing is the normal failure path. */
  fetchPlan(genus: string, family: string): Promise<unknown>;
  now?: () => number;
}

export function createGenusCarePlanCache(deps: GenusCarePlanDeps) {
  const now = deps.now ?? (() => Date.now());

  /*
   * Read the cache and nothing else. Synchronous so a screen can render the
   * right plan on its first frame rather than showing generic advice and
   * swapping it - the same reason plantStore is synchronous.
   */
  function peek(genus: string): GenusCarePlan | null {
    const key = cacheKeyFor(genus);
    const raw = deps.storage.getItem(key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Damaged entry. Drop it so the next `get` refetches instead of the
      // screen falling back forever on a plan that will never parse.
      deps.storage.removeItem(key);
      return null;
    }

    if (!isGenusCarePlan(parsed)) {
      // Written by an older app version whose medium list was shorter. Same
      // treatment: unusable, so make it a miss.
      deps.storage.removeItem(key);
      return null;
    }
    return parsed;
  }

  /*
   * The cached plan, fetching it once if it is not there.
   *
   * Returns null rather than throwing when the fetch fails. A care plan is
   * enrichment: the caller has a fallback (see soilAdjustedPlan in
   * src/lib/care.ts) and a plant must still save with no network.
   */
  async function get(genus: string, family: string): Promise<GenusCarePlan | null> {
    const cached = peek(genus);
    if (cached) return cached;

    let plan: GenusCarePlan;
    try {
      const body = await deps.fetchPlan(genus, family);
      plan = parseGenusCarePlan(body, { genus, family, now });
    } catch {
      return null;
    }

    try {
      deps.storage.setItem(cacheKeyFor(genus), JSON.stringify(plan));
    } catch {
      // Out of space. The plan is still good for this session; the next launch
      // simply refetches.
    }
    return plan;
  }

  return { peek, get };
}

export type GenusCarePlanCache = ReturnType<typeof createGenusCarePlanCache>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/genusCarePlan.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/genusCarePlan.ts src/lib/genusCarePlan.test.ts
git commit -m "feat(care): a per-genus care plan with one variant per medium"
```

---

### Task 6: Server route for care plans

**Files:**
- Create: `server/carePlan.ts`
- Create: `server/carePlan.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write the failing test**

Create `server/carePlan.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOIL_MEDIUM_IDS, buildCarePlan, carePlanPrompt, parseCarePlanBody } from './carePlan.ts';

function soil(days: number) {
  return {
    water: 'Water when the top third dries.',
    waterEveryDays: days,
    waterEveryDaysMax: days + 3,
    fertilizer: 'Balanced feed at half strength.',
    fertilizeEveryDays: 21,
    light: 'Bright indirect.',
    humidity: '60% and up.',
    warnings: [],
  };
}

function everyMedium() {
  const out: Record<string, unknown> = {};
  SOIL_MEDIUM_IDS.forEach((id, i) => (out[id] = soil(5 + i)));
  return out;
}

test('the prompt names every medium the client knows about', () => {
  const prompt = carePlanPrompt('Alocasia', 'Aroids');
  for (const id of SOIL_MEDIUM_IDS) assert.ok(prompt.includes(id), `prompt omits ${id}`);
  assert.ok(prompt.includes('Alocasia'));
});

test('parseCarePlanBody accepts a complete response', () => {
  const parsed = parseCarePlanBody({ bySoil: everyMedium() });
  assert.equal(Object.keys(parsed.bySoil).length, SOIL_MEDIUM_IDS.length);
});

test('parseCarePlanBody rejects a response missing a medium', () => {
  const bySoil = everyMedium();
  delete bySoil.pon;
  assert.throws(() => parseCarePlanBody({ bySoil }), /pon/);
});

test('parseCarePlanBody rejects a non-numeric interval', () => {
  const bySoil = everyMedium();
  (bySoil.leca as Record<string, unknown>).waterEveryDays = 'weekly';
  assert.throws(() => parseCarePlanBody({ bySoil }), /leca/);
});

test('parseCarePlanBody drops keys it does not know, rather than passing them through', () => {
  const bySoil = everyMedium();
  bySoil.martian_regolith = soil(9);
  const parsed = parseCarePlanBody({ bySoil });
  assert.equal('martian_regolith' in parsed.bySoil, false);
});

test('buildCarePlan calls the model once and returns the parsed body', async () => {
  let calls = 0;
  const plan = await buildCarePlan('Alocasia', 'Aroids', {
    askModel: async () => {
      calls++;
      return JSON.stringify({ bySoil: everyMedium() });
    },
  });
  assert.equal(calls, 1);
  assert.equal(plan.bySoil.leca.waterEveryDays > 0, true);
});

test('buildCarePlan surfaces a model answer that is not JSON', async () => {
  await assert.rejects(
    buildCarePlan('Alocasia', 'Aroids', { askModel: async () => 'here you go!' }),
    /not JSON/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/carePlan.test.ts`
Expected: FAIL, `Cannot find module './carePlan.ts'`.

- [ ] **Step 3: Write the implementation**

Create `server/carePlan.ts`:

```ts
/*
 * Care plans for a whole genus, one per growing medium.
 *
 * One call covers a genus forever, on every device that asks. The client caches
 * by genus (src/lib/genusCarePlan.ts), so this route is hit once per genus per
 * user and never again - which is what makes it affordable to ask for eight
 * variants in a single response instead of one.
 *
 * The medium list is duplicated here rather than imported from src/lib: the
 * server program (tsconfig.node.json) deliberately does not pull in the app's
 * modules, and this list changes about as often as the alphabet. The test
 * asserts the prompt covers every id, so a drift shows up as a failure rather
 * than as a silently missing variant.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export const SOIL_MEDIUM_IDS = [
  'potting_mix',
  'aroid_mix',
  'leca',
  'pon',
  'sphagnum',
  'bark',
  'perlite_mix',
  'water',
] as const;

export type SoilMediumId = (typeof SOIL_MEDIUM_IDS)[number];

const MEDIUM_DESCRIPTIONS: Record<SoilMediumId, string> = {
  potting_mix: 'standard peat-based houseplant soil',
  aroid_mix: 'chunky bark, perlite and coco, free-draining',
  leca: 'expanded clay balls, semi-hydroponic with a reservoir',
  pon: 'pumice, zeolite and lava rock with slow-release fertilizer',
  sphagnum: 'long-fibre sphagnum moss, highly water-retentive',
  bark: 'coarse orchid bark, very airy',
  perlite_mix: 'mostly perlite, near-hydroponic',
  water: 'plain water, no substrate',
};

export interface SoilCarePlan {
  water: string;
  waterEveryDays: number;
  waterEveryDaysMax?: number;
  fertilizer: string;
  fertilizeEveryDays: number;
  light: string;
  humidity: string;
  warnings?: string[];
}

export interface GenusCarePlanBody {
  bySoil: Record<SoilMediumId, SoilCarePlan>;
}

export class CarePlanError extends Error {}

export function carePlanPrompt(genus: string, family: string): string {
  const media = SOIL_MEDIUM_IDS.map((id) => `- "${id}": ${MEDIUM_DESCRIPTIONS[id]}`).join('\n');
  return [
    `You are a horticulturist writing care guidance for the plant genus ${genus} (family: ${family}).`,
    '',
    'Return JSON only, shaped exactly like this:',
    '{"bySoil":{"<medium_id>":{"water":string,"waterEveryDays":number,"waterEveryDaysMax":number,',
    '"fertilizer":string,"fertilizeEveryDays":number,"light":string,"humidity":string,',
    '"warnings":string[]}}}',
    '',
    'You MUST include an entry for every one of these growing media:',
    media,
    '',
    'Rules:',
    `- The advice must be specific to ${genus} AND to that medium. An inert medium like LECA or Pon`,
    '  is watered far more often than peat; sphagnum and water far less. If your intervals are the',
    '  same for every medium you have not done the task.',
    '- waterEveryDays is the day the plant becomes DUE. waterEveryDaysMax is the day it is late.',
    '  Both are whole days, both greater than zero, and max is greater than or equal to min.',
    '- fertilizeEveryDays is whole days during the growing season. Media with built-in slow-release',
    '  feed (Pon) and inert media that hold no nutrients (LECA, water) differ sharply here.',
    '- warnings holds traps specific to that medium, for example flushing salts out of LECA, or',
    '  filling a Pon reservoir rather than top-watering. Empty array if there are none.',
    '- Every prose field is one or two plain sentences. No markdown, no lists inside strings.',
  ].join('\n');
}

function requireSoilPlan(value: unknown, id: SoilMediumId): SoilCarePlan {
  if (typeof value !== 'object' || value === null) {
    throw new CarePlanError(`care plan is missing "${id}"`);
  }
  const p = value as Record<string, unknown>;
  const num = (key: 'waterEveryDays' | 'fertilizeEveryDays'): number => {
    const n = p[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      throw new CarePlanError(`care plan "${id}" has an unusable ${key}`);
    }
    return Math.round(n);
  };
  const str = (key: 'water' | 'fertilizer' | 'light' | 'humidity'): string => {
    const v = p[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new CarePlanError(`care plan "${id}" has no ${key}`);
    }
    return v.trim();
  };

  const waterEveryDays = num('waterEveryDays');
  const rawMax = p.waterEveryDaysMax;
  const max =
    typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= waterEveryDays
      ? Math.round(rawMax)
      : undefined;

  return {
    water: str('water'),
    waterEveryDays,
    ...(max === undefined ? {} : { waterEveryDaysMax: max }),
    fertilizer: str('fertilizer'),
    fertilizeEveryDays: num('fertilizeEveryDays'),
    light: str('light'),
    humidity: str('humidity'),
    warnings: Array.isArray(p.warnings)
      ? p.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  };
}

/*
 * Rebuild the response from the keys WE know rather than trusting the model's
 * object. A missing medium throws - the client caches this forever, so a
 * partial plan would be a permanent hole - and an invented medium is dropped.
 */
export function parseCarePlanBody(value: unknown): GenusCarePlanBody {
  if (typeof value !== 'object' || value === null) {
    throw new CarePlanError('care plan response was not an object');
  }
  const bySoilRaw = (value as Record<string, unknown>).bySoil;
  if (typeof bySoilRaw !== 'object' || bySoilRaw === null) {
    throw new CarePlanError('care plan response had no bySoil');
  }
  const source = bySoilRaw as Record<string, unknown>;

  const bySoil = {} as Record<SoilMediumId, SoilCarePlan>;
  for (const id of SOIL_MEDIUM_IDS) bySoil[id] = requireSoilPlan(source[id], id);
  return { bySoil };
}

export interface CarePlanDeps {
  /* Takes the prompt, returns the model's raw text. Injected so the parser and
   * the prompt can be tested without a key or a network. */
  askModel(prompt: string): Promise<string>;
}

export async function buildCarePlan(
  genus: string,
  family: string,
  deps: CarePlanDeps
): Promise<GenusCarePlanBody> {
  const text = await deps.askModel(carePlanPrompt(genus, family));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CarePlanError(`care plan response was not JSON: ${text.slice(0, 300)}`);
  }
  return parseCarePlanBody(parsed);
}

/*
 * The real model call. Eight plans of prose is a much bigger answer than the
 * identification call's name-and-two-numbers, hence the large budget - and
 * server/diagnose.ts learned the hard way that a reasoning model can spend its
 * whole allowance before emitting a token.
 */
export function openAiCarePlan(apiKey: string): CarePlanDeps {
  return {
    async askModel(prompt: string): Promise<string> {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-5.6-luna',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          max_completion_tokens: 8000,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new CarePlanError(`care plan ${res.status} ${body.slice(0, 300)}`);
      }

      const data: any = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new CarePlanError('care plan: the model returned no content');
      }
      return content;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test server/carePlan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire the route**

In `server/index.ts`, add the import next to the existing `diagnose` import:

```ts
import { CarePlanError, buildCarePlan, openAiCarePlan } from './carePlan.ts';
```

Add the route immediately after the `POST /api/diagnose` block closes (after its `return;`), following that block's structure exactly - gate first, then body validation, then the call:

```ts
  // ── POST /api/care-plan ─ per-medium care for a whole genus ─────────────────
  // Hit once per genus per device, then cached client-side forever. That is
  // what makes it affordable to ask for all eight media in one answer.
  if (u.pathname === '/api/care-plan' && req.method === 'POST') {
    const decision = gate.check(ip, secret);
    if (!decision.allow) {
      json(res, decision.status, { error: decision.code, message: decision.message });
      return;
    }

    let genus: string;
    let family: string;
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString('utf8'));
      genus = typeof body?.genus === 'string' ? body.genus.trim() : '';
      family = typeof body?.family === 'string' ? body.family.trim() : '';
      if (genus.length === 0) {
        json(res, 400, { error: 'bad_request', message: 'genus is required.' });
        return;
      }
      // A genus name is one or two words. Anything longer is someone using this
      // route as a free prompt.
      if (genus.length > 60 || family.length > 60) {
        json(res, 400, { error: 'bad_request', message: 'That plant name is too long.' });
        return;
      }
    } catch (err: unknown) {
      fail(res, rid, 400, 'bad_request', 'That request could not be read.', errText(err));
      return;
    }

    const t0 = Date.now();
    logEvent(rid, 'care_plan_start', { genus, family });
    try {
      const plan = await buildCarePlan(genus, family, openAiCarePlan(OPENAI_API_KEY));
      logEvent(rid, 'care_plan_done', { genus, ms: Date.now() - t0 });
      json(res, 200, plan);
    } catch (err: unknown) {
      const detail = err instanceof CarePlanError ? err.message : errText(err);
      fail(res, rid, 502, 'care_plan_failed', 'Care advice is not available right now.', detail);
    }
    return;
  }
```

Read the `/api/diagnose` block above it for the exact names of `OPENAI_API_KEY`, `logEvent`, `fail`, `json`, `readBody` and `errText` as they exist in the file, and match them. If the key is read through a helper such as `makeDiagnosisDeps`, follow that pattern instead of referencing the constant directly.

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: every test passes.

Start the server and hit the route by hand:

```bash
npm run server &
curl -s -X POST http://localhost:4000/api/care-plan \
  -H 'content-type: application/json' \
  -H "x-plantai-key: $EXPO_PUBLIC_API_SECRET" \
  -d '{"genus":"Alocasia","family":"Aroids"}' | head -c 400
```

Expected: a JSON body starting `{"bySoil":{"potting_mix":{...`. Kill the server afterwards.

- [ ] **Step 7: Commit**

```bash
git add server/carePlan.ts server/carePlan.test.ts server/index.ts
git commit -m "feat(server): POST /api/care-plan returns a genus plan per medium"
```

---

### Task 7: Bind the care plan cache to the device

**Files:**
- Create: `src/services/genusCarePlans.ts`

No test: this file is the native/network binding, the same role `plantLibrary.ts` plays for `plantStore.ts`, and both of those are untested for the same reason. All logic is in `src/lib/genusCarePlan.ts`, tested in Task 5.

- [ ] **Step 1: Write the binding**

Create `src/services/genusCarePlans.ts`:

```ts
import Storage from 'expo-sqlite/kv-store';
import { apiFetch, apiHeaders, readApiError } from '../lib/api';
import { createGenusCarePlanCache, type CacheStorage } from '../lib/genusCarePlan';

/*
 * The one place the genus care plan cache is bound to the device and the API.
 *
 * Separate from src/lib/genusCarePlan.ts for the same reason plantLibrary.ts is
 * separate from plantStore.ts: that module stays free of native imports and can
 * be exercised by `node --test` without an Expo runtime.
 *
 * Synchronous accessors again, because `peek` has to answer during render - a
 * plant screen that showed generic advice and then swapped in the real plan a
 * frame later would read as a glitch on every open.
 */
const deviceStorage: CacheStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => Storage.removeItemSync(key),
};

/* Eight plans of prose is a slow answer. Long enough not to abandon a call that
 * is working, short enough that adding a plant never feels stuck - the caller
 * falls back to local advice on timeout and the plant is already saved. */
const CARE_PLAN_TIMEOUT_MS = 45_000;

export const genusCarePlans = createGenusCarePlanCache({
  storage: deviceStorage,
  fetchPlan: async (genus, family) => {
    const res = await apiFetch('/api/care-plan', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ genus, family }),
      timeoutMs: CARE_PLAN_TIMEOUT_MS,
    });
    if (!res.ok) {
      const err = await readApiError(res);
      throw new Error(err.error);
    }
    return res.json();
  },
});
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/genusCarePlans.ts
git commit -m "feat(care): bind the genus care plan cache to storage and the API"
```

---

### Task 8: Resolve a plant's schedule from its medium

**Files:**
- Modify: `src/lib/care.ts`
- Test: `src/lib/care.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/care.test.ts`:

```ts
import { DEFAULT_SOIL_MEDIUM } from './soilMedia.ts';
import { plantCarePlan, soilAdjustedPlan } from './care.ts';
import type { GenusCarePlan } from './genusCarePlan.ts';

function genusPlan(): GenusCarePlan {
  const bySoil: Record<string, unknown> = {};
  const days: Record<string, number> = {
    potting_mix: 9,
    aroid_mix: 7,
    leca: 4,
    pon: 5,
    sphagnum: 12,
    bark: 6,
    perlite_mix: 4,
    water: 21,
  };
  for (const [id, d] of Object.entries(days)) {
    bySoil[id] = {
      water: `Water every ${d} days.`,
      waterEveryDays: d,
      waterEveryDaysMax: d + 3,
      fertilizer: 'Half-strength balanced feed.',
      fertilizeEveryDays: id === 'pon' ? 90 : 21,
      light: 'Bright indirect.',
      humidity: '60%.',
      warnings: [],
    };
  }
  return {
    genus: 'Alocasia',
    family: 'Aroids',
    fetchedAt: '2026-08-29T00:00:00.000Z',
    bySoil: bySoil as GenusCarePlan['bySoil'],
  };
}

test('the genus plan for the plant medium wins over the diagnosis care plan', () => {
  const plan = plantCarePlan(
    { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 7 },
    genusPlan(),
    'leca'
  );
  assert.equal(plan?.waterEveryDays, 4);
  assert.equal(plan?.waterEveryDaysMax, 7);
});

test('with no genus plan, the medium scales the diagnosis interval', () => {
  const plan = plantCarePlan(
    { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 10 },
    null,
    'leca'
  );
  // 10 * 0.6, rounded.
  assert.equal(plan?.waterEveryDays, 6);
});

test('with no genus plan and no medium the diagnosis plan is untouched', () => {
  const base = { soil: 'Airy mix', light: 'Bright', water: 'Weekly', waterEveryDays: 10 };
  assert.deepEqual(plantCarePlan(base, null, undefined), base);
});

test('a manual plant with no plan at all has no schedule rather than a made-up one', () => {
  assert.equal(plantCarePlan(undefined, null, DEFAULT_SOIL_MEDIUM), undefined);
});

test('soilAdjustedPlan never produces a zero-day interval', () => {
  const plan = soilAdjustedPlan(
    { soil: '', light: '', water: '', waterEveryDays: 1 },
    'leca'
  );
  assert.ok(plan!.waterEveryDays >= 1);
});

test('fertilizer interval comes from the genus plan when there is one', () => {
  const plan = intervalPlanFor('fertilizer', undefined, genusPlan().bySoil.pon);
  assert.equal(plan?.waterEveryDays, 90);
});

test('fertilizer falls back to the constant with no genus plan', () => {
  const plan = intervalPlanFor('fertilizer', undefined, undefined);
  assert.equal(plan?.waterEveryDays, FERTILIZE_EVERY_DAYS);
});

test('repot ignores the genus plan, which carries no repot interval', () => {
  const plan = intervalPlanFor('repot', undefined, genusPlan().bySoil.pon);
  assert.equal(plan?.waterEveryDays, REPOT_EVERY_DAYS);
});
```

Add `FERTILIZE_EVERY_DAYS`, `REPOT_EVERY_DAYS` and `intervalPlanFor` to the file's existing import from `./care.ts` if they are not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/care.test.ts`
Expected: FAIL, `plantCarePlan is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/lib/care.ts`, add the imports:

```ts
import type { GenusCarePlan, SoilCarePlan } from './genusCarePlan.ts';
import { soilMediumById, type SoilMediumId } from './soilMedia.ts';
```

Change `intervalPlanFor` to take the soil plan, and add the two new functions below it:

```ts
/*
 * The interval a kind is scheduled on, expressed as a care plan so the whole
 * calculation can go through `wateringState` unchanged. For water this is the
 * plant's own plan; for the others it is the genus plan's figure when there is
 * one, and the constant above when there is not.
 */
export function intervalPlanFor(
  kind: CareKind,
  carePlan: CarePlan | undefined,
  soilPlan?: SoilCarePlan
): CarePlan | undefined {
  if (kind === 'water') return carePlan;

  /*
   * Feeding is the one non-water kind a care plan can actually speak to, and
   * the medium changes it enormously: Pon carries months of slow-release feed,
   * LECA carries none at all. Repotting is driven by roots, not by substrate,
   * so it keeps the constant even when a genus plan exists.
   */
  const [min, max] =
    kind === 'fertilizer'
      ? soilPlan
        ? [soilPlan.fertilizeEveryDays, undefined]
        : [FERTILIZE_EVERY_DAYS, FERTILIZE_EVERY_DAYS_MAX]
      : [REPOT_EVERY_DAYS, REPOT_EVERY_DAYS_MAX];

  const prose = carePlan ?? { soil: '', light: '', water: '' };
  return { ...prose, waterEveryDays: min, waterEveryDaysMax: max };
}

/*
 * FALLBACK. Scale a care plan's watering interval by what the plant is growing
 * in, for the window before a genus plan has been cached - first launch
 * offline, or a call that failed. Crude by design: it is one number per medium
 * standing in for advice the model writes properly, and it is discarded the
 * moment the real plan arrives.
 */
export function soilAdjustedPlan(
  carePlan: CarePlan | undefined,
  medium: SoilMediumId | undefined
): CarePlan | undefined {
  if (!carePlan) return undefined;
  const multiplier = soilMediumById(medium)?.waterMultiplier;
  if (multiplier === undefined || multiplier === 1) return carePlan;
  if (typeof carePlan.waterEveryDays !== 'number') return carePlan;

  // Never below a day: a schedule that says "water every 0 days" is due
  // forever, which is worse than no schedule at all.
  const scale = (days: number) => Math.max(1, Math.round(days * multiplier));
  return {
    ...carePlan,
    waterEveryDays: scale(carePlan.waterEveryDays),
    ...(typeof carePlan.waterEveryDaysMax === 'number'
      ? { waterEveryDaysMax: scale(carePlan.waterEveryDaysMax) }
      : {}),
  };
}

/*
 * The watering plan a plant should actually be scheduled on.
 *
 * Precedence, best first: the genus plan for the medium it is in, then the
 * diagnosis's own plan scaled by that medium, then the diagnosis plan as it
 * came. A plant with none of the three has no schedule, and that is reported as
 * `undefined` rather than filled in - a made-up interval is a reminder the app
 * invented, and the whole watering feature would be built on it.
 */
export function plantCarePlan(
  diagnosisPlan: CarePlan | undefined,
  genusPlan: GenusCarePlan | null,
  medium: SoilMediumId | undefined
): CarePlan | undefined {
  const soilPlan = medium && genusPlan ? genusPlan.bySoil[medium] : undefined;
  if (soilPlan) {
    return {
      soil: soilMediumById(medium)?.label ?? diagnosisPlan?.soil ?? '',
      light: soilPlan.light,
      water: soilPlan.water,
      waterEveryDays: soilPlan.waterEveryDays,
      ...(soilPlan.waterEveryDaysMax === undefined
        ? {}
        : { waterEveryDaysMax: soilPlan.waterEveryDaysMax }),
    };
  }
  return soilAdjustedPlan(diagnosisPlan, medium);
}

/* The genus plan entry for a plant's medium, or undefined. The one place the
 * lookup is written, so callers never index `bySoil` themselves. */
export function soilPlanFor(
  genusPlan: GenusCarePlan | null,
  medium: SoilMediumId | undefined
): SoilCarePlan | undefined {
  if (!genusPlan || !medium) return undefined;
  return genusPlan.bySoil[medium];
}
```

- [ ] **Step 4: Update the existing `careState` signature**

```ts
export function careState(
  kind: CareKind,
  carePlan: CarePlan | undefined,
  lastAt: string | undefined,
  now: number,
  soilPlan?: SoilCarePlan
): WateringState {
  const state = wateringState(intervalPlanFor(kind, carePlan, soilPlan), lastAt, now);
  if (kind === 'water') return state;
  return { ...state, label: relabel(kind, state) };
}
```

The parameter is optional and last, so every existing call site keeps working unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/lib/care.test.ts`
Expected: PASS, including every pre-existing test in the file.

Run: `npm test`
Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/care.ts src/lib/care.test.ts
git commit -m "feat(care): schedule a plant from the medium it grows in"
```

---

### Task 9: Portfolio filtering and the due rollup

**Files:**
- Create: `src/lib/portfolio.ts`
- Test: `src/lib/portfolio.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/portfolio.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from './watering.ts';
import { dueSoon, filterPortfolio, plantDisplayName } from './portfolio.ts';
import type { StoredPlant } from '../services/plantStore.ts';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

function scanned(id: string, lastWateredDaysAgo: number, everyDays = 7): StoredPlant {
  return {
    id,
    savedAt: new Date(NOW - 30 * DAY_MS).toISOString(),
    photoUri: `file://${id}.jpg`,
    addedVia: 'scan',
    lastWateredAt: new Date(NOW - lastWateredDaysAgo * DAY_MS).toISOString(),
    diagnosis: {
      plantName: 'Monstera',
      scientificName: 'Monstera deliciosa',
      condition: 'healthy',
      conditionLabel: 'Healthy',
      issues: [],
      treatments: [],
      canBeSaved: true,
      confidence: 90,
      description: '',
      carePlan: { soil: '', light: '', water: '', waterEveryDays: everyDays },
    },
  };
}

function manual(id: string, nickname?: string): StoredPlant {
  return {
    id,
    savedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
    photoUri: `file://${id}.jpg`,
    addedVia: 'manual',
    soilMedium: 'leca',
    ...(nickname ? { nickname } : {}),
    species: {
      name: 'Dragon Scale Mint Variegated',
      scientificName: 'Alocasia baginda',
      genus: 'Alocasia',
      family: 'Aroids',
    },
  };
}

test('the All filter keeps every plant, in order', () => {
  const plants = [manual('m1'), scanned('s1', 1)];
  assert.deepEqual(filterPortfolio(plants, 'all').map((p) => p.id), ['m1', 's1']);
});

test('the Diagnosed filter keeps only plants that carry a diagnosis', () => {
  const plants = [manual('m1'), scanned('s1', 1)];
  assert.deepEqual(filterPortfolio(plants, 'diagnosed').map((p) => p.id), ['s1']);
});

test('a manual plant that was later scanned counts as diagnosed', () => {
  const both = { ...manual('m1'), diagnosis: scanned('s1', 1).diagnosis };
  assert.deepEqual(filterPortfolio([both], 'diagnosed').map((p) => p.id), ['m1']);
});

test('dueSoon lists plants due or overdue within the window', () => {
  const plants = [
    scanned('overdue', 20, 7),
    scanned('due-today', 7, 7),
    scanned('due-in-two-days', 5, 7),
    scanned('due-next-month', 0, 30),
  ];
  const due = dueSoon(plants, NOW, null);
  assert.deepEqual(due.map((d) => d.plant.id), ['overdue', 'due-today', 'due-in-two-days']);
  assert.equal(due[0].kind, 'water');
});

test('dueSoon puts the most overdue first', () => {
  const plants = [scanned('slightly', 8, 7), scanned('badly', 30, 7)];
  assert.deepEqual(dueSoon(plants, NOW, null).map((d) => d.plant.id), ['badly', 'slightly']);
});

test('a plant with no schedule is not due, rather than being due forever', () => {
  assert.deepEqual(dueSoon([manual('m1')], NOW, null), []);
});

test('plantDisplayName prefers the nickname, then the species, then the diagnosis', () => {
  assert.equal(plantDisplayName(manual('m1', 'Ziggy')), 'Ziggy');
  assert.equal(plantDisplayName(manual('m1')), 'Dragon Scale Mint Variegated');
  assert.equal(plantDisplayName(scanned('s1', 1)), 'Monstera');
  assert.equal(
    plantDisplayName({ ...manual('m1'), species: undefined, diagnosis: undefined } as StoredPlant),
    'Unnamed plant'
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/portfolio.test.ts`
Expected: FAIL, `Cannot find module './portfolio.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/portfolio.ts`:

```ts
import { CARE_KINDS, careState, plantCarePlan, soilPlanFor, type CareKind } from './care.ts';
import type { GenusCarePlan } from './genusCarePlan.ts';
import type { StoredPlant } from '../services/plantStore.ts';

/*
 * What the Portfolio tab shows, as pure functions.
 *
 * The screen is a renderer: everything it decides - which plants the filter
 * keeps, what a plant is called, what needs doing this week - is decided here,
 * where it can be tested without a device.
 */

export type PortfolioFilter = 'all' | 'diagnosed';

/*
 * DIAGNOSED MEANS "HAS A DIAGNOSIS", not "was added by the camera". A plant the
 * user added by hand and photographed later is diagnosed, and the filter exists
 * to answer "which of my plants have I actually had checked" - which is a
 * question about the diagnosis, not about how the record started.
 */
export function filterPortfolio(plants: StoredPlant[], filter: PortfolioFilter): StoredPlant[] {
  if (filter === 'all') return plants;
  return plants.filter((p) => p.diagnosis !== undefined);
}

/*
 * What to call this plant on a card.
 *
 * The user's own name for it beats the species name, which beats whatever the
 * camera decided it was. A plant with none of the three cannot happen - the
 * store drops records with neither a species nor a diagnosis - but the string
 * is here rather than a crash, because a library screen is the wrong place to
 * discover a storage bug.
 */
export function plantDisplayName(plant: StoredPlant): string {
  return plant.nickname ?? plant.species?.name ?? plant.diagnosis?.plantName ?? 'Unnamed plant';
}

/* The botanical line under the name, when there is one worth showing. */
export function plantSecondaryName(plant: StoredPlant): string {
  const scientific = plant.species?.scientificName ?? plant.diagnosis?.scientificName ?? '';
  // Do not repeat the primary line back at the user.
  return scientific === plantDisplayName(plant) ? '' : scientific;
}

export interface DueItem {
  plant: StoredPlant;
  kind: CareKind;
  /* Whole days until due. Zero is today, negative is late. */
  daysUntilDue: number;
  label: string;
}

/* A week, because that is the horizon the strip is named after and the one a
 * person plans a weekend of plant care around. */
export const DUE_WINDOW_DAYS = 7;

/*
 * Everything due within the window, most overdue first.
 *
 * Every care kind, not just water: a plant that needs feeding is as actionable
 * as one that needs watering, and the whole point of the strip is that the user
 * does not have to open nine plants to find out.
 */
export function dueSoon(
  plants: StoredPlant[],
  now: number,
  genusPlanFor: ((plant: StoredPlant) => GenusCarePlan | null) | null
): DueItem[] {
  const out: DueItem[] = [];

  for (const plant of plants) {
    const genusPlan = genusPlanFor ? genusPlanFor(plant) : null;
    const soilPlan = soilPlanFor(genusPlan, plant.soilMedium);
    const carePlan = plantCarePlan(plant.diagnosis?.carePlan, genusPlan, plant.soilMedium);

    for (const kind of CARE_KINDS) {
      const lastAt =
        kind === 'water'
          ? plant.lastWateredAt
          : kind === 'repot'
            ? plant.lastRepottedAt
            : plant.lastFertilizedAt;
      const state = careState(kind, carePlan, lastAt, now, soilPlan);

      // 'unscheduled' has no interval and 'never_watered' has no anchor: both
      // are "we do not know", and guessing would fill the strip with plants
      // that are not actually due.
      if (state.status !== 'due' && state.status !== 'overdue' && state.status !== 'ok') continue;
      if (state.daysUntilDue === null || state.daysUntilDue > DUE_WINDOW_DAYS) continue;

      out.push({ plant, kind, daysUntilDue: state.daysUntilDue, label: state.label });
    }
  }

  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/portfolio.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio.ts src/lib/portfolio.test.ts
git commit -m "feat(portfolio): filtering, naming and the due-this-week rollup"
```

---

### Task 10: The soil medium illustration and card

**Files:**
- Create: `src/components/SoilMediumIcon.tsx`
- Create: `src/components/SoilCard.tsx`

No automated test - these are React Native components and this project has no component test runner. They are verified on device in Task 14.

- [ ] **Step 1: Write the icon**

Create `src/components/SoilMediumIcon.tsx`:

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { soilMediumById, type SoilMediumId } from '../lib/soilMedia';

/*
 * A growing medium, drawn.
 *
 * Ionicons on their own read as toolbar furniture, so the glyph is layered: a
 * tinted disc behind it, a lighter ring around that, and a row of grains along
 * the bottom whose count and size differ per medium. The result is closer to an
 * illustration than an icon while staying vector, theme-aware and free of
 * binary assets.
 *
 * `tint` on a medium is a Theme['color'] KEY, not a colour, so dark mode needs
 * no second table.
 */

/* How many grains sit at the base of the disc, and how big. Coarse media get a
 * few large ones, fine media get many small ones, and water gets none. */
const GRAINS: Record<SoilMediumId, { count: number; size: number }> = {
  potting_mix: { count: 7, size: 3 },
  aroid_mix: { count: 5, size: 5 },
  leca: { count: 4, size: 7 },
  pon: { count: 5, size: 6 },
  sphagnum: { count: 6, size: 4 },
  bark: { count: 3, size: 8 },
  perlite_mix: { count: 8, size: 3 },
  water: { count: 0, size: 0 },
};

export default function SoilMediumIcon({
  id,
  size = 56,
  selected = false,
}: {
  id: SoilMediumId;
  size?: number;
  selected?: boolean;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  const medium = soilMediumById(id);
  if (!medium) return null;

  const tint = (t.color as Record<string, string>)[medium.tint] ?? t.color.primary;
  const grain = GRAINS[id];

  return (
    <View
      style={[
        s.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(tint, selected ? 0.28 : 0.16),
          borderColor: selected ? tint : 'transparent',
        },
      ]}
    >
      <Ionicons
        name={medium.icon as keyof typeof Ionicons.glyphMap}
        size={Math.round(size * 0.42)}
        color={tint}
        style={s.glyph}
      />
      {grain.count > 0 && (
        <View style={[s.grains, { width: size * 0.62 }]}>
          {Array.from({ length: grain.count }).map((_, i) => (
            <View
              key={i}
              style={{
                width: grain.size,
                height: grain.size,
                borderRadius: grain.size / 2,
                backgroundColor: tint,
                // Alternating opacity gives the row depth without a second
                // colour, so it stays correct in both themes.
                opacity: i % 2 === 0 ? 0.75 : 0.45,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/* Ionicons colours are opaque; the disc behind them needs the same hue at low
 * alpha. Hex only - every tint in the theme is a hex literal. */
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    disc: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      overflow: 'hidden',
    },
    glyph: {
      marginBottom: 4,
    },
    grains: {
      position: 'absolute',
      bottom: 6,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
  });
}
```

- [ ] **Step 2: Write the picker card**

Create `src/components/SoilCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Theme, useTheme } from '../theme';
import SoilMediumIcon from './SoilMediumIcon';
import { SOIL_MEDIA, type SoilMediumId } from '../lib/soilMedia';

/*
 * Pick what the plant is growing in.
 *
 * Used twice: inline on the add-plant flow, and as a card on the plant screen
 * where changing it re-derives the whole schedule. One component, because the
 * two must never drift - a user who sets LECA when adding and sees a different
 * list when editing will not trust either.
 */

export default function SoilCard({
  value,
  onChange,
  title = 'Growing medium',
}: {
  value: SoilMediumId | undefined;
  onChange: (id: SoilMediumId) => void;
  title?: string;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);

  return (
    <View style={s.card}>
      <Text style={s.title}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {SOIL_MEDIA.map((medium) => {
          const selected = medium.id === value;
          return (
            <Pressable
              key={medium.id}
              onPress={() => onChange(medium.id)}
              style={[s.option, selected && s.optionSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${medium.label}. ${medium.description}`}
            >
              <SoilMediumIcon id={medium.id} selected={selected} />
              <Text style={[s.label, selected && s.labelSelected]} numberOfLines={1}>
                {medium.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {value && (
        <Text style={s.description}>
          {SOIL_MEDIA.find((m) => m.id === value)?.description}
        </Text>
      )}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      paddingVertical: t.space.md,
      gap: t.space.sm,
    },
    title: {
      ...t.type.label,
      color: t.color.foreground,
      paddingHorizontal: t.space.md,
    },
    row: {
      paddingHorizontal: t.space.md,
      gap: t.space.sm,
    },
    option: {
      alignItems: 'center',
      width: 76,
      gap: 6,
      paddingVertical: t.space.xs,
      borderRadius: t.radius.md,
    },
    optionSelected: {
      backgroundColor: t.color.primaryWash,
    },
    label: {
      ...t.type.caption,
      color: t.color.textMuted,
      textAlign: 'center',
    },
    labelSelected: {
      color: t.color.foreground,
    },
    description: {
      ...t.type.caption,
      color: t.color.textSecondary,
      paddingHorizontal: t.space.md,
    },
  });
}
```

Read `src/theme/index.ts` first and use its real `space`, `radius` and `type` keys. If a key used above does not exist, substitute the nearest one that does rather than adding to the theme.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SoilMediumIcon.tsx src/components/SoilCard.tsx
git commit -m "feat(soil): draw the growing media and let the user pick one"
```

---

### Task 11: Species picker screen

**Files:**
- Create: `src/screens/SpeciesPickerScreen.tsx`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the route**

In `src/types/index.ts`, add to `RootStackParamList`:

```ts
  /* The catalog. `onPick` is not passed through params - navigation params must
   * stay serializable - so the picker writes its result with
   * navigation.navigate('AddPlant', { picked }) instead. */
  SpeciesPicker: undefined;
```

and, in the same list:

```ts
  AddPlant: { picked?: { catalogId: string } } | undefined;
```

- [ ] **Step 2: Write the screen**

Create `src/screens/SpeciesPickerScreen.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { searchCatalog, type CatalogEntry } from '../lib/catalogSearch';

/*
 * Pick a species out of the catalog.
 *
 * The whole catalog is in the bundle, so search runs on every keystroke with no
 * debounce and no spinner - there is nothing to wait for, and a loading state
 * for a synchronous filter is a lie that costs a frame.
 *
 * Sections are family - genus - group, which is how the plants are actually
 * sold and talked about. Someone who does not know the name browses down;
 * someone who does types it.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SpeciesPicker'>;
};

export default function SpeciesPickerScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [query, setQuery] = useState('');

  const sections = useMemo(() => searchCatalog(query), [query]);

  const pick = (entry: CatalogEntry) => {
    // Hand the result back to the flow that opened this, rather than pushing a
    // new AddPlant on top of the one already there.
    navigation.navigate('AddPlant', { picked: { catalogId: entry.id } });
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={12}>
          <Ionicons name="close" size={24} color={t.color.foreground} />
        </Pressable>
        <Text style={s.title}>Choose a plant</Text>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={18} color={t.color.textMuted} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Alocasia, dragon scale, monstera..."
          placeholderTextColor={t.color.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search plants"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={12} accessibilityRole="button">
            <Ionicons name="close-circle" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.list}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={() => pick(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.scientificName}`}
          >
            <View style={s.rowText}>
              <Text style={s.rowName}>{item.name}</Text>
              <Text style={s.rowScientific}>{item.scientificName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No plant by that name</Text>
            <Text style={s.emptyBody}>
              Try the genus on its own - "alocasia", "hoya" - or a shorter spelling.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
    },
    title: { ...t.type.h2, color: t.color.foreground },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      marginHorizontal: t.space.md,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    input: { flex: 1, ...t.type.body, color: t.color.foreground, padding: 0 },
    list: { paddingBottom: t.space.xl },
    sectionHeader: {
      backgroundColor: t.color.background,
      paddingHorizontal: t.space.md,
      paddingTop: t.space.md,
      paddingBottom: t.space.xs,
    },
    sectionTitle: { ...t.type.label, color: t.color.textMuted },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginHorizontal: t.space.md,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.md,
      marginBottom: 6,
    },
    rowPressed: { opacity: 0.7 },
    rowText: { flex: 1 },
    rowName: { ...t.type.body, color: t.color.foreground },
    rowScientific: { ...t.type.caption, color: t.color.textMuted, fontStyle: 'italic' },
    empty: { paddingHorizontal: t.space.md, paddingTop: t.space.xl, gap: t.space.xs },
    emptyTitle: { ...t.type.h3, color: t.color.foreground },
    emptyBody: { ...t.type.body, color: t.color.textSecondary },
  });
}
```

Substitute real theme keys where these guesses do not exist.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. (The screen is not registered yet - that happens in Task 12.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/SpeciesPickerScreen.tsx src/types/index.ts
git commit -m "feat(catalog): a searchable species picker"
```

---

### Task 12: Add-plant flow

**Files:**
- Create: `src/screens/AddPlantScreen.tsx`
- Modify: `App.tsx` (or wherever the root stack is declared - grep for `RootStackParamList` and `Stack.Screen name="Camera"`)

- [ ] **Step 1: Write the screen**

Create `src/screens/AddPlantScreen.tsx`:

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { catalogEntryById, type CatalogEntry } from '../lib/catalogSearch';
import { DEFAULT_SOIL_MEDIUM, type SoilMediumId } from '../lib/soilMedia';
import SoilCard from '../components/SoilCard';
import { plantLibrary } from '../services/plantLibrary';
import { plantPhotos } from '../services/photos';
import { genusCarePlans } from '../services/genusCarePlans';

/*
 * Add a plant the user already owns and is not worried about.
 *
 * Four things, in the order a person actually has them: a photo, what it is,
 * what it is planted in, and optionally what they call it. Only the species is
 * required - a plant with no photo still belongs in the portfolio, and blocking
 * on a photo would turn "add my nine Alocasias" into a photo shoot.
 *
 * The genus care plan is fetched AFTER the save, and its failure is not the
 * user's problem: the plant is already in the library and the screen it opens
 * falls back to local advice.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AddPlant'>;
  route: RouteProp<RootStackParamList, 'AddPlant'>;
};

export default function AddPlantScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [soil, setSoil] = useState<SoilMediumId>(DEFAULT_SOIL_MEDIUM);
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);

  /*
   * The picker hands its choice back through params rather than a callback,
   * because navigation params must stay serializable. Reading it in an effect
   * rather than during render keeps the picker's own navigation from happening
   * inside a render pass.
   */
  const pickedId = route.params?.picked?.catalogId;
  useEffect(() => {
    if (!pickedId) return;
    const found = catalogEntryById(pickedId);
    if (found) setEntry(found);
    // Clear it so going back and forth does not re-apply a stale pick.
    navigation.setParams({ picked: undefined });
  }, [pickedId, navigation]);

  const pickPhoto = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        source === 'camera'
          ? 'PlantAI needs the camera to take a photo of your plant.'
          : 'PlantAI needs access to your photos to pick one.'
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    setPhotoUri(result.assets[0].uri);
  };

  const save = async () => {
    if (!entry || saving) return;
    setSaving(true);

    /*
     * Copy the photo into the document directory first. A camera cache URI is
     * purged by the OS on its own schedule, so a plant saved against one would
     * silently lose its picture days later.
     */
    let storedUri = photoUri ?? '';
    if (photoUri) {
      const copied = await plantPhotos.persist(photoUri).catch(() => null);
      if (copied) storedUri = copied;
    }

    const result = plantLibrary.saveManual({
      photoUri: storedUri,
      catalogId: entry.id,
      species: {
        name: entry.name,
        scientificName: entry.scientificName,
        genus: entry.genus,
        family: entry.family,
      },
      soilMedium: soil,
      ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
    });

    if (!result.ok) {
      setSaving(false);
      Alert.alert('Could not save', 'There is no room left on this device to save the plant.');
      return;
    }

    /*
     * Warm the genus plan on the way out. Deliberately not awaited before
     * navigating and deliberately not surfaced on failure: the plant is saved,
     * and the detail screen has a fallback.
     */
    void genusCarePlans.get(entry.genus, entry.family);

    navigation.replace('PlantDetail', { plantId: result.plant.id });
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" hitSlop={12}>
          <Ionicons name="close" size={24} color={t.color.foreground} />
        </Pressable>
        <Text style={s.title}>Add a plant</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Pressable
          style={s.photo}
          onPress={() => pickPhoto('library')}
          onLongPress={() => pickPhoto('camera')}
          accessibilityRole="button"
          accessibilityLabel="Choose a photo. Long press to use the camera."
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={s.photoImage} />
          ) : (
            <View style={s.photoEmpty}>
              <Ionicons name="image-outline" size={28} color={t.color.textMuted} />
              <Text style={s.photoHint}>Add a photo</Text>
              <Text style={s.photoSub}>Tap for your library, hold for the camera</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={s.speciesRow}
          onPress={() => navigation.navigate('SpeciesPicker')}
          accessibilityRole="button"
        >
          <View style={s.speciesText}>
            <Text style={s.fieldLabel}>Plant</Text>
            <Text style={entry ? s.speciesName : s.speciesPlaceholder}>
              {entry ? entry.name : 'Choose from the catalog'}
            </Text>
            {entry && <Text style={s.speciesScientific}>{entry.scientificName}</Text>}
          </View>
          <Ionicons name="chevron-forward" size={20} color={t.color.textMuted} />
        </Pressable>

        <SoilCard value={soil} onChange={setSoil} />

        <View style={s.nicknameCard}>
          <Text style={s.fieldLabel}>Nickname (optional)</Text>
          <TextInput
            style={s.nicknameInput}
            value={nickname}
            onChangeText={setNickname}
            placeholder="Big Bertha"
            placeholderTextColor={t.color.textMuted}
            maxLength={40}
            accessibilityLabel="Nickname"
          />
        </View>

        <Pressable
          style={[s.saveButton, (!entry || saving) && s.saveButtonDisabled]}
          onPress={save}
          disabled={!entry || saving}
          accessibilityRole="button"
        >
          <Text style={s.saveLabel}>{saving ? 'Saving...' : 'Add to portfolio'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
    },
    title: { ...t.type.h2, color: t.color.foreground },
    scroll: { padding: t.space.md, gap: t.space.md, paddingBottom: t.space.xl },
    photo: {
      height: 200,
      borderRadius: t.radius.lg,
      overflow: 'hidden',
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    photoImage: { width: '100%', height: '100%' },
    photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
    photoHint: { ...t.type.body, color: t.color.foreground },
    photoSub: { ...t.type.caption, color: t.color.textMuted },
    speciesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: t.space.md,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    speciesText: { flex: 1, gap: 2 },
    fieldLabel: { ...t.type.label, color: t.color.textMuted },
    speciesName: { ...t.type.body, color: t.color.foreground },
    speciesPlaceholder: { ...t.type.body, color: t.color.textMuted },
    speciesScientific: { ...t.type.caption, color: t.color.textMuted, fontStyle: 'italic' },
    nicknameCard: {
      padding: t.space.md,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      gap: 4,
    },
    nicknameInput: { ...t.type.body, color: t.color.foreground, padding: 0 },
    saveButton: {
      backgroundColor: t.color.primary,
      borderRadius: t.radius.lg,
      paddingVertical: t.space.md,
      alignItems: 'center',
    },
    saveButtonDisabled: { opacity: 0.5 },
    saveLabel: { ...t.type.body, color: t.color.onPrimary, fontWeight: '600' },
  });
}
```

Check `src/services/photos.ts` for the real method name before writing `plantPhotos.persist`. Grep it: `grep -n "return {" -A6 src/services/photos.ts`. Use whatever the store actually exposes for copying a photo into the document directory; if there is no such method, skip the copy and store the picker URI directly, and note it in the commit message.

- [ ] **Step 2: Register both screens**

Find the root stack (`grep -rn 'name="Camera"' src App.tsx`) and add, next to the existing screens:

```tsx
        <Stack.Screen name="AddPlant" component={AddPlantScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="SpeciesPicker"
          component={SpeciesPickerScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
```

with the matching imports.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AddPlantScreen.tsx App.tsx
git commit -m "feat(portfolio): add a plant you already own, by hand"
```

---

### Task 13: The Portfolio tab

**Files:**
- Create: `src/screens/PortfolioScreen.tsx`
- Modify: `src/navigation/Tabs.tsx`, `src/types/index.ts`, `src/components/PlantCard.tsx`
- Delete: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Rename the tab route**

In `src/types/index.ts`:

```ts
/* The three destinations in the bottom tab bar. `Scan` hosts nothing - its tab
 * press pushes the root-stack Camera screen instead. */
export type MainTabParamList = {
  Portfolio: undefined;
  Scan: undefined;
  Find: undefined;
};
```

In `src/navigation/Tabs.tsx`, change the import and the first `Tab.Screen`:

```tsx
import PortfolioScreen from '../screens/PortfolioScreen';
```

```tsx
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{
          title: 'Portfolio',
          tabBarIcon: ({ color, size }) => <Ionicons name="leaf-outline" size={size} color={color} />,
        }}
      />
```

Update the file's header comment: the tabs are now "your portfolio, the camera, and nursery search", and the note about `navigate('Home')` landing on "My Plants" should say "Portfolio".

Then grep for anything still naming the old route: `grep -rn "MyPlants" src App.tsx`. Fix each hit.

- [ ] **Step 2: Give PlantCard the diagnosed badge**

In `src/components/PlantCard.tsx`, replace the display-name and condition reads with the portfolio helpers, and add the badge:

```tsx
import { plantDisplayName, plantSecondaryName } from '../lib/portfolio';
```

```tsx
  const condition = plant.diagnosis?.condition;
  const color = t.color[CONDITION_COLOR[condition ?? ''] ?? 'conditionHealthy'];
  const water = wateringState(plant.diagnosis?.carePlan, plant.lastWateredAt, Date.now());
```

Use `plantDisplayName(plant)` wherever the card currently renders `plant.diagnosis.plantName`, and `plantSecondaryName(plant)` for the botanical line. Add to the card's trailing edge, beside the chevron:

```tsx
      {plant.diagnosis !== undefined && (
        <View style={s.diagnosedBadge}>
          <Ionicons name="medkit-outline" size={12} color={t.color.primary} />
          <Text style={s.diagnosedText}>Diagnosed</Text>
        </View>
      )}
```

```tsx
    diagnosedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: t.color.primaryWash,
    },
    diagnosedText: { ...t.type.caption, color: t.color.primary },
```

A plant with no diagnosis must render with no condition dot at all rather than a grey one - an absent condition is not a condition.

- [ ] **Step 3: Write the Portfolio screen**

Create `src/screens/PortfolioScreen.tsx` by copying `src/screens/HomeScreen.tsx` and changing what follows. Keep its first-run marketing branch, its `useFocusEffect` reload, its synchronous `useState` initializer and its photo repair exactly as they are - those all exist for reasons documented in that file.

Changes on top of the copy:

```tsx
import { dueSoon, filterPortfolio, type PortfolioFilter } from '../lib/portfolio';
import { genusCarePlans } from '../services/genusCarePlans';
```

```tsx
  const [filter, setFilter] = useState<PortfolioFilter>('all');

  const visible = useMemo(() => filterPortfolio(library.plants, filter), [library.plants, filter]);

  /*
   * `peek` and not `get`: the strip renders during the first frame and must not
   * wait on eight network calls. A genus with no cached plan simply falls back
   * to the diagnosis interval, which is what the card showed before this
   * feature existed.
   */
  const due = useMemo(
    () =>
      dueSoon(library.plants, Date.now(), (plant) => {
        const genus = plant.species?.genus ?? plant.diagnosis?.genus;
        return genus ? genusCarePlans.peek(genus) : null;
      }),
    [library.plants]
  );
```

Render, above the list:

```tsx
        {due.length > 0 && (
          <View style={s.dueStrip}>
            <Text style={s.dueTitle}>Due this week</Text>
            {due.slice(0, 5).map((item) => (
              <Pressable
                key={`${item.plant.id}-${item.kind}`}
                style={s.dueRow}
                onPress={() => navigation.navigate('PlantDetail', { plantId: item.plant.id })}
                accessibilityRole="button"
              >
                <Ionicons
                  name={
                    item.kind === 'water'
                      ? 'water-outline'
                      : item.kind === 'fertilizer'
                        ? 'nutrition-outline'
                        : 'flower-outline'
                  }
                  size={16}
                  color={t.color.textSecondary}
                />
                <Text style={s.dueName} numberOfLines={1}>
                  {plantDisplayName(item.plant)}
                </Text>
                <Text style={s.dueLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={s.filterRow}>
          {(['all', 'diagnosed'] as PortfolioFilter[]).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[s.chip, filter === f && s.chipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === f }}
            >
              <Text style={[s.chipText, filter === f && s.chipTextActive]}>
                {f === 'all' ? 'All' : 'Diagnosed'}
              </Text>
            </Pressable>
          ))}
        </View>
```

Render the plant list from `visible` rather than `library.plants`. Keep the existing `triageSections` grouping when `filter === 'all'`; when the Diagnosed filter is on, render a flat list, because a two-item filter that also regroups is two changes at once and the user only asked for one.

Add the FAB, last in the outer `View` so it floats:

```tsx
        <Pressable
          style={s.fab}
          onPress={() => navigation.navigate('AddPlant')}
          accessibilityRole="button"
          accessibilityLabel="Add a plant"
        >
          <Ionicons name="add" size={26} color={t.color.onPrimary} />
        </Pressable>
```

```tsx
    dueStrip: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      gap: t.space.xs,
      marginBottom: t.space.md,
    },
    dueTitle: { ...t.type.label, color: t.color.textMuted },
    dueRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: 4 },
    dueName: { ...t.type.body, color: t.color.foreground, flex: 1 },
    dueLabel: { ...t.type.caption, color: t.color.textSecondary },
    filterRow: { flexDirection: 'row', gap: t.space.sm, marginBottom: t.space.md },
    chip: {
      paddingHorizontal: t.space.md,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    chipActive: { backgroundColor: t.color.primaryWash, borderColor: t.color.primary },
    chipText: { ...t.type.caption, color: t.color.textSecondary },
    chipTextActive: { color: t.color.primary },
    fab: {
      position: 'absolute',
      right: t.space.md,
      bottom: t.space.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.primary,
    },
```

Also update the screen's own copy: the header says "Portfolio", and the first-run empty state should offer both routes in - "Scan a plant" and "Add one you own" - rather than the camera alone.

- [ ] **Step 4: Delete HomeScreen**

```bash
rm src/screens/HomeScreen.tsx
grep -rn "HomeScreen" src App.tsx
```

Expected: no hits. Fix any that remain.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: every test passes.

- [ ] **Step 6: Commit**

```bash
git add -A src/screens src/navigation src/components src/types
git commit -m "feat(portfolio): replace My Plants with a filterable Portfolio

One list of every plant, filterable to the ones that carry a diagnosis,
with a due-this-week rollup and a way in for plants that were never
scanned."
```

---

### Task 14: Plant screen owns the schedules

**Files:**
- Create: `src/components/ScheduleCard.tsx`
- Create: `src/components/CarePlanCard.tsx`
- Modify: `src/screens/PlantDetailScreen.tsx`

- [ ] **Step 1: Extract the schedule card**

Create `src/components/ScheduleCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { careState } from '../lib/care';
import { intervalLabel } from '../lib/watering';
import type { SoilCarePlan } from '../lib/genusCarePlan';
import type { CareKind } from '../services/plantStore';
import type { CarePlan } from '../types';

/*
 * One care kind's schedule: when it is due, how often, and the button that logs
 * it.
 *
 * One component for water, feed and repot because the three ARE the same
 * question with a different interval - that is already true in src/lib/care.ts,
 * and three near-identical cards on the plant screen was how they drifted
 * apart the first time.
 */

const KIND: Record<CareKind, { title: string; icon: string; verb: string; tint: string }> = {
  water: { title: 'Watering', icon: 'water-outline', verb: 'Log watering', tint: 'water' },
  fertilizer: { title: 'Feeding', icon: 'nutrition-outline', verb: 'Log feed', tint: 'feed' },
  repot: { title: 'Repotting', icon: 'flower-outline', verb: 'Log repot', tint: 'repot' },
};

export default function ScheduleCard({
  kind,
  carePlan,
  soilPlan,
  lastAt,
  busy,
  onLog,
  onHistory,
}: {
  kind: CareKind;
  carePlan: CarePlan | undefined;
  soilPlan: SoilCarePlan | undefined;
  lastAt: string | undefined;
  busy?: boolean;
  onLog: () => void;
  onHistory: () => void;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  const meta = KIND[kind];
  const state = careState(kind, carePlan, lastAt, Date.now(), soilPlan);
  const tint = (t.color as Record<string, string>)[meta.tint] ?? t.color.primary;

  const advice = kind === 'water' ? soilPlan?.water : kind === 'fertilizer' ? soilPlan?.fertilizer : undefined;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={18} color={tint} />
        <Text style={s.title}>{meta.title}</Text>
        <Pressable onPress={onHistory} hitSlop={10} accessibilityRole="button">
          <Text style={s.historyLink}>History</Text>
        </Pressable>
      </View>

      {/* An unscheduled kind says so plainly. A fabricated interval here becomes
          a reminder the app invented, and the user cannot tell the difference. */}
      <Text style={s.status}>
        {state.status === 'unscheduled' ? 'No schedule yet' : state.label}
      </Text>
      {state.intervalDays !== null && (
        <Text style={s.interval}>
          {intervalLabel({
            soil: '',
            light: '',
            water: '',
            waterEveryDays: state.intervalDays,
            ...(state.intervalDaysMax === null ? {} : { waterEveryDaysMax: state.intervalDaysMax }),
          })}
        </Text>
      )}
      {advice && <Text style={s.advice}>{advice}</Text>}

      <Pressable
        style={[s.button, { backgroundColor: tint }, busy && s.buttonBusy]}
        onPress={onLog}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={s.buttonLabel}>{meta.verb}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      gap: 6,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
    title: { ...t.type.label, color: t.color.foreground, flex: 1 },
    historyLink: { ...t.type.caption, color: t.color.primary },
    status: { ...t.type.body, color: t.color.foreground },
    interval: { ...t.type.caption, color: t.color.textMuted },
    advice: { ...t.type.caption, color: t.color.textSecondary },
    button: {
      marginTop: t.space.xs,
      borderRadius: t.radius.md,
      paddingVertical: t.space.sm,
      alignItems: 'center',
    },
    buttonBusy: { opacity: 0.6 },
    buttonLabel: { ...t.type.body, color: '#FFFFFF', fontWeight: '600' },
  });
}
```

- [ ] **Step 2: Extract the care plan card**

Create `src/components/CarePlanCard.tsx`:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { soilMediumById, type SoilMediumId } from '../lib/soilMedia';
import type { SoilCarePlan } from '../lib/genusCarePlan';
import type { CarePlan } from '../types';

/*
 * The ongoing care advice for this plant, in this medium.
 *
 * Prefers the genus plan for the plant's medium and falls back to whatever the
 * diagnosis said. The fallback is not a lesser version of the same thing - it
 * is species advice with no idea what the plant is potted in - so the header
 * says which one the user is reading.
 */

export default function CarePlanCard({
  soilPlan,
  fallback,
  medium,
  genus,
}: {
  soilPlan: SoilCarePlan | undefined;
  fallback: CarePlan | undefined;
  medium: SoilMediumId | undefined;
  genus: string | undefined;
}) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  if (!soilPlan && !fallback) return null;

  const mediumLabel = soilMediumById(medium)?.label;
  const rows: { icon: string; label: string; value: string }[] = soilPlan
    ? [
        { icon: 'sunny-outline', label: 'Light', value: soilPlan.light },
        { icon: 'water-outline', label: 'Water', value: soilPlan.water },
        { icon: 'nutrition-outline', label: 'Feed', value: soilPlan.fertilizer },
        { icon: 'thermometer-outline', label: 'Humidity', value: soilPlan.humidity },
      ]
    : [
        { icon: 'layers-outline', label: 'Soil', value: fallback!.soil },
        { icon: 'sunny-outline', label: 'Light', value: fallback!.light },
        { icon: 'water-outline', label: 'Water', value: fallback!.water },
      ];

  return (
    <View style={s.card}>
      <Text style={s.title}>
        {soilPlan && genus && mediumLabel ? `${genus} in ${mediumLabel}` : 'Care'}
      </Text>
      {rows
        .filter((r) => r.value.length > 0)
        .map((row) => (
          <View key={row.label} style={s.row}>
            <Ionicons
              name={row.icon as keyof typeof Ionicons.glyphMap}
              size={16}
              color={t.color.textMuted}
            />
            <View style={s.rowText}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.rowValue}>{row.value}</Text>
            </View>
          </View>
        ))}
      {soilPlan?.warnings?.map((warning) => (
        <View key={warning} style={s.warning}>
          <Ionicons name="alert-circle-outline" size={16} color={t.color.warning} />
          <Text style={s.warningText}>{warning}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      gap: t.space.sm,
    },
    title: { ...t.type.label, color: t.color.foreground },
    row: { flexDirection: 'row', gap: t.space.sm },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { ...t.type.caption, color: t.color.textMuted },
    rowValue: { ...t.type.body, color: t.color.foreground },
    warning: {
      flexDirection: 'row',
      gap: t.space.sm,
      backgroundColor: t.color.warningWash,
      borderRadius: t.radius.md,
      padding: t.space.sm,
    },
    warningText: { ...t.type.caption, color: t.color.foreground, flex: 1 },
  });
}
```

- [ ] **Step 3: Rewire PlantDetailScreen**

In `src/screens/PlantDetailScreen.tsx`:

```tsx
import { plantCarePlan, soilPlanFor } from '../lib/care';
import { plantDisplayName, plantSecondaryName } from '../lib/portfolio';
import { genusCarePlans } from '../services/genusCarePlans';
import { DEFAULT_SOIL_MEDIUM, type SoilMediumId } from '../lib/soilMedia';
import SoilCard from '../components/SoilCard';
import ScheduleCard from '../components/ScheduleCard';
import CarePlanCard from '../components/CarePlanCard';
```

Inside the component, after the plant is loaded:

```tsx
  const genus = plant?.species?.genus ?? plant?.diagnosis?.genus;

  /*
   * Read the cache during render so the correct plan is the only one ever
   * painted, then fetch in the background if it was a miss. The state update
   * that follows a successful fetch is what re-renders with the real advice.
   */
  const [genusPlan, setGenusPlan] = useState(() => (genus ? genusCarePlans.peek(genus) : null));

  useEffect(() => {
    if (!genus || genusPlan) return;
    const family = plant?.species?.family ?? 'Houseplants';
    let cancelled = false;
    genusCarePlans.get(genus, family).then((plan) => {
      if (!cancelled && plan) setGenusPlan(plan);
    });
    return () => {
      cancelled = true;
    };
  }, [genus, genusPlan, plant?.species?.family]);

  const medium = plant?.soilMedium;
  const soilPlan = soilPlanFor(genusPlan, medium);
  const carePlan = plantCarePlan(plant?.diagnosis?.carePlan, genusPlan, medium);

  const changeMedium = (next: SoilMediumId) => {
    if (!plant) return;
    const result = plantLibrary.update(plant.id, { soilMedium: next });
    if (result.ok) setPlant(result.plant);
  };
```

Then, in the render:
- Use `plantDisplayName(plant)` and `plantSecondaryName(plant)` for the title block instead of `plant.diagnosis.plantName`.
- Guard every diagnosis-derived section (condition pill, issues, treatments) behind `plant.diagnosis && ...`. A hand-added plant shows none of them; it shows an "Not diagnosed yet" row with a button that navigates to `Camera`.
- Replace the existing watering card and the `CARE_LOG_ROWS` loop with three `ScheduleCard`s:

```tsx
        <ScheduleCard
          kind="water"
          carePlan={carePlan}
          soilPlan={soilPlan}
          lastAt={plant.lastWateredAt}
          busy={watering}
          onLog={logWatering}
          onHistory={() => navigation.navigate('WateringHistory', { plantId: plant.id, kind: 'water' })}
        />
        <ScheduleCard
          kind="fertilizer"
          carePlan={carePlan}
          soilPlan={soilPlan}
          lastAt={plant.lastFertilizedAt}
          onLog={() => logCare('fertilizer')}
          onHistory={() =>
            navigation.navigate('WateringHistory', { plantId: plant.id, kind: 'fertilizer' })
          }
        />
        <ScheduleCard
          kind="repot"
          carePlan={carePlan}
          soilPlan={soilPlan}
          lastAt={plant.lastRepottedAt}
          onLog={() => logCare('repot')}
          onHistory={() => navigation.navigate('WateringHistory', { plantId: plant.id, kind: 'repot' })}
        />
```

Reuse the screen's existing watering handler for `logWatering` (it schedules the reminder) and its existing `markCare` call for `logCare`. Do not write new ones.
- Replace the `CARE_ROWS` block with `<CarePlanCard soilPlan={soilPlan} fallback={plant.diagnosis?.carePlan} medium={medium} genus={genus} />`.
- Add `<SoilCard value={medium ?? DEFAULT_SOIL_MEDIUM} onChange={changeMedium} title="Growing medium" />` above the schedules, since it is what they are derived from.

Delete `CARE_ROWS` and `CARE_LOG_ROWS` and their comments once nothing references them.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: every test passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/ScheduleCard.tsx src/components/CarePlanCard.tsx src/screens/PlantDetailScreen.tsx
git commit -m "feat(plant): schedules and care advice driven by the growing medium

Watering, feeding and repotting are now three instances of one card, fed
by the genus plan for whatever the plant is potted in. Changing the
medium reschedules everything without a network call."
```

---

### Task 15: Full verification and the manual test script

**Files:** none

- [ ] **Step 1: Run everything**

```bash
npm run typecheck
npm test
```

Expected: both clean. Paste the actual output into the task notes - do not claim green without it.

- [ ] **Step 2: Check nothing was left behind**

```bash
grep -rn "MyPlants\|HomeScreen" src App.tsx
grep -rn "plant\.diagnosis\." src | grep -v "diagnosis?\." | grep -v test
```

Expected: no hits from the first. Any hit from the second is an unguarded diagnosis read that will crash on a hand-added plant - fix it.

- [ ] **Step 3: Hand Ron the manual test script**

Ron runs the app; synthetic taps do not register in the RN view. Give him this, numbered, and wait:

1. Start the API server (`npm run server`) and Metro (`npm start`), open the app.
2. The first tab reads **Portfolio**. Existing plants are all still there, each with a "Diagnosed" badge.
3. Tap **Diagnosed**. The list shows the same plants. Tap **All**. Nothing disappears.
4. Tap the **+** button. Pick a photo from the library. Tap **Plant**, type "dragon", pick "Dragon Scale Mint Variegated".
5. The soil row shows eight drawn media. Pick **LECA**. Check the drawing is legible - then switch the phone to dark mode and check it again.
6. Type a nickname. Tap **Add to portfolio**. The plant screen opens.
7. Within about a minute, the care section changes from generic advice to a header reading **Alocasia in LECA**, with a watering interval shorter than the default.
8. Change the medium to **Sphagnum moss**. The watering interval gets longer, immediately, with no spinner.
9. Turn off wifi and mobile data. Change the medium back to LECA. It still switches instantly.
10. Add a second Alocasia while still offline. It saves, and its care section already reads "Alocasia in ...".
11. Go back to Portfolio. The new plants appear with no "Diagnosed" badge, and tapping **Diagnosed** hides them.
12. Log a watering on one plant. The "Due this week" strip at the top of Portfolio updates.
13. Force-quit the app and reopen it. Everything above is still true.

- [ ] **Step 4: Commit anything the manual pass turned up**

Only after Ron reports back.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1. Species catalog | 2, 3 |
| 2. Genus care plans, per soil | 5, 6, 7 |
| 3. Soil media | 1, 10 |
| 4. Store v2 | 4 |
| 5. Portfolio tab | 9, 13 |
| 6. Add-plant flow | 11, 12 |
| 7. Schedules in both places | 8 (logic), 13 (rollup strip), 14 (per-plant) |
| Error handling: failed care-plan call | 5 (`get` returns null), 8 (`soilAdjustedPlan` fallback), 12 (save is not blocked) |
| Error handling: partial response | 5, 6 (validators reject, nothing cached) |
| Error handling: stale `catalogId` | 3 (`catalogEntryById` returns undefined), 4 (`species` snapshot) |
| Testing | Tasks 1, 3, 4, 5, 6, 8, 9 automated; Task 15 manual |
| Out of scope: Supabase sync, server catalog | Not planned. Trello #74 filed. |

**Known gaps, deliberate:**
- `WateringHistoryScreen` is untouched. It already accepts a `kind` param and the new `ScheduleCard` passes it, so all three histories work; it just does not know about growing media. Not in scope.
- The `species` field is only ever set by the add-plant flow. Linking an existing scanned plant to a catalog entry is supported by the store (`update` accepts `species`) but has no UI. Not in the spec.
