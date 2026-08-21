-- ============================================================================
-- places: encrypted saved place names (location tagging, FR — Manage/Location)
-- ============================================================================
-- One row per place the user has named. Everything meaningful — the heading,
-- the address and the coordinates — lives inside `ciphertext`; the server sees
-- an owner id, an opaque blob and timestamps, and nothing else. There is
-- deliberately NO coordinate column: an unencrypted lat/long would tell our own
-- admin where the user sleeps, which is exactly the threat model this app is
-- built against.
--
-- Same shape as public.habits (replace-all writes, one AAD for the set).

begin;

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  ciphertext bytea not null,
  nonce bytea not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_places_owner on public.places (owner_id);

drop trigger if exists trg_places_updated_at on public.places;
create trigger trg_places_updated_at
  before update on public.places
  for each row execute procedure public.set_updated_at();

-- RLS ships with the table, never in a later migration.
alter table public.places enable row level security;

drop policy if exists "places_select_own" on public.places;
create policy "places_select_own" on public.places
  for select using (owner_id = auth.uid());

drop policy if exists "places_insert_own" on public.places;
create policy "places_insert_own" on public.places
  for insert with check (owner_id = auth.uid());

drop policy if exists "places_update_own" on public.places;
create policy "places_update_own" on public.places
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "places_delete_own" on public.places;
create policy "places_delete_own" on public.places
  for delete using (owner_id = auth.uid());

commit;
