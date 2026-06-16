-- ============================================================================
-- Banana v2 — Account deletion RPC (Apple App Store requirement)
-- ============================================================================
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Idempotent.
-- ============================================================================

begin;

-- SECURITY DEFINER so the caller can delete their own auth.users row
-- (only own row — we check auth.uid()).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- All public.* tables FK to auth.users(id) with ON DELETE CASCADE,
  -- so deleting the auth.users row removes all data atomically.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

commit;
