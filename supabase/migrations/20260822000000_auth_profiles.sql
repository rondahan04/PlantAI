-- Epic 1 (User Accounts + Settings/Profile) - issue #1
-- profiles table, RLS, atomic profile creation trigger, self-delete RPC.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text,
  bio text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user can only ever see or edit their own row - never anyone else's.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Inserts happen only via the trigger below (security definer), so no
-- client-facing insert policy is needed - and deliberately not added.

-- Atomic profile creation: fires inside the same transaction as signup,
-- so there is no window where an auth.users row exists with no matching
-- profiles row (the two-write client-side approach this replaces could
-- leave that gap on a network drop mid-signup).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', new.id::text),
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Self-delete RPC: the client has no service-role key (D6, client-only),
-- so account deletion can't call the Supabase admin API directly. This
-- function runs as its owner (security definer) but only ever deletes the
-- CALLING user's own auth.users row - auth.uid() is the caller's session,
-- not a client-supplied argument, so there is nothing to spoof.
create function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
  -- profiles row cascade-deletes via the FK above.
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
