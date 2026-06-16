-- ============================================================================
-- Banana v2 — Initial schema for zero-knowledge E2E encryption
-- ============================================================================
--
-- Run this once in: Supabase Dashboard → SQL Editor → New query → Paste → Run
--
-- Security model:
--   - Master key generated client-side at signup, never sent to server
--   - Master key wrapped by KEK derived from password via scrypt
--   - Server stores ONLY: wrapped blobs, KDF params, ciphertext
--   - Recovery key: a second wrap of master_key, shown to user once for backup
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Helper: auto-update updated_at column
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- profiles: wrapped keys + KDF metadata (one row per auth.users)
-- ============================================================================
-- Contains EVERYTHING needed for any device to unlock the user's master_key
-- given their password OR their recovery_key. Stored as text (base64 or hex).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  -- Master key wrapped with KEK derived from password
  wrapped_master_key text not null,
  wrapped_master_key_nonce text not null,

  -- KDF parameters used to derive KEK from password
  kdf_salt text not null,
  kdf_params jsonb not null, -- { N, r, p, dkLen }

  -- Master key wrapped with recovery_key (independent path for password recovery)
  wrapped_master_recovery text,
  wrapped_master_recovery_nonce text,

  -- Recovery key encrypted with master_key (so user can view it in Settings later)
  recovery_key_display text,
  recovery_key_display_nonce text,

  -- First N chars of recovery_key for hinting ("starts with ABCD...")
  recovery_key_hint text,
  recovery_key_created_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- accounts: plaintext username (for uniqueness + future social features)
-- ============================================================================
create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_username_format
    check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint accounts_username_lowercase
    check (username = lower(username))
);

create unique index if not exists uniq_accounts_username
  on public.accounts (username);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- entries: one encrypted journal entry per day
-- ============================================================================
-- day_bucket / month_bucket are HMAC(master_key, "day:YYYY-MM-DD" / "month:YYYY-MM")
-- This lets us query by month without leaking actual dates to the server.
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  day_bucket text not null,
  month_bucket text not null,
  ciphertext bytea not null,
  nonce bytea not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_one_per_day unique (owner_id, day_bucket)
);

create index if not exists idx_entries_owner_month
  on public.entries (owner_id, month_bucket);
create index if not exists idx_entries_owner_day
  on public.entries (owner_id, day_bucket);

drop trigger if exists trg_entries_updated_at on public.entries;
create trigger trg_entries_updated_at
  before update on public.entries
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- entry_media: pointers to encrypted image blobs in Storage
-- ============================================================================
-- Image bytes uploaded to Storage are AES-GCM encrypted with a per-media data key.
-- The data key (encrypted with master_key) lives in ciphertext_meta along with
-- any other metadata (caption, dimensions, etc).
create table if not exists public.entry_media (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null,
  ciphertext_meta bytea not null,
  nonce bytea not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entry_media_entry on public.entry_media (entry_id);
create index if not exists idx_entry_media_owner on public.entry_media (owner_id);
create unique index if not exists uniq_entry_media_object_path
  on public.entry_media (object_path);

drop trigger if exists trg_entry_media_updated_at on public.entry_media;
create trigger trg_entry_media_updated_at
  before update on public.entry_media
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- habits: encrypted habit definitions (name etc.)
-- ============================================================================
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ciphertext bytea not null,
  nonce bytea not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_habits_owner on public.habits (owner_id);

drop trigger if exists trg_habits_updated_at on public.habits;
create trigger trg_habits_updated_at
  before update on public.habits
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- habit_logs: encrypted daily completion records
-- ============================================================================
-- habit_id stored encrypted in ciphertext. day_bucket = HMAC(master_key, "habit:<habit_id>:<date>")
-- so server can answer "did user complete habit X on day Y" without knowing X or Y.
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  day_bucket text not null,
  month_bucket text not null,
  ciphertext bytea not null,
  nonce bytea not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint habit_logs_one_per_bucket unique (owner_id, day_bucket)
);

create index if not exists idx_habit_logs_owner_month
  on public.habit_logs (owner_id, month_bucket);
create index if not exists idx_habit_logs_owner_day
  on public.habit_logs (owner_id, day_bucket);

drop trigger if exists trg_habit_logs_updated_at on public.habit_logs;
create trigger trg_habit_logs_updated_at
  before update on public.habit_logs
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.entries enable row level security;
alter table public.entry_media enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;

-- profiles: owner only
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (id = auth.uid());

-- accounts: owner only for read/insert/update/delete
--   (username uniqueness check during signup happens via a permissive read
--    against the unique index; we DO allow public read of just the username
--    column via a separate view if needed later — for now everything is
--    owner-only and signup queries existence by attempted insert.)
drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select using (id = auth.uid());

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts
  for insert with check (id = auth.uid());

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own" on public.accounts
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own" on public.accounts
  for delete using (id = auth.uid());

-- entries
drop policy if exists "entries_all_own" on public.entries;
create policy "entries_all_own" on public.entries
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- entry_media
drop policy if exists "entry_media_all_own" on public.entry_media;
create policy "entry_media_all_own" on public.entry_media
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- habits
drop policy if exists "habits_all_own" on public.habits;
create policy "habits_all_own" on public.habits
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- habit_logs
drop policy if exists "habit_logs_all_own" on public.habit_logs;
create policy "habit_logs_all_own" on public.habit_logs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ============================================================================
-- Username availability check (public RPC)
-- ============================================================================
-- Signup needs to check if a username is taken BEFORE the user has an account.
-- We can't grant blanket SELECT on accounts because that would leak the user list.
-- This SECURITY DEFINER function returns only a boolean.
create or replace function public.username_available(check_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.accounts where username = lower(check_username)
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ============================================================================
-- Storage bucket: private-media
-- ============================================================================
-- Stores AES-GCM encrypted image bytes. Path format:
--   {auth.uid()}/{entry_id}/{media_id}.bin
insert into storage.buckets (id, name, public)
values ('private-media', 'private-media', false)
on conflict (id) do nothing;

drop policy if exists "private_media_select_own" on storage.objects;
create policy "private_media_select_own" on storage.objects
  for select using (
    bucket_id = 'private-media'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

drop policy if exists "private_media_insert_own" on storage.objects;
create policy "private_media_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'private-media'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

drop policy if exists "private_media_update_own" on storage.objects;
create policy "private_media_update_own" on storage.objects
  for update using (
    bucket_id = 'private-media'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  )
  with check (
    bucket_id = 'private-media'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

drop policy if exists "private_media_delete_own" on storage.objects;
create policy "private_media_delete_own" on storage.objects
  for delete using (
    bucket_id = 'private-media'
    and auth.role() = 'authenticated'
    and name like auth.uid()::text || '/%'
  );

commit;

-- ============================================================================
-- Done. Verify with:
--   select tablename from pg_tables where schemaname = 'public';
--   select bucket_id from storage.buckets;
-- ============================================================================
