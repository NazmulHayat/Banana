-- Username becomes optional (onboarding redesign, 2026-08-23).
--
-- Signup no longer asks for a username: the accounts row is created with only
-- the user id during keyring setup, and a username is claimed later from
-- Profile -> Edit if the user wants one.
--
-- Only the NOT NULL constraint moves. Everything else deliberately stays:
--   * accounts_username_format / accounts_username_lowercase are CHECK
--     constraints, and CHECKs pass on NULL by definition, so a null username
--     needs no change there and a present one is validated exactly as before.
--   * uniq_accounts_username is a unique index; Postgres treats NULLs as
--     distinct, so any number of no-username accounts coexist while real
--     usernames stay unique.
--   * username_available() compares against lower(check_username); NULL rows
--     never match, which is correct — an unclaimed name is available.

begin;

alter table public.accounts alter column username drop not null;

commit;
