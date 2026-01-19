-- Banana: Zero-knowledge E2EE schema (Supabase Postgres)
-- This schema stores ONLY ciphertext. Plaintext lives only on-device.
--
-- Run in Supabase SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS where possible.

begin;

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- Generic updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) profiles: stores wrapped master key + bucket key + KDF metadata (no password stored)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  wrapped_master_key text not null,
  wrapped_master_key_nonce text not null,
  wrapped_bucket_key text,
  wrapped_bucket_key_nonce text,
  kdf_salt text not null,
  kdf_params jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- 1b) accounts: plaintext, unique username for future social features
-- We store username in lowercase to guarantee case-insensitive uniqueness.
create table if not exists public.accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint accounts_username_lowercase check (username = lower(username))
);

create unique index if not exists uniq_accounts_username on public.accounts (username);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
before update on public.accounts
for each row execute procedure public.set_updated_at();

-- 2) entries: one encrypted entry per day_bucket (query by month_bucket)
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  day_bucket text not null,
  month_bucket text not null,
  ciphertext text not null,
  nonce text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entries_one_per_day unique (owner_id, day_bucket)
);

create index if not exists idx_entries_owner_month on public.entries (owner_id, month_bucket);
create index if not exists idx_entries_owner_day on public.entries (owner_id, day_bucket);

drop trigger if exists trg_entries_updated_at on public.entries;
create trigger trg_entries_updated_at
before update on public.entries
for each row execute procedure public.set_updated_at();

-- 3) entry_media: pointers to encrypted blobs in Storage, with encrypted metadata
create table if not exists public.entry_media (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  object_path text not null,
  ciphertext_meta text not null,
  nonce text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entry_media_entry on public.entry_media (entry_id);
create index if not exists idx_entry_media_owner on public.entry_media (owner_id);
create unique index if not exists uniq_entry_media_object_path on public.entry_media (object_path);

drop trigger if exists trg_entry_media_updated_at on public.entry_media;
create trigger trg_entry_media_updated_at
before update on public.entry_media
for each row execute procedure public.set_updated_at();

-- 4) habits: encrypted habit records (names etc.)
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  nonce text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_habits_owner on public.habits (owner_id);

drop trigger if exists trg_habits_updated_at on public.habits;
create trigger trg_habits_updated_at
before update on public.habits
for each row execute procedure public.set_updated_at();

-- 5) habit_logs: encrypted daily completion logs (query by month_bucket)
create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  day_bucket text not null,
  month_bucket text not null,
  ciphertext text not null,
  nonce text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_habit_logs_owner_month on public.habit_logs (owner_id, month_bucket);
create index if not exists idx_habit_logs_owner_day on public.habit_logs (owner_id, day_bucket);

drop trigger if exists trg_habit_logs_updated_at on public.habit_logs;
create trigger trg_habit_logs_updated_at
before update on public.habit_logs
for each row execute procedure public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.entries enable row level security;
alter table public.entry_media enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;

-- Profiles policies
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

-- Accounts policies (username)
drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own"
on public.accounts
for select
using (id = auth.uid());

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own"
on public.accounts
for insert
with check (id = auth.uid());

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own"
on public.accounts
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own"
on public.accounts
for delete
using (id = auth.uid());

-- Entries policies
drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own"
on public.entries
for select
using (owner_id = auth.uid());

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own"
on public.entries
for insert
with check (owner_id = auth.uid());

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own"
on public.entries
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own"
on public.entries
for delete
using (owner_id = auth.uid());

-- Entry media policies
drop policy if exists "entry_media_select_own" on public.entry_media;
create policy "entry_media_select_own"
on public.entry_media
for select
using (owner_id = auth.uid());

drop policy if exists "entry_media_insert_own" on public.entry_media;
create policy "entry_media_insert_own"
on public.entry_media
for insert
with check (owner_id = auth.uid());

drop policy if exists "entry_media_update_own" on public.entry_media;
create policy "entry_media_update_own"
on public.entry_media
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "entry_media_delete_own" on public.entry_media;
create policy "entry_media_delete_own"
on public.entry_media
for delete
using (owner_id = auth.uid());

-- Habits policies
drop policy if exists "habits_select_own" on public.habits;
create policy "habits_select_own"
on public.habits
for select
using (owner_id = auth.uid());

drop policy if exists "habits_insert_own" on public.habits;
create policy "habits_insert_own"
on public.habits
for insert
with check (owner_id = auth.uid());

drop policy if exists "habits_update_own" on public.habits;
create policy "habits_update_own"
on public.habits
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "habits_delete_own" on public.habits;
create policy "habits_delete_own"
on public.habits
for delete
using (owner_id = auth.uid());

-- Habit logs policies
drop policy if exists "habit_logs_select_own" on public.habit_logs;
create policy "habit_logs_select_own"
on public.habit_logs
for select
using (owner_id = auth.uid());

drop policy if exists "habit_logs_insert_own" on public.habit_logs;
create policy "habit_logs_insert_own"
on public.habit_logs
for insert
with check (owner_id = auth.uid());

drop policy if exists "habit_logs_update_own" on public.habit_logs;
create policy "habit_logs_update_own"
on public.habit_logs
for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "habit_logs_delete_own" on public.habit_logs;
create policy "habit_logs_delete_own"
on public.habit_logs
for delete
using (owner_id = auth.uid());

commit;

