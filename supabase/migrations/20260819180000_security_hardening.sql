-- ============================================================================
-- Aight Bet — security hardening from the Supabase advisor sweep
-- ============================================================================
--
-- Four findings, all raised by `/advisors/security` against the live project.
-- Nothing here changes app behaviour; it narrows surface that was wider than
-- the rules in `.claude/rules/backend.md` allow.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- 1. `set_updated_at` had a mutable search_path (advisor:
--    function_search_path_mutable). It is SECURITY INVOKER so the blast radius
--    is small, but a trigger that fires on every write should not resolve
--    `now()` through a caller-controlled path. `now()` lives in pg_catalog,
--    which is always implicitly searched, so an empty path is sufficient.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- 2. `rls_auto_enable` is the function behind the `ensure_rls` event trigger.
--    Postgres refuses to call an `event_trigger`-returning function directly,
--    so the PUBLIC grant was never exploitable — but it is still a
--    SECURITY DEFINER function listed at /rest/v1/rpc/. Revoke it entirely;
--    the event trigger continues to fire as the function owner.
revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;

-- 3. `delete_my_account` raises 'Not authenticated' when `auth.uid()` is null,
--    so `anon` could never do anything with it. Narrow the grant anyway —
--    the rule is grant narrowly, not grant harmlessly.
revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

--    `username_available` KEEPS its anon grant on purpose: signup checks a
--    username before a session exists. It returns a boolean and nothing else.

-- 4. The `private-media` bucket had no size ceiling and no MIME allow-list, so
--    an authenticated client could park arbitrary bytes of arbitrary type in
--    its own prefix. The uploader only ever produces the four image types in
--    `guessContentType` (lib/media/storage.ts), so pin the bucket to exactly
--    those. 25 MB clears a full-resolution phone HEIC/JPEG with headroom.
update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic']
 where id = 'private-media';

commit;
