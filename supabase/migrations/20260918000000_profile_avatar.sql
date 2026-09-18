-- A face for the account: the avatar object, and how it is framed.
--
-- The profile screen has carried a 96pt circle with a "add a person" glyph in
-- it since Epic 1, and nothing behind it. This is what goes in it, and it is
-- now drawn on the dashboard greeting and the portfolio masthead too - so it
-- is worth having, rather than a thing you set once and never see again.
--
-- PRIVATE, like plant-photos and for a better reason. A public bucket would be
-- simpler - no signing, a URL that never expires - and it would also mean a
-- photograph of the user's face readable by anyone holding the link, forever,
-- with no session behind it. Nothing else in this app is public and a face is
-- the last thing that should be the exception. The object path carries the
-- owner's id as its leading folder and RLS checks it against auth.uid(),
-- exactly as the plant photos do.
--
-- Its own bucket rather than a reserved folder inside plant-photos: that
-- bucket is swept wholesale by delete_own_account and by the client's photo
-- housekeeping, both of which reason about "every object under <uid>/ is a
-- plant photo". Slipping something that is not a plant photo in there would
-- make both of those wrong in a way that only shows up as a missing avatar.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatars_select_own"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars_insert_own"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars_update_own"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "avatars_delete_own"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- The object path, not a URL. A signed URL is a short-lived capability and
-- storing one would be a credential with an expiry date sitting in a table;
-- the path is the durable fact, and the client exchanges it for a URL the same
-- way it already does for every plant photo.
alter table public.profiles
  add column if not exists avatar_path text;

-- The same two framing numbers the plants carry, and the same reasoning: a
-- face is rarely centred in the picture it was cropped from, and a circle is
-- the least forgiving frame there is. Relative, so one saved value is correct
-- in a 96pt settings circle, a 36pt greeting avatar and a 28pt masthead at
-- once. The photograph itself is never re-encoded.
alter table public.profiles
  add column if not exists avatar_focus_y real not null default 0.5;

alter table public.profiles
  add column if not exists avatar_zoom real not null default 1;

-- Bounds the client already clamps to. The column should not accept a value no
-- renderer of ours can use: out of range crops to an edge, and zero or
-- negative collapses the image to nothing, on every device at once.
alter table public.profiles drop constraint if exists profiles_avatar_focus_y_check;
alter table public.profiles
  add constraint profiles_avatar_focus_y_check check (avatar_focus_y >= 0 and avatar_focus_y <= 1);

alter table public.profiles drop constraint if exists profiles_avatar_zoom_check;
alter table public.profiles
  add constraint profiles_avatar_zoom_check check (avatar_zoom >= 0.25 and avatar_zoom <= 4);

-- delete_own_account() clears the caller's plant photos because Storage lives
-- outside Postgres's cascade graph. The avatars bucket is outside it for
-- exactly the same reason, and a face left behind after an account deletion is
-- the most pointed version of that bug. Same security-definer, auth.uid()-
-- scoped shape as before: there is no id to spoof, because auth.uid() is the
-- caller's own session rather than a client-supplied argument.
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

  delete from storage.objects
  where bucket_id = 'avatars'
    and (storage.foldername(name))[1] = uid::text;

  delete from auth.users where id = uid;
  -- profiles and plants rows cascade-delete via their FKs.
end;
$$;
