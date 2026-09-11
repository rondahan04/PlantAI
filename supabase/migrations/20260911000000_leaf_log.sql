-- New-growth tracking, carried into the cloud mirror.
--
-- A leaf is not a fourth care log. Water, repot and feed are repeatable
-- instants and live as arrays of timestamps; a leaf is an entity with two ends
-- - the day it showed and the day it finished opening - and several can be open
-- at once, so the pairing has to survive the round trip. Hence an array of
-- objects, `[{ "id", "emergedAt", "maturedAt"? }]`, mirroring `LeafEvent` in
-- src/lib/leaves.ts.
--
-- Idempotent and additive, like the portfolio migration before it: existing
-- rows default to an empty array and no client build is required to read them.

alter table public.plants
  add column if not exists leaf_log jsonb not null default '[]'::jsonb;

-- An object array, not a scalar or a bag. The client normalizes what it reads
-- (a damaged entry is dropped rather than rendered as `Invalid Date`), but the
-- column should not accept a shape no writer of ours produces.
alter table public.plants drop constraint if exists plants_leaf_log_check;
alter table public.plants
  add constraint plants_leaf_log_check check (jsonb_typeof(leaf_log) = 'array');
