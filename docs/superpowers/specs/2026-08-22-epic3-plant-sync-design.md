# Epic 3a - plant library sync to Supabase - design

Date: 2026-08-22. Status: proposed.

TODOS.md line 245 (deferred from #1 during eng review). Blocked on Epic 1
(auth) shipping first - it now has, so this unblocks. Scope note: the
original TODOS line implied a single epic; brainstorming split it into 3a
(this doc: one-shot import + online-only write-through) and a future 3b
(offline write queue + retry). 3a is sized comparably to `plantStore`
(TODOS item 5); 3b is a comparable second build and is explicitly deferred,
not assumed.

## Decision

Accounts stay opt-in (Epic 1's framing holds): nothing in this design runs
for a guest. Once logged in, the account becomes the backing store for the
plant library - not a backup copy sitting alongside local storage. A local
mirror still exists (for D8's synchronous Home read), but it mirrors the
account, it does not compete with it.

Local-only writes while logged in and offline are explicitly out of scope
for 3a: a failed write surfaces a loud, specific error and is not applied
anywhere, local mirror included. No queue, no retry, no optimistic apply
that could silently diverge from the account. That gap is 3b.

## Data model

New migration, same shape as `20260822000000_auth_profiles.sql`:

- `public.plants` - one row per `StoredPlant`, `user_id uuid references
  auth.users(id) on delete cascade`, RLS: select/insert/update/delete all
  scoped to `auth.uid() = user_id`. Columns mirror `StoredPlant`
  (`plantStore.ts`) field-for-field: `id` (client-generated, stays the
  primary key across the local-to-cloud move so photo filenames and nav
  params don't need remapping), `saved_at`, `diagnosis jsonb`,
  `photo_url text`, `last_watered_at`, `watering_log jsonb`,
  `reminder_id text`.
- `plant-photos` Storage bucket, private, RLS policy scoped to
  `auth.uid()` matching the object path's leading folder
  (`<user_id>/<plant_id>.<ext>`) - not the public bucket pattern used for
  nothing else in this app yet.
- No new cascade-delete work needed beyond the FK: `delete_own_account()`
  already deletes `auth.users`, which cascades to `profiles` and now
  `plants`. Storage objects are NOT cascade-deleted by Postgres (they live
  outside the DB) - `delete_own_account()` gains a step to list and remove
  the caller's `plant-photos/<user_id>/*` objects before the user row goes,
  same security-definer/auth.uid()-scoped pattern as the rest of that
  function.

## Facade

`src/services/plantRepo.ts`, new. Same `StorageDeps`-style seam as
`plantStore`/`plantLibrary`, so the switch is injectable and testable
without a real session:

- Logged out: passthrough to today's `plantLibrary` (`plantai.library`
  key). Zero behavior change for guests - this is the existing, already
  shipped and verified path.
- Logged in: reads/writes go to `cloudPlantLibrary.ts` (new), which writes
  through to `plants`/`plant-photos` and mirrors into a **separate** local
  key, `plantai.library.cloud-mirror` - not `plantai.library`, so a
  declined or not-yet-imported guest library is never overwritten or
  confused with account data.
- `HomeScreen`'s lazy `useState(() => ...)` load picks the mirror key when
  a session exists at mount, the guest key otherwise - still synchronous,
  D8 unaffected. A `useEffect` on mount (logged-in only) re-fetches from
  Supabase in the background and updates state if the result differs from
  the mirror, same shape as the existing `useFocusEffect` re-read.

## Import flow

Triggered once per login/signup resolution: facade checks whether
`plantai.library` (guest key, **not** the mirror) has entries. If so, a
dismissible banner renders on Home: "Import your N saved plants?".

- Not blocking - Home renders normally underneath it, matching the
  approved "banner not modal" choice.
- Fires again on every subsequent login until the user acts (import or the
  device stops having unimported local plants) - decline never writes
  anything, so there's no state to make it stop asking. This is a
  deliberate re-ask, not a bug: TODOS' "declining leaves local storage
  untouched" is honored literally.
- Runs even when the account already has cloud plants (multi-device case:
  device B has its own never-imported local plants after device A already
  imported) - the trigger is "does *this device* have unimported local
  plants", never "is the account empty". Imported rows are appended, not
  merged/deduped against existing cloud rows - id collision across devices
  is not expected (ids are generated per-save, no shared counter) and is
  not handled specially if it somehow occurs (insert fails on PK conflict,
  surfaces as a per-plant import failure, see below).

On confirm:

1. For each local plant: upload its photo to
   `plant-photos/<user_id>/<plant_id>.<ext>` (skip upload, store null, if
   the local `photoUri` is already a dead cache reference - same
   tolerance `PlantDetail`/Home already have for dead URIs).
2. Insert the corresponding `plants` row.
3. Only after every plant in the batch succeeds: clear the guest
   `plantai.library` key and populate the mirror from the now-current
   cloud rows.
4. Partial failure (any plant's upload or insert fails): guest storage is
   left completely untouched, no partial clear. The banner reports which
   plants imported and which didn't, and stays available to retry the
   remainder - this mirrors `plantStore`'s existing rule that a library
   never reports success for a write that didn't land.

## Write-through (online only)

Once logged in, every plant mutation (new save, watering log, delete) goes
through `cloudPlantLibrary`: write to Supabase first, read the result back
(same "read back and compare" discipline as `plantStore`), then update the
local mirror to match. If the Supabase write fails for any reason
(offline, RLS, transient error), nothing is applied - not to Supabase, not
to the mirror - and the caller gets a specific, user-facing error
("Couldn't save - check your connection and try again"). This is the
explicit 3a boundary: no queue, no optimistic local apply that could
outrun the account.

## Logout

Wipes `plantai.library.cloud-mirror` entirely. The guest `plantai.library`
key (if this device still has plants that were never imported, e.g. the
user kept declining) is untouched - those remain visible to a guest
session or to a different account logging in afterward, which is the
same "device-scoped, not account-scoped, until imported" model the import
flow already assumes. This prevents one account's plants from leaking into
a next login on a shared device.

## Out of scope for 3a

- Offline write queue / retry (3b).
- Conflict resolution for concurrent multi-device edits - write-through is
  last-write-wins with no merge logic.
- A manual "import" entry point after a user has stopped seeing the
  banner because their device has no unimported local plants left (there
  is no such state reachable without importing, so this is moot for now).
- Photo downscaling before upload - same gap as TODOS item 9's undone
  downscale; a full-res gallery photo already hit `MAX_BODY_BYTES` on the
  diagnose path once, and upload to Storage inherits the same risk.

## Testing

- `plantRepo.ts` and `cloudPlantLibrary.ts` follow the existing
  `StorageDeps` injection pattern - unit tests run under `node --test`
  with a fake Supabase client, no real network or device needed, mirroring
  how `plantStore.test.ts` fakes `expo-sqlite/kv-store`.
- Cases to cover: full import success, partial import failure (guest
  storage untouched), decline (no writes), re-login re-prompts, second
  device merges into an already-populated account, write-through failure
  leaves both Supabase and mirror unchanged, logout wipes mirror but not
  guest key.
- Device verification (manual, per this project's standing rule): actual
  login on a device with pre-existing local plants, confirm banner,
  import, force-quit/relaunch, confirm plants and photos survive and are
  readable from a second simulator logged into the same account.
