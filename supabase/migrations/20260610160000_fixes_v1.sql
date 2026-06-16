-- ============================================================================
-- Banana v2 — Fixes from production-readiness review.
-- Run after the initial migration.
-- ============================================================================
--
-- WHAT THIS DOES:
--   1. Wipes encrypted rows + converts bytea → text. Required because PostgREST
--      returns bytea as `\x...` hex but our crypto layer writes/expects base64.
--      The wipe is safe — Banana v2 has no real users yet.
--   2. Installs / replaces `delete_my_account()` RPC with storage cleanup.
--   3. Tightens SECURITY DEFINER search_path (security review finding).
--   4. Removes unnecessary delete policies on profiles + accounts (users
--      shouldn't be able to soft-brick themselves by deleting their key blob;
--      delete_my_account() is the only correct path).
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1. Fix column types: bytea → text for ciphertext + nonce on data tables
-- --------------------------------------------------------------------------
truncate table public.entries cascade;
truncate table public.entry_media cascade;
truncate table public.habits cascade;
truncate table public.habit_logs cascade;

alter table public.entries alter column ciphertext type text;
alter table public.entries alter column nonce type text;

alter table public.entry_media alter column ciphertext_meta type text;
alter table public.entry_media alter column nonce type text;

alter table public.habits alter column ciphertext type text;
alter table public.habits alter column nonce type text;

alter table public.habit_logs alter column ciphertext type text;
alter table public.habit_logs alter column nonce type text;

-- --------------------------------------------------------------------------
-- 2. Drop the soft-brick policies. delete_my_account() is the only correct
--    way to remove account data.
-- --------------------------------------------------------------------------
drop policy if exists "profiles_delete_own" on public.profiles;
drop policy if exists "accounts_delete_own" on public.accounts;

-- --------------------------------------------------------------------------
-- 3. Replace delete_my_account with empty search_path + storage cleanup.
-- --------------------------------------------------------------------------
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

  -- Clean up storage objects FIRST (no FK cascade for storage)
  delete from storage.objects
   where bucket_id = 'private-media'
     and name like uid::text || '/%';

  -- All public.* tables CASCADE off auth.users(id); deleting the user removes
  -- accounts, profiles, entries, entry_media, habits, habit_logs in one shot.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- --------------------------------------------------------------------------
-- 4. Also harden the username_available RPC with empty search_path
-- --------------------------------------------------------------------------
create or replace function public.username_available(check_username text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.accounts where username = lower(check_username)
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

commit;

-- Verify with:
--   select column_name, data_type from information_schema.columns
--     where table_schema='public' and column_name in ('ciphertext','nonce');
--   select proname from pg_proc where proname='delete_my_account';
