-- ============================================================================
-- Aight Bet — profile avatar pointer on public.accounts
-- ============================================================================
--
-- Adds `avatar_path`: the Storage object key of the user's profile photo in
-- the private `private-media` bucket, e.g. "<uid>/avatar/<media_id>.jpg".
--
-- Why plaintext (and why that's not a leak):
--   The value is an opaque object key the server already knows — it owns the
--   row in storage.objects. It names no date, habit or journal text, so it
--   carries nothing the server can't already see. Encrypting it would only
--   stop the client from cleaning up the previous object. The image BYTES are
--   still not client-side encrypted in v1 (same disclosure as entry photos).
--
-- RLS: unchanged and already sufficient. `public.accounts` has RLS enabled
-- (initial_setup) with owner-only `accounts_select_own` / `accounts_insert_own`
-- / `accounts_update_own` policies keyed on `id = auth.uid()` (the delete
-- policy was intentionally dropped in fixes_v1 so nobody can self-brick).
-- Policies are row-scoped, not column-scoped, so the new column inherits them
-- exactly — no policy change is needed or wanted here.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.accounts
  add column if not exists avatar_path text;

comment on column public.accounts.avatar_path is
  'Storage object key in the private-media bucket ("<uid>/avatar/<id>.<ext>"), or null. Image bytes are NOT client-side encrypted in v1.';

-- Keep a row from pointing at another user's object. Storage RLS already
-- blocks reading outside `auth.uid()/`, so this is belt-and-braces: it stops a
-- confused client from recording a path it could never resolve.
-- `add constraint if not exists` does not exist in Postgres, so guard on the
-- catalog to stay re-runnable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'accounts_avatar_path_owner_scoped'
       and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_avatar_path_owner_scoped
      check (avatar_path is null or avatar_path like id::text || '/avatar/%');
  end if;
end
$$;

commit;
