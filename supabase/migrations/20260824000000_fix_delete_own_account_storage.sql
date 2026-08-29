-- delete_own_account() (20260822010000_epic3_plants_sync.sql) deletes
-- straight from storage.objects to clear a departing user's photo folder.
-- Supabase's storage schema runs a protective trigger that rejects direct
-- writes/deletes against storage.objects from outside the storage_admin
-- role - a security-definer function owned by postgres hits it every time
-- ("Direct deletion from storage tables is not allowed. Use the Storage API
-- instead."), so every call to this RPC has been failing before it ever
-- reaches `delete from auth.users`. Storage cleanup moves to the client via
-- the Storage API (the only path Supabase actually allows); this function
-- goes back to owning just the DB-side deletion it already has authority
-- over.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
  -- profiles and plants rows cascade-delete via their FKs. Photo objects in
  -- the plant-photos bucket are removed by the client, via the Storage API,
  -- before this RPC is called.
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
