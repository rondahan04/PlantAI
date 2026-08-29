-- Portfolio tab fields, carried into the cloud mirror.
--
-- Epic 3a's `plants` table was written when a photograph and a diagnosis were
-- the only way a plant entered the library. The Portfolio tab added a second
-- door - a plant the user already owns, typed in from the shelf - which brings
-- a species record, a growing medium, a nickname, and repot/feed logs, and
-- makes `diagnosis` genuinely absent rather than merely unwritten.
--
-- Written as a separate, idempotent migration rather than an edit to
-- 20260822010000 so it applies cleanly to a project that already ran that one.

alter table public.plants
  add column if not exists added_via text not null default 'scan',
  add column if not exists catalog_id text,
  add column if not exists species jsonb,
  add column if not exists soil_medium text,
  add column if not exists nickname text,
  add column if not exists last_repotted_at timestamptz,
  add column if not exists repot_log jsonb not null default '[]'::jsonb,
  add column if not exists last_fertilized_at timestamptz,
  add column if not exists fertilizer_log jsonb not null default '[]'::jsonb;

-- A hand-added plant has never been diagnosed, and synthesizing an all-clear
-- finding to keep the column required would make an invention indistinguishable
-- from a real one. Same reasoning as `StoredPlant.diagnosis` becoming optional.
alter table public.plants alter column diagnosis drop not null;

-- Mirrors the client's `addedVia` union. A row is one kind or the other; a
-- third value would reach readers that switch on exactly these two.
alter table public.plants drop constraint if exists plants_added_via_check;
alter table public.plants
  add constraint plants_added_via_check check (added_via in ('scan', 'manual'));

-- The client accepts a record carrying a diagnosis or a species and rejects one
-- carrying neither - the identity of the plant is the point of the row.
alter table public.plants drop constraint if exists plants_identity_check;
alter table public.plants
  add constraint plants_identity_check check (diagnosis is not null or species is not null);
