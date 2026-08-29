# Epic 3a - Plant Library Sync to Supabase - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-shot import of a device's local plant library into a logged-in Supabase account, then write-through (online-only) sync of every plant mutation for the rest of that session, with a synchronous local mirror so Home's D8 no-flash rule survives.

**Architecture:** A new `plantRepo` facade sits in front of the existing local `plantLibrary` and a new `cloudPlantLibrary`. A synchronous `sessionHint` flag (mirroring `onboarding.ts`'s pattern) tells the facade, at first paint, whether to read the guest key or a separate cloud-mirror key - both read through the existing `createPlantStore` machinery from `plantStore.ts`, reused rather than reimplemented, so quarantine/corrupt-detection stays free. Network calls are isolated behind an injectable `CloudDeps` seam (pure logic in `plantCloud.ts`, real Supabase binding in `supabasePlantCloud.ts`), the same pure/binding split every other store in this codebase already uses.

**Tech Stack:** Expo SDK 56, `@supabase/supabase-js`, `expo-sqlite/kv-store`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-22-epic3-plant-sync-design.md`

---

## Task 1: `plantStore.ts` gains a bulk `replace()`

The mirror (Task 3) needs to overwrite its whole contents with whatever Supabase just returned, without going through `save()`'s id/timestamp generation. `plantStore.ts` already has every other primitive (`persist`, `load`, quarantine) - this just exposes one more.

**Files:**
- Modify: `src/services/plantStore.ts:451` (the `return { load, save, update, markWatered, remove }` line, inside `createPlantStore`)
- Test: `src/services/plantStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/plantStore.test.ts` (near the other `save`/`persist` tests):

```ts
test('replace() overwrites the whole library and persists it', () => {
  const { deps, data } = fakeStorage();
  const store = createPlantStore(deps, fixedOpts());

  const first = store.save({ photoUri: 'a.jpg', diagnosis }).ok
    ? store.load().plants
    : [];
  assert.equal(first.length, 1);

  const incoming = [
    { id: 'cloud-1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'b.jpg', diagnosis },
    { id: 'cloud-2', savedAt: '2026-08-02T00:00:00.000Z', photoUri: 'c.jpg', diagnosis },
  ];
  const result = store.replace(incoming);
  assert.equal(result, true);

  const reloaded = store.load();
  assert.equal(reloaded.ok, true);
  assert.deepEqual(reloaded.plants.map((p) => p.id), ['cloud-1', 'cloud-2']);
  assert.ok(data.get(LIBRARY_KEY)?.includes('cloud-1'));
});

test('replace() returns false and does not persist when the write does not land', () => {
  const { deps, breakWrites } = fakeStorage();
  const store = createPlantStore(deps, fixedOpts());
  breakWrites('throw');

  const result = store.replace([{ id: 'x', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'a.jpg', diagnosis }]);
  assert.equal(result, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/plantStore.test.ts`
Expected: FAIL with `store.replace is not a function`

- [ ] **Step 3: Implement `replace()`**

In `src/services/plantStore.ts`, inside `createPlantStore`, add the function just above the final `return`:

```ts
  /*
   * Overwrite the whole library with `plants` as given - no id/timestamp
   * generation, no merge with what is already stored. For a store standing in
   * as a read cache of an external source of truth (the Supabase mirror),
   * where the caller already has the authoritative list and generating new
   * identity for it here would desync it from the source it mirrors.
   */
  function replace(plants: StoredPlant[]): boolean {
    return persist(plants);
  }
```

Then change the return statement to:

```ts
  return { load, save, update, markWatered, remove, replace };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/plantStore.test.ts`
Expected: PASS, all tests green (existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/services/plantStore.ts src/services/plantStore.test.ts
git commit -m "feat(plantStore): add bulk replace() for cache-of-external-source use"
```

---

## Task 2: Supabase migration - `plants` table, storage bucket, cascade delete

**Files:**
- Create: `supabase/migrations/20260822010000_epic3_plants_sync.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Epic 3a (plant library sync) - plants table, RLS, private photo bucket,
-- and the storage-cleanup step delete_own_account() needs now that a
-- deleted account can own objects the FK cascade does not reach.

create table public.plants (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_at timestamptz not null,
  -- Storage OBJECT PATH ("<user_id>/<id>.<ext>"), not a URL - the bucket is
  -- private, so the client asks for a fresh signed URL at read time instead
  -- of a permanent one that would either not resolve or never expire.
  photo_path text,
  diagnosis jsonb not null,
  last_watered_at timestamptz,
  watering_log jsonb not null default '[]'::jsonb,
  reminder_id text
);

create index plants_user_id_idx on public.plants (user_id);

alter table public.plants enable row level security;

create policy "plants_select_own"
  on public.plants for select
  using (auth.uid() = user_id);

create policy "plants_insert_own"
  on public.plants for insert
  with check (auth.uid() = user_id);

create policy "plants_update_own"
  on public.plants for update
  using (auth.uid() = user_id);

create policy "plants_delete_own"
  on public.plants for delete
  using (auth.uid() = user_id);

-- Private bucket: every object path is "<user_id>/<filename>", and RLS below
-- checks that leading folder against auth.uid() rather than relying on a
-- public/signed split at the bucket level.
insert into storage.buckets (id, name, public)
values ('plant-photos', 'plant-photos', false)
on conflict (id) do nothing;

create policy "plant_photos_select_own"
  on storage.objects for select
  using (bucket_id = 'plant-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "plant_photos_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'plant-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "plant_photos_update_own"
  on storage.objects for update
  using (bucket_id = 'plant-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "plant_photos_delete_own"
  on storage.objects for delete
  using (bucket_id = 'plant-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- delete_own_account() (from 20260822000000_auth_profiles.sql) deletes
-- auth.users, which cascades to plants via the FK above - but NOT to the
-- storage objects those rows pointed at, since Storage lives outside
-- Postgres's cascade graph. Replace the function with one that also clears
-- the caller's photo folder first. Same security-definer / auth.uid()-scoped
-- shape as the original: there is still no id to spoof, because auth.uid()
-- is the caller's own session, not a client-supplied argument.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  delete from storage.objects
  where bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = uid::text;

  delete from auth.users where id = uid;
  -- profiles and plants rows cascade-delete via their FKs.
end;
$$;
```

- [ ] **Step 2: Apply it to the live project**

Run: `supabase db push` (or `supabase migration up` if working against the local shadow db first, per whatever this repo's existing workflow was for `20260822000000_auth_profiles.sql`)
Expected: migration applies with no errors; `select * from public.plants limit 1;` via `supabase db query --linked` returns an empty result set (table exists, RLS active).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260822010000_epic3_plants_sync.sql
git commit -m "feat(supabase): plants table, private photo bucket, cascade cleanup"
```

---

## Task 3: `sessionHint` + `cloudMirror` bindings

`sessionHint` is a one-boolean sync flag (same shape as `onboarding.ts`'s sync-read requirement) so Home can know at first paint, without waiting on Supabase's async session hydration, whether to read the guest key or the mirror key. `cloudMirror` is `plantStore.ts`'s existing machinery pointed at a second storage key - no new logic, just a second binding like `plantLibrary.ts` is the first.

**Files:**
- Create: `src/services/sessionHint.ts`
- Create: `src/services/cloudMirror.ts`

- [ ] **Step 1: Write `sessionHint.ts`**

```ts
import Storage from 'expo-sqlite/kv-store';

/*
 * A synchronous "was a session active as of the last auth event" flag.
 *
 * Supabase's real session lives behind `AsyncStorage` and is only knowable
 * asynchronously (`supabase.auth.getSession()`), which is fine for Login/
 * Settings but not for Home: D8 requires knowing which local key to read
 * (guest vs. cloud-mirror) during the FIRST render, the same constraint that
 * made `plantLibrary` and `onboarding` synchronous. `useSession` (next task)
 * keeps this in sync with every auth state change; it is a hint, not the
 * source of truth - `getSession()` is still asked once per mount to correct
 * a stale flag (e.g. a session that expired while the app was closed).
 */

const KEY = 'plantai.session-hint';

export function getSessionHint(): boolean {
  return Storage.getItemSync(KEY) === '1';
}

export function setSessionHint(active: boolean): void {
  if (active) {
    Storage.setItemSync(KEY, '1');
  } else {
    Storage.removeItemSync(KEY);
  }
}
```

- [ ] **Step 2: Write `cloudMirror.ts`**

```ts
import Storage from 'expo-sqlite/kv-store';
import { createPlantStore, type StorageDeps } from './plantStore';

/*
 * The local read cache of a logged-in account's cloud plants - a second
 * binding of the same `createPlantStore` machinery `plantLibrary.ts` uses,
 * under its own key so it is never confused with (or overwrites) a guest
 * library that has not been imported yet.
 */
export const MIRROR_KEY = 'plantai.library.cloud-mirror';

const mirrorStorage: StorageDeps = {
  getItem: (key) => Storage.getItemSync(remap(key)),
  setItem: (key, value) => Storage.setItemSync(remap(key), value),
  removeItem: (key) => Storage.removeItemSync(remap(key)),
};

// `createPlantStore` addresses its own `LIBRARY_KEY`/`QUARANTINE_KEY`
// constants internally; remap those two onto the mirror's namespace so this
// binding never touches the guest keys.
function remap(key: string): string {
  if (key === 'plantai.library') return MIRROR_KEY;
  if (key === 'plantai.library.corrupt') return 'plantai.library.cloud-mirror.corrupt';
  return key;
}

export const cloudMirror = createPlantStore(mirrorStorage);

/* Logout (Task 9): drop the mirror and its quarantine slot entirely. */
export function wipeCloudMirror(): void {
  Storage.removeItemSync(MIRROR_KEY);
  Storage.removeItemSync('plantai.library.cloud-mirror.corrupt');
}
```

- [ ] **Step 3: Sanity-check with a scratch test, then delete it**

`plantStore.ts`'s `LIBRARY_KEY`/`QUARANTINE_KEY` constants are module-level, not parameterized - confirm the `remap` shim actually intercepts them by adding a throwaway test, running it, then removing it (this file has no permanent test - it is a binding, same as `plantLibrary.ts`, which also has none):

```ts
// scratch, not committed
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudMirror, MIRROR_KEY } from './cloudMirror.ts';

test('scratch: cloudMirror writes under the mirror key', () => {
  const result = cloudMirror.save({ photoUri: 'a.jpg', diagnosis: {} as any });
  assert.equal(result.ok, true);
});
```

Run: `node --test src/services/cloudMirror.scratch.test.ts`
Expected: PASS. Delete the scratch file afterward - it is throwaway verification, not a permanent test.

- [ ] **Step 4: Commit**

```bash
git add src/services/sessionHint.ts src/services/cloudMirror.ts
git commit -m "feat(sync): sessionHint flag and cloud-mirror storage binding"
```

---

## Task 4: `plantCloud.ts` - pure network-facing logic (injectable, tested)

Row↔`StoredPlant` mapping and the operations `plantRepo` needs, behind a `CloudDeps` seam so `node --test` can exercise upload failure, partial-batch failure, and update/delete without a real Supabase project - mirroring how `photoStore.ts` fakes `PhotoDeps`.

**Files:**
- Create: `src/services/plantCloud.ts`
- Test: `src/services/plantCloud.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud.ts';
import type { PlantDiagnosis } from '../types/index.ts';
import type { StoredPlant } from './plantStore.ts';

const diagnosis: PlantDiagnosis = {
  plantName: 'Mini monstera',
  scientificName: 'Rhaphidophora tetrasperma',
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: [],
  treatments: [],
  canBeSaved: true,
  confidence: 50,
  description: '',
};

function fakeDeps(seed: { rows?: CloudRow[]; uploadFails?: Set<string>; insertFails?: Set<string> } = {}) {
  const rows = new Map((seed.rows ?? []).map((r) => [r.id, r]));
  const uploads: string[] = [];

  const deps: CloudDeps = {
    fetchPlants: async () => [...rows.values()],
    uploadPhoto: async (path, sourceUri) => {
      uploads.push(path);
      if (seed.uploadFails?.has(sourceUri)) return null;
      return path;
    },
    insertPlant: async (row) => {
      if (seed.insertFails?.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
    updatePlant: async (id, patch) => {
      const existing = rows.get(id);
      if (!existing) return false;
      rows.set(id, { ...existing, ...patch });
      return true;
    },
    deletePlant: async (id) => {
      rows.delete(id);
      return true;
    },
  };
  return { deps, rows, uploads };
}

test('fetchAll() maps cloud rows back to StoredPlant shape', async () => {
  const { deps } = fakeDeps({
    rows: [
      {
        id: 'p1',
        user_id: 'u1',
        saved_at: '2026-08-01T00:00:00.000Z',
        photo_path: 'u1/p1.jpg',
        diagnosis,
        last_watered_at: null,
        watering_log: [],
        reminder_id: null,
      },
    ],
  });
  const cloud = createCloudPlantLibrary(deps);
  const plants = await cloud.fetchAll();
  assert.equal(plants.length, 1);
  assert.equal(plants[0].id, 'p1');
  assert.equal(plants[0].photoUri, 'u1/p1.jpg');
  assert.equal(plants[0].diagnosis.plantName, 'Mini monstera');
  assert.equal(plants[0].lastWateredAt, undefined);
});

test('savePlant() uploads the photo then inserts the row', async () => {
  const { deps, uploads } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps);
  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });

  assert.equal(result.ok, true);
  assert.equal(uploads.length, 1);
  if (result.ok) assert.match(result.plant.photoUri, /^u1\//);
});

test('savePlant() still inserts the row when the photo upload fails', async () => {
  const { deps } = fakeDeps({ uploadFails: new Set(['file:///cache/a.jpg']) });
  const cloud = createCloudPlantLibrary(deps);
  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });

  // A missing photo is recoverable (same tolerance the local store has for a
  // dead cache URI); a missing PLANT is not, so the insert must still happen.
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plant.photoUri, '');
});

test('savePlant() reports failure when the insert itself fails', async () => {
  const { deps } = fakeDeps();
  const cloud = createCloudPlantLibrary(deps, { newId: () => 'fixed-id' });
  (deps.insertPlant as any) = async () => false;

  const result = await cloud.savePlant('u1', { photoUri: 'file:///cache/a.jpg', diagnosis });
  assert.equal(result.ok, false);
});

test('importBatch() reports per-plant success/failure and does not stop on one failure', async () => {
  const local: StoredPlant[] = [
    { id: 'l1', savedAt: '2026-08-01T00:00:00.000Z', photoUri: 'file:///a.jpg', diagnosis },
    { id: 'l2', savedAt: '2026-08-02T00:00:00.000Z', photoUri: 'file:///b.jpg', diagnosis },
  ];
  const { deps } = fakeDeps({ insertFails: new Set(['l2']) });
  const cloud = createCloudPlantLibrary(deps);

  const result = await cloud.importBatch('u1', local);
  assert.deepEqual(result.imported.sort(), ['l1']);
  assert.deepEqual(result.failed.sort(), ['l2']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/plantCloud.test.ts`
Expected: FAIL - `./plantCloud.ts` does not exist yet

- [ ] **Step 3: Implement `plantCloud.ts`**

```ts
import type { PlantDiagnosis } from '../types';
import type { StoredPlant } from './plantStore';
import { photoExtension } from './photoStore';

/*
 * Row shape as it lives in `public.plants` (see the Epic 3a migration).
 * `photo_path` is a Storage object path ("<user_id>/<id>.<ext>"), not a URL -
 * the bucket is private, so callers resolve it to a signed URL separately
 * (the real binding, `supabasePlantCloud.ts`, does this; tests here treat the
 * path as opaque).
 */
export interface CloudRow {
  id: string;
  user_id: string;
  saved_at: string;
  photo_path: string | null;
  diagnosis: PlantDiagnosis;
  last_watered_at: string | null;
  watering_log: string[] | null;
  reminder_id: string | null;
}

/*
 * The seam that keeps this module testable without a network - mirrors
 * `StorageDeps` (plantStore.ts) and `PhotoDeps` (photoStore.ts). Each method
 * is one round trip; `plantCloud.ts` owns orchestration (upload-then-insert,
 * batch-with-partial-failure), never raw Supabase calls.
 */
export interface CloudDeps {
  fetchPlants(): Promise<CloudRow[]>;
  /* Returns the stored path on success, null if the upload did not land -
   * never throws, mirroring photoStore's `adopt()`. */
  uploadPhoto(path: string, sourceUri: string): Promise<string | null>;
  insertPlant(row: CloudRow): Promise<boolean>;
  updatePlant(id: string, patch: Partial<CloudRow>): Promise<boolean>;
  deletePlant(id: string): Promise<boolean>;
}

export interface CloudOptions {
  now?: () => number;
  newId?: () => string;
}

export type CloudSaveResult =
  | { ok: true; plant: StoredPlant }
  | { ok: false; reason: 'network' };

export type CloudMutateResult = { ok: true } | { ok: false; reason: 'network' | 'not_found' };

export interface ImportBatchResult {
  imported: string[];
  failed: string[];
}

function toStoredPlant(row: CloudRow): StoredPlant {
  const plant: StoredPlant = {
    id: row.id,
    savedAt: row.saved_at,
    photoUri: row.photo_path ?? '',
    diagnosis: row.diagnosis,
  };
  if (row.last_watered_at) plant.lastWateredAt = row.last_watered_at;
  if (row.watering_log && row.watering_log.length > 0) plant.wateringLog = row.watering_log;
  if (row.reminder_id) plant.reminderId = row.reminder_id;
  return plant;
}

export function createCloudPlantLibrary(deps: CloudDeps, opts: CloudOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId =
    opts.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  async function fetchAll(): Promise<StoredPlant[]> {
    const rows = await deps.fetchPlants();
    return rows.map(toStoredPlant);
  }

  /*
   * Upload then insert, in that order and NOT awaited-together: a photo that
   * fails to upload still leaves a real, findable plant - the same tolerance
   * `photoStore.adopt()` has for a dead source URI. A row that fails to
   * insert is the one failure mode this reports, since an unfindable plant is
   * the one thing 3a promises never happens silently.
   */
  async function savePlant(
    userId: string,
    input: { photoUri: string; diagnosis: PlantDiagnosis }
  ): Promise<CloudSaveResult> {
    const id = newId();
    const path = `${userId}/${id}.${photoExtension(input.photoUri)}`;
    const uploaded = await deps.uploadPhoto(path, input.photoUri);

    const row: CloudRow = {
      id,
      user_id: userId,
      saved_at: new Date(now()).toISOString(),
      photo_path: uploaded,
      diagnosis: input.diagnosis,
      last_watered_at: null,
      watering_log: [],
      reminder_id: null,
    };

    if (!(await deps.insertPlant(row))) return { ok: false, reason: 'network' };
    return { ok: true, plant: toStoredPlant(row) };
  }

  async function updatePlant(
    id: string,
    patch: Partial<{ lastWateredAt: string | null; reminderId: string | null; wateringLog: string[] }>
  ): Promise<CloudMutateResult> {
    const rowPatch: Partial<CloudRow> = {};
    if ('lastWateredAt' in patch) rowPatch.last_watered_at = patch.lastWateredAt ?? null;
    if ('reminderId' in patch) rowPatch.reminder_id = patch.reminderId ?? null;
    if ('wateringLog' in patch) rowPatch.watering_log = patch.wateringLog ?? [];

    return (await deps.updatePlant(id, rowPatch)) ? { ok: true } : { ok: false, reason: 'network' };
  }

  async function removePlant(id: string): Promise<CloudMutateResult> {
    return (await deps.deletePlant(id)) ? { ok: true } : { ok: false, reason: 'network' };
  }

  /*
   * One-shot import (Task 6 wires this to the banner). Every plant is
   * attempted independently - one failure must not stop the rest, and the
   * caller decides what "not fully imported" means for the guest key.
   */
  async function importBatch(userId: string, plants: StoredPlant[]): Promise<ImportBatchResult> {
    const imported: string[] = [];
    const failed: string[] = [];

    for (const plant of plants) {
      const path = `${userId}/${plant.id}.${photoExtension(plant.photoUri)}`;
      const uploaded = plant.photoUri ? await deps.uploadPhoto(path, plant.photoUri) : null;

      const row: CloudRow = {
        id: plant.id,
        user_id: userId,
        saved_at: plant.savedAt,
        photo_path: uploaded,
        diagnosis: plant.diagnosis,
        last_watered_at: plant.lastWateredAt ?? null,
        watering_log: plant.wateringLog ?? [],
        reminder_id: null, // device-local notification handles never travel to another device
      };

      if (await deps.insertPlant(row)) imported.push(plant.id);
      else failed.push(plant.id);
    }

    return { imported, failed };
  }

  return { fetchAll, savePlant, updatePlant, removePlant, importBatch };
}

export type CloudPlantLibrary = ReturnType<typeof createCloudPlantLibrary>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/plantCloud.test.ts`
Expected: PASS, all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/services/plantCloud.ts src/services/plantCloud.test.ts
git commit -m "feat(sync): plantCloud pure network orchestration, injectable + tested"
```

---

## Task 5: `supabasePlantCloud.ts` - real binding

**Files:**
- Create: `src/services/supabasePlantCloud.ts`

- [ ] **Step 1: Implement the binding**

```ts
import { supabase } from './supabase';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud';

/*
 * The one place `plantCloud.ts` is bound to the real Supabase client and
 * Storage - mirrors `plantLibrary.ts` binding `plantStore.ts` to
 * `expo-sqlite`. Kept out of `plantCloud.ts` so upload failure, insert
 * failure, and partial-batch behaviour stay testable under `node --test`
 * without a live project.
 *
 * Signed URLs, not public ones: the bucket is private (see the Epic 3a
 * migration), so every read resolves `photo_path` to a fresh signed URL
 * rather than storing one - a permanent public URL would not even resolve
 * against a private bucket, and a signed URL baked into the row would go
 * stale.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

async function resolvePhotoUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('plant-photos')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

const deps: CloudDeps = {
  async fetchPlants() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return [];

    const { data, error } = await supabase
      .from('plants')
      .select('id, user_id, saved_at, photo_path, diagnosis, last_watered_at, watering_log, reminder_id')
      .eq('user_id', userId)
      .order('saved_at', { ascending: false });
    if (error || !data) return [];

    const rows = data as CloudRow[];
    // Resolve every photo path to a live signed URL before this leaves the
    // binding - plantCloud.ts and everything above it treats `photo_path` as
    // something already directly renderable.
    return Promise.all(
      rows.map(async (row) => ({ ...row, photo_path: await resolvePhotoUrl(row.photo_path) }))
    );
  },

  async uploadPhoto(path, sourceUri) {
    try {
      const response = await fetch(sourceUri);
      const blob = await response.blob();
      const { error } = await supabase.storage
        .from('plant-photos')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (error) return null;
      return path;
    } catch {
      return null;
    }
  },

  async insertPlant(row) {
    const { error } = await supabase.from('plants').insert(row);
    return !error;
  },

  async updatePlant(id, patch) {
    const { error } = await supabase.from('plants').update(patch).eq('id', id);
    return !error;
  },

  async deletePlant(id) {
    const { error } = await supabase.from('plants').delete().eq('id', id);
    return !error;
  },
};

export const supabasePlantCloud = createCloudPlantLibrary(deps);
```

- [ ] **Step 2: Commit**

```bash
git add src/services/supabasePlantCloud.ts
git commit -m "feat(sync): bind plantCloud to the real Supabase client"
```

---

## Task 6: `plantRepo.ts` - the facade

The single entry point every screen uses from here on. Guest-mode behavior is an exact passthrough to `plantLibrary` (zero behavior change, already shipped and verified); logged-in behavior write-throughs to the cloud, mirrors locally, and never applies a write anywhere on failure.

**Files:**
- Create: `src/services/plantRepo.ts`
- Test: `src/services/plantRepo.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlantRepo } from './plantRepo.ts';
import { createPlantStore, type StorageDeps } from './plantStore.ts';
import { createCloudPlantLibrary, type CloudDeps, type CloudRow } from './plantCloud.ts';
import type { PlantDiagnosis } from '../types/index.ts';

const diagnosis: PlantDiagnosis = {
  plantName: 'Mini monstera',
  scientificName: 'Rhaphidophora tetrasperma',
  condition: 'moderate',
  conditionLabel: 'Moderate Stress',
  issues: [],
  treatments: [],
  canBeSaved: true,
  confidence: 50,
  description: '',
};

function memoryStorage(): StorageDeps {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function fakeCloudDeps(fail: { insert?: boolean; upload?: boolean; insertIds?: Set<string> } = {}) {
  const rows = new Map<string, CloudRow>();
  const deps: CloudDeps = {
    fetchPlants: async () => [...rows.values()],
    uploadPhoto: async (path) => (fail.upload ? null : path),
    insertPlant: async (row) => {
      if (fail.insert || fail.insertIds?.has(row.id)) return false;
      rows.set(row.id, row);
      return true;
    },
    updatePlant: async (id, patch) => {
      const existing = rows.get(id);
      if (!existing) return false;
      rows.set(id, { ...existing, ...patch });
      return true;
    },
    deletePlant: async (id) => rows.delete(id),
  };
  return { deps, rows };
}

function makeRepo(
  opts: { hint?: boolean; cloudFail?: { insert?: boolean; upload?: boolean; insertIds?: Set<string> } } = {}
) {
  let hint = opts.hint ?? false;
  const guest = createPlantStore(memoryStorage());
  const mirror = createPlantStore(memoryStorage());
  const { deps, rows } = fakeCloudDeps(opts.cloudFail);
  // Cloud-generated ids only matter for repo.save() (a NEW plant); import
  // preserves each plant's existing local id, so this id-gen never applies
  // to importGuestPlants().
  const cloud = createCloudPlantLibrary(deps, { newId: () => `cloud-${rows.size + 1}` });

  const repo = createPlantRepo({
    guest,
    mirror,
    cloud,
    getSessionHint: () => hint,
    getUserId: () => (hint ? 'u1' : null),
  });
  return { repo, guest, mirror, rows, setHint: (v: boolean) => (hint = v) };
}

test('logged out: save() passes straight through to the guest store', async () => {
  const { repo, guest } = makeRepo({ hint: false });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, true);
  assert.equal(guest.load().plants.length, 1);
});

test('logged in: save() writes to cloud first, then mirrors locally', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, true);
  assert.equal(rows.size, 1);
  assert.equal(mirror.load().plants.length, 1);
});

test('logged in: a cloud write failure applies nowhere, not even the mirror', async () => {
  const { repo, mirror, rows } = makeRepo({ hint: true, cloudFail: { insert: true } });
  const result = await repo.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(result.ok, false);
  assert.equal(rows.size, 0);
  assert.equal(mirror.load().plants.length, 0);
});

test('hasUnimportedGuestPlants() is true only when the guest key has entries', async () => {
  const { repo, guest } = makeRepo({ hint: true });
  assert.equal(repo.hasUnimportedGuestPlants(), false);
  guest.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(repo.hasUnimportedGuestPlants(), true);
});

test('importGuestPlants() clears the guest key only when every plant imports', async () => {
  const { repo, guest, mirror, rows } = makeRepo({ hint: true });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  guest.save({ photoUri: 'b.jpg', diagnosis });

  const result = await repo.importGuestPlants();
  assert.equal(result.failed.length, 0);
  assert.equal(rows.size, 2);
  assert.equal(guest.load().plants.length, 0);
  assert.equal(mirror.load().plants.length, 2);
});

test('importGuestPlants() leaves the guest key untouched on partial failure', async () => {
  // Save to the guest store directly first so the real generated ids are
  // known before the cloud fake is told which one to reject - `makeRepo`'s
  // ids aren't predictable ahead of a save, so this test builds the pieces
  // by hand instead of through the helper.
  const guest = createPlantStore(memoryStorage());
  const mirror = createPlantStore(memoryStorage());
  const first = guest.save({ photoUri: 'a.jpg', diagnosis });
  const second = guest.save({ photoUri: 'b.jpg', diagnosis });
  assert.ok(first.ok && second.ok);
  const secondId = second.ok ? second.plant.id : '';

  const { deps, rows } = fakeCloudDeps({ insertIds: new Set([secondId]) });
  const cloud = createCloudPlantLibrary(deps);
  const repo = createPlantRepo({
    guest,
    mirror,
    cloud,
    getSessionHint: () => true,
    getUserId: () => 'u1',
  });

  const result = await repo.importGuestPlants();
  assert.deepEqual(result.failed, [secondId]);
  assert.equal(rows.size, 1);
  // The guest key is untouched (still both plants) because the batch was
  // not fully successful - a partial import must leave the source data in
  // place so the banner can offer to retry the remainder.
  assert.equal(guest.load().plants.length, 2);
  assert.equal(mirror.load().plants.length, 0);
});

test('wipeMirror() clears the mirror but never the guest key', async () => {
  const { repo, guest, mirror } = makeRepo({ hint: true });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  mirror.save({ photoUri: 'b.jpg', diagnosis });

  repo.wipeMirror();
  assert.equal(mirror.load().plants.length, 0);
  assert.equal(guest.load().plants.length, 1);
});

test('loadLocal() reads the guest key when logged out, the mirror when logged in', () => {
  const { repo, guest, mirror, setHint } = makeRepo({ hint: false });
  guest.save({ photoUri: 'a.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);

  setHint(true);
  assert.equal(repo.loadLocal().plants.length, 0);
  mirror.save({ photoUri: 'b.jpg', diagnosis });
  assert.equal(repo.loadLocal().plants.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/plantRepo.test.ts`
Expected: FAIL - `./plantRepo.ts` does not exist yet

- [ ] **Step 3: Implement `plantRepo.ts`**

```ts
import type { PlantDiagnosis } from '../types';
import type { PlantStore, StoredPlant, LoadResult } from './plantStore';
import type { CloudPlantLibrary, ImportBatchResult } from './plantCloud';

export type RepoResult<T extends Record<string, unknown> = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; reason: 'storage_full' | 'network' | 'not_found' };

export interface RepoDeps {
  guest: PlantStore;
  mirror: PlantStore;
  cloud: CloudPlantLibrary;
  getSessionHint(): boolean;
  getUserId(): string | null;
}

/*
 * The facade every screen uses from Epic 3a on. Logged out: an exact
 * passthrough to `guest` (today's `plantLibrary`), unchanged from before this
 * epic. Logged in: every mutation writes through to `cloud` first and only
 * touches `mirror` if that succeeds - a failed cloud write must not leave the
 * mirror ahead of the account it is supposed to be a cache of.
 */
export function createPlantRepo(deps: RepoDeps) {
  const { guest, mirror, cloud, getSessionHint, getUserId } = deps;

  function loadLocal(): LoadResult {
    return getSessionHint() ? mirror.load() : guest.load();
  }

  async function refreshFromCloud(): Promise<LoadResult> {
    const plants = await cloud.fetchAll();
    mirror.replace(plants);
    return mirror.load();
  }

  async function save(input: { photoUri: string; diagnosis: PlantDiagnosis }): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.save(input);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const userId = getUserId();
    if (!userId) return { ok: false, reason: 'network' };

    const result = await cloud.savePlant(userId, input);
    if (!result.ok) return { ok: false, reason: 'network' };

    mirror.replace([result.plant, ...mirror.load().plants]);
    return { ok: true, plant: result.plant };
  }

  async function markWatered(id: string, at: number): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.markWatered(id, at);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const stamp = new Date(at).toISOString();
    const log = [stamp, ...(current.wateringLog ?? [])];
    const cloudResult = await cloud.updatePlant(id, { lastWateredAt: stamp, reminderId: null, wateringLog: log });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const updated: StoredPlant = { ...current, lastWateredAt: stamp, wateringLog: log };
    delete updated.reminderId;
    mirror.replace(mirror.load().plants.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function update(
    id: string,
    patch: Partial<Pick<StoredPlant, 'reminderId'>>
  ): Promise<RepoResult<{ plant: StoredPlant }>> {
    if (!getSessionHint()) {
      const result = guest.update(id, patch);
      return result.ok ? { ok: true, plant: result.plant } : { ok: false, reason: result.reason };
    }

    const current = mirror.load().plants.find((p) => p.id === id);
    if (!current) return { ok: false, reason: 'not_found' };

    const cloudResult = await cloud.updatePlant(id, { reminderId: patch.reminderId ?? null });
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    const updated: StoredPlant = { ...current, ...patch };
    if ('reminderId' in patch && patch.reminderId === undefined) delete updated.reminderId;
    mirror.replace(mirror.load().plants.map((p) => (p.id === id ? updated : p)));
    return { ok: true, plant: updated };
  }

  async function remove(id: string): Promise<RepoResult> {
    if (!getSessionHint()) {
      const result = guest.remove(id);
      return result.ok ? { ok: true } : { ok: false, reason: result.reason };
    }

    const cloudResult = await cloud.removePlant(id);
    if (!cloudResult.ok) return { ok: false, reason: cloudResult.reason };

    mirror.replace(mirror.load().plants.filter((p) => p.id !== id));
    return { ok: true };
  }

  function hasUnimportedGuestPlants(): boolean {
    const result = guest.load();
    return result.ok && result.plants.length > 0;
  }

  /*
   * One-shot import (spec: "declining leaves local storage untouched"). The
   * guest key is cleared ONLY when every plant imported - a partial batch
   * must leave the source data in place so the banner can offer to retry the
   * remainder, never a silent partial clear.
   */
  async function importGuestPlants(): Promise<ImportBatchResult> {
    const userId = getUserId();
    if (!userId) return { imported: [], failed: [] };

    const guestPlants = guest.load().plants;
    const result = await cloud.importBatch(userId, guestPlants);

    if (result.failed.length === 0) {
      guest.replace([]);
      await refreshFromCloud();
    }
    return result;
  }

  /* Logout: the mirror is a cache of an account that is about to be signed
   * out of, and must not leak into a next login on a shared device. */
  function wipeMirror(): void {
    mirror.replace([]);
  }

  return {
    loadLocal,
    refreshFromCloud,
    save,
    markWatered,
    update,
    remove,
    hasUnimportedGuestPlants,
    importGuestPlants,
    wipeMirror,
  };
}

export type PlantRepo = ReturnType<typeof createPlantRepo>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/plantRepo.test.ts`
Expected: PASS, all 8 tests green

- [ ] **Step 5: Wire the real singleton**

Create `src/services/plantRepoInstance.ts`:

```ts
import { createPlantRepo } from './plantRepo';
import { plantLibrary } from './plantLibrary';
import { cloudMirror } from './cloudMirror';
import { supabasePlantCloud } from './supabasePlantCloud';
import { getSessionHint } from './sessionHint';
import { supabase } from './supabase';

/*
 * `getUserId` reads whatever Supabase currently has cached in memory
 * (`supabase.auth.getSession()` is async, but supabase-js keeps the last
 * resolved session synchronously accessible via `auth.session` internals is
 * NOT public API - so this repo only calls it from paths already inside an
 * `await`, never from a synchronous render path). Screens never call
 * `getUserId` directly; only `plantRepo`'s async methods do, after
 * `getSessionHint()` has already gated on there being a session at all.
 */
let cachedUserId: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  cachedUserId = session?.user.id ?? null;
});

export const plantRepo = createPlantRepo({
  guest: plantLibrary,
  mirror: cloudMirror,
  cloud: supabasePlantCloud,
  getSessionHint,
  getUserId: () => cachedUserId,
});
```

- [ ] **Step 6: Commit**

```bash
git add src/services/plantRepo.ts src/services/plantRepo.test.ts src/services/plantRepoInstance.ts
git commit -m "feat(sync): plantRepo facade - guest passthrough + cloud write-through"
```

---

## Task 7: `useSession` hook

Keeps `sessionHint` (Task 3) in sync with real auth state, and gives screens the `Session | null` they need to decide whether to show the import banner.

**Files:**
- Create: `src/hooks/useSession.ts`

- [ ] **Step 1: Implement it**

```ts
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { setSessionHint } from '../services/sessionHint';

/*
 * Resolves the real session asynchronously (there is no synchronous way to
 * read it - Supabase's persisted session lives behind AsyncStorage) and
 * keeps `sessionHint` (the synchronous flag Home's first paint reads)
 * up to date with every change, including sign-out from another screen and
 * token expiry.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionHint(data.session !== null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionHint(next !== null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return session;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSession.ts
git commit -m "feat(sync): useSession hook keeps sessionHint in sync with auth state"
```

---

## Task 8: `ImportBanner` component

**Files:**
- Create: `src/components/ImportBanner.tsx`

- [ ] **Step 1: Implement it**

```tsx
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';

type Props = {
  count: number;
  onImport: () => Promise<{ imported: string[]; failed: string[] }>;
  onDismiss: () => void;
};

/*
 * Home banner (not a modal - approved during brainstorming): renders above
 * the library, never blocks it. Declining does not persist anywhere, so it
 * reappears next login by design (spec: "declining leaves local storage
 * untouched" - there is deliberately no flag to make it stop asking).
 */
export default function ImportBanner({ count, onImport, onDismiss }: Props) {
  const t = useTheme();
  const s = makeStyles(t);
  const [busy, setBusy] = useState(false);
  const [failedCount, setFailedCount] = useState<number | null>(null);

  const handleImport = async () => {
    setBusy(true);
    try {
      const result = await onImport();
      setFailedCount(result.failed.length);
      if (result.failed.length === 0) onDismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <Ionicons name="cloud-upload-outline" size={20} color={t.color.primary} />
      <View style={s.body}>
        <Text style={s.title}>Import your {count} saved plants?</Text>
        <Text style={s.sub}>
          {failedCount === null
            ? 'They will follow you to any device you log into.'
            : `${count - failedCount} imported, ${failedCount} couldn't - tap to retry.`}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={t.color.primary} />
      ) : (
        <View style={s.actions}>
          <Pressable onPress={handleImport} accessibilityRole="button" accessibilityLabel="Import saved plants" hitSlop={8}>
            <Text style={s.importText}>Import</Text>
          </Pressable>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={8}>
            <Ionicons name="close" size={18} color={t.color.textMuted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.md,
      marginTop: t.space.md,
    },
    body: { flex: 1 },
    title: { ...t.type.bodyStrong, color: t.color.foreground },
    sub: { ...t.type.caption, color: t.color.textSecondary, marginTop: 2 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    importText: { ...t.type.bodyStrong, color: t.color.primary },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ImportBanner.tsx
git commit -m "feat(sync): ImportBanner component"
```

---

## Task 9: Wire `HomeScreen.tsx`

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Swap the library source and add session/import wiring**

Replace the import block (lines 17-25) with:

```ts
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import { plantRepo } from '../services/plantRepoInstance';
import { plantPhotos } from '../services/photos';
import { triageSections } from '../lib/triage';
import { APP_LOGO } from '../brand';
import { FEATURES } from '../content/features';
import { onboarding } from '../services/onboarding';
import { useSession } from '../hooks/useSession';
import PlantCard from '../components/PlantCard';
import ImportBanner from '../components/ImportBanner';
```

Replace the `library`/`profileName` state and focus-effect block (lines 35-60) with:

```ts
  const session = useSession();

  /*
   * Same lazy-initializer requirement as before (D8) - `plantRepo.loadLocal`
   * is still synchronous, it just picks guest vs. mirror key internally via
   * `sessionHint`, which `useSession` above keeps current.
   */
  const [library, setLibrary] = useState(() => plantRepo.loadLocal());
  const [profileName] = useState(() => onboarding.load()?.name);
  const [showImportBanner, setShowImportBanner] = useState(() => plantRepo.hasUnimportedGuestPlants());

  useFocusEffect(
    useCallback(() => {
      setLibrary(plantRepo.loadLocal());
    }, [])
  );

  // Logged-in background refresh (approved: local cache + background
  // refresh, not a loading spinner) - re-fetches from Supabase after the
  // synchronous mirror read above has already painted, and only touches
  // state if the result actually differs in size (a same-size refresh with
  // identical content is not worth a re-render on every focus).
  useEffect(() => {
    if (!session) return;
    plantRepo.refreshFromCloud().then((fresh) => {
      setLibrary((current) => (fresh.plants.length !== current.plants.length ? fresh : current));
    });
  }, [session]);

  useEffect(() => {
    setShowImportBanner(plantRepo.hasUnimportedGuestPlants());
  }, [session]);
```

- [ ] **Step 2: Skip local photo housekeeping while logged in**

Photos for a logged-in user live in Supabase Storage, not the document directory - the existing adopt/sweep effect (lines 77-104 in the original) must not run against the mirror. Guard its top:

```ts
  useEffect(() => {
    if (!library.ok || session) return;
    const plants = library.plants;
    // ... rest of the existing effect body, unchanged
  }, [session]);
```

(Keep the existing dependency array's original emptiness intent by adding `session` explicitly, since the guard now reads it - this effect still only meaningfully runs once per session transition, not on every library change, matching the original "launch-time housekeeping" comment.)

- [ ] **Step 3: Add `guestPlantCount()` to `plantRepo`**

The banner needs the guest library's plant count, which is a separate read from `library` state - `library` is the MIRROR once logged in, not the guest key the banner counts down. In `src/services/plantRepo.ts`, add next to `hasUnimportedGuestPlants`:

```ts
  function guestPlantCount(): number {
    const result = guest.load();
    return result.ok ? result.plants.length : 0;
  }
```

Add it to the returned object and to `plantRepo.test.ts`:

```ts
test('guestPlantCount() reports how many local plants are unimported', () => {
  const { repo, guest } = makeRepo({ hint: true });
  assert.equal(repo.guestPlantCount(), 0);
  guest.save({ photoUri: 'a.jpg', diagnosis });
  guest.save({ photoUri: 'b.jpg', diagnosis });
  assert.equal(repo.guestPlantCount(), 2);
});
```

Run: `node --test src/services/plantRepo.test.ts` - Expected: PASS (9 tests)

- [ ] **Step 4: Render the banner in `HomeScreen.tsx`**

In the returning-user branch's `ListHeaderComponent` (originally lines 149-196), add the banner right after the header `View` and before the `library.ok === false` warning card:

```tsx
              {showImportBanner && (
                <ImportBanner
                  count={plantRepo.guestPlantCount()}
                  onImport={async () => {
                    const result = await plantRepo.importGuestPlants();
                    setLibrary(plantRepo.loadLocal());
                    return result;
                  }}
                  onDismiss={() => setShowImportBanner(false)}
                />
              )}
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors

Run: `node --test`
Expected: all tests pass (existing + new)

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.tsx src/services/plantRepo.ts src/services/plantRepo.test.ts
git commit -m "feat(sync): wire Home to plantRepo - import banner + background refresh"
```

---

## Task 10: Wire `DiagnosisScreen.tsx`

**Files:**
- Modify: `src/screens/DiagnosisScreen.tsx`

- [ ] **Step 1: Swap and add imports**

Find the `plantLibrary` import and replace with both of these - `plantRepo` for account-aware save/remove, `plantLibrary` kept directly for the guest-only local photo repoint below (it has no cloud equivalent: a cloud save already uploaded the photo as part of `plantRepo.save()`), plus `useSession` to distinguish the two paths explicitly rather than inferring it from URI shape:

```ts
import { plantRepo } from '../services/plantRepoInstance';
import { plantLibrary } from '../services/plantLibrary';
import { useSession } from '../hooks/useSession';
```

Inside the component, alongside its other hooks:

```ts
  const session = useSession();
```

- [ ] **Step 2: Make `handleSave` async and handle the `network` reason**

Replace `handleSave` (original lines 148-181):

```ts
  const handleSave = async () => {
    if (saved) return;
    setSaved(true);

    const result = await plantRepo.save({ photoUri: imageUri, diagnosis });
    if (!result.ok) {
      setSaved(false);
      Alert.alert(
        "Couldn't save",
        result.reason === 'network'
          ? "Couldn't reach your account. Check your connection and try again."
          : 'Your device is out of storage space. Free some space and try again.',
        [{ text: 'OK' }]
      );
      return;
    }
    setSavedId(result.plant.id);

    /*
     * Local photo persistence (TODOS item 9) only runs for a GUEST save,
     * unchanged from before this epic. A logged-in save already uploaded the
     * photo to Storage inside `plantRepo.save()` - `plantPhotos.adopt` would
     * be copying a cache file into a document directory nothing local reads
     * anymore, so it is skipped whenever there is a session.
     */
    if (!session) {
      const id = result.plant.id;
      void plantPhotos.adopt(id, imageUri).then((persisted) => {
        if (persisted) plantLibrary.update(id, { photoUri: persisted });
      });
    }
  };
```

- [ ] **Step 3: Make `handleUnsave` async**

Replace `handleUnsave` (original lines 183-192):

```ts
  const handleUnsave = async () => {
    if (!savedId) return;
    const result = await plantRepo.remove(savedId);
    if (!result.ok) return;
    if (!session) plantPhotos.discard(savedId);
    setSaved(false);
    setSavedId(null);
  };
```

(`plantPhotos.discard` is skipped for a logged-in removal - the photo lived in Supabase Storage, not the document directory, and `cloud.removePlant` only deletes the row; the object itself is cleaned up by `delete_own_account()` on account deletion per the Task 2 migration, or is accepted as an orphan on a single-plant delete for 3a - the same "no downscale, no orphan sweep for cloud storage" scope line the design doc drew. Note this as a known gap, not a bug.)

- [ ] **Step 4: Update the `onPress` handlers to tolerate async**

`onPress={saved ? handleUnsave : handleSave}` (original line 206) already works unchanged - React Native's `Pressable` does not care whether its handler returns a promise.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/screens/DiagnosisScreen.tsx
git commit -m "feat(sync): DiagnosisScreen save/unsave route through plantRepo"
```

---

## Task 11: Wire `PlantDetailScreen.tsx`

**Files:**
- Modify: `src/screens/PlantDetailScreen.tsx`

- [ ] **Step 1: Swap imports**

Replace `import { plantLibrary } from '../services/plantLibrary';` with:

```ts
import { plantRepo } from '../services/plantRepoInstance';
```

- [ ] **Step 2: Point the initial sync load at `plantRepo`**

Replace (original lines 58-60):

```ts
  const [plant, setPlant] = useState(() =>
    plantRepo.loadLocal().plants.find((p) => p.id === plantId) ?? null
  );
```

- [ ] **Step 3: Make `handleWater` await the repo and handle `network`**

Replace the body from `const logged = plantLibrary.markWatered(...)` through the alert (original lines 111-119):

```ts
      const logged = await plantRepo.markWatered(plant.id, at);
      if (!logged.ok) {
        Alert.alert(
          "Couldn't record that",
          logged.reason === 'not_found'
            ? 'This plant is no longer saved.'
            : logged.reason === 'network'
              ? "Couldn't reach your account. Check your connection and try again."
              : 'Your device is out of storage space, so the watering was not saved.'
        );
        return;
      }
```

Replace `const stored = plantLibrary.update(plant.id, { reminderId });` (original line 136) with:

```ts
      const stored = await plantRepo.update(plant.id, { reminderId });
```

- [ ] **Step 4: Make the remove confirmation async**

Replace the `onPress` handler inside `confirmRemove`'s destructive action (original lines 149-161):

```ts
        onPress: async () => {
          const result = await plantRepo.remove(plant.id);
          if (!result.ok) {
            Alert.alert(
              "Couldn't remove",
              result.reason === 'network'
                ? "Couldn't reach your account. Check your connection and try again."
                : 'Your device is out of storage space.'
            );
            return;
          }
          plantPhotos.discard(plant.id);
          navigation.goBack();
        },
```

`plantPhotos.discard` here is harmless to call even for a cloud-backed plant (the local document directory never had a file for it, so `discard` is a no-op glob match against nothing) - unlike `DiagnosisScreen`'s `handleUnsave`, there is no separate guest/cloud branch needed here since `discard()` degrades safely.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/screens/PlantDetailScreen.tsx
git commit -m "feat(sync): PlantDetailScreen watering/update/remove route through plantRepo"
```

---

## Task 12: Wire `WateringHistoryScreen.tsx`

**Files:**
- Modify: `src/screens/WateringHistoryScreen.tsx`

- [ ] **Step 1: Swap the sync read**

Replace the `plantLibrary` import with `import { plantRepo } from '../services/plantRepoInstance';` and replace (original line 38):

```ts
  const [plant] = useState(() =>
    plantRepo.loadLocal().plants.find((p) => p.id === plantId) ?? null
  );
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit` - Expected: no errors

```bash
git add src/screens/WateringHistoryScreen.tsx
git commit -m "feat(sync): WateringHistoryScreen reads through plantRepo"
```

---

## Task 13: Wipe the mirror on logout and account deletion

**Files:**
- Modify: `src/services/auth.ts:73-78` (`signOut`)
- Modify: `src/services/auth.ts:118-123` (`deleteAccount`)

- [ ] **Step 1: Add the import**

At the top of `src/services/auth.ts`:

```ts
import { plantRepo } from './plantRepoInstance';
```

- [ ] **Step 2: Wipe on `signOut()`**

```ts
export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new AuthServiceError(error.message);
  // The mirror is a cache of the account being signed out of - it must not
  // leak into a next login on a shared device (spec: "wipe on logout").
  plantRepo.wipeMirror();
}
```

- [ ] **Step 3: Wipe on `deleteAccount()`**

```ts
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) throw new AuthServiceError(error.message);
  await supabase.auth.signOut();
  plantRepo.wipeMirror();
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/services/auth.ts
git commit -m "feat(sync): wipe cloud mirror on sign-out and account deletion"
```

---

## Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 2: Full test suite**

Run: `node --test`
Expected: every test passes, including all pre-existing ones (no regression) plus the new `plantStore`, `plantCloud`, and `plantRepo` tests from this plan

- [ ] **Step 3: Manual device verification (Ron's - synthetic taps don't register in the RN simulator view)**

Hand off this exact numbered script:

1. Fresh install or a device with at least 2 previously-saved local plants, logged out.
2. Log in (or sign up) with an account that has never imported before.
3. Confirm: Home shows the returning-user library layout with the `ImportBanner` reading "Import your 2 saved plants?" above "My Plants".
4. Tap **Import**. Confirm the banner disappears and the same 2 plants are still listed (now cloud-backed - no visible change to the cards themselves).
5. Force-quit and relaunch. Confirm the 2 plants are still there (mirror survived).
6. Diagnose a new plant, tap Save. Confirm it appears in the library immediately.
7. Open Supabase's table editor for `plants` (or `supabase db query --linked "select id, saved_at from plants"`) and confirm 3 rows exist for this account, and `plant-photos` in Storage has 3 objects under `<user_id>/`.
8. Water one plant from `PlantDetailScreen`. Confirm the in-app countdown updates, then check the `plants` row's `last_watered_at` updated too.
9. Remove one plant. Confirm it disappears from Home and its `plants` row is gone.
10. Log out via Settings → Manage Account. Log back in with a **different** account that has never imported. Confirm Home shows that second account's own (empty or different) library, not the first account's plants.
11. Log back into the first account. Confirm its 2 remaining plants are still there (mirror repopulated from cloud, not lost on logout).
12. Turn on Airplane Mode while logged in. Try to save a new diagnosis. Confirm a "couldn't reach your account, check your connection" alert appears and the plant does NOT show up in the library (no false success, no orphaned local write - 3a's explicit online-only boundary). Turn Airplane Mode back off.

- [ ] **Step 4: Report results**

If every step passes, the epic is done and ready for `/ship`. If anything fails, capture which numbered step and the exact behavior observed before touching any code.
