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
