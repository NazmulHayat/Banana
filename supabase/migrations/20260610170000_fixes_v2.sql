-- ============================================================================
-- Banana v2 — Fixes v2: storage cleanup must happen client-side
-- ============================================================================
--
-- Supabase blocks direct DELETE from storage.objects even from SECURITY
-- DEFINER functions ("Direct deletion from storage tables is not allowed").
-- So delete_my_account() can no longer clean up storage itself — the client
-- must list + remove objects via the Storage API BEFORE calling this RPC.
-- See app/(tabs)/profile.tsx handleDeleteAccount for the client-side
-- cleanup pass.
-- ============================================================================

begin;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- All public.* tables CASCADE off auth.users(id); deleting the user removes
  -- accounts, profiles, entries, entry_media, habits, habit_logs in one shot.
  -- Storage cleanup must be done by the client BEFORE calling this RPC.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

commit;
