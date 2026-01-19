-- Banana: Supabase Storage bucket + RLS policies
-- Stores ENCRYPTED photo bytes only. The server cannot decrypt.
--
-- Run in Supabase SQL Editor AFTER creating the bucket in Dashboard
-- (or keep the insert below to create it via SQL).

begin;

-- Create the private bucket (optional; you can also do this in Dashboard)
insert into storage.buckets (id, name, public)
values ('private-media', 'private-media', false)
on conflict (id) do nothing;

-- Users can only access objects under their own prefix:
-- object name format: "<auth.uid()>/<entry_id>/<media_id>.bin"

drop policy if exists "private_media_select_own" on storage.objects;
create policy "private_media_select_own"
on storage.objects
for select
using (
  bucket_id = 'private-media'
  and auth.role() = 'authenticated'
  and name like auth.uid() || '/%'
);

drop policy if exists "private_media_insert_own" on storage.objects;
create policy "private_media_insert_own"
on storage.objects
for insert
with check (
  bucket_id = 'private-media'
  and auth.role() = 'authenticated'
  and name like auth.uid() || '/%'
);

drop policy if exists "private_media_update_own" on storage.objects;
create policy "private_media_update_own"
on storage.objects
for update
using (
  bucket_id = 'private-media'
  and auth.role() = 'authenticated'
  and name like auth.uid() || '/%'
)
with check (
  bucket_id = 'private-media'
  and auth.role() = 'authenticated'
  and name like auth.uid() || '/%'
);

drop policy if exists "private_media_delete_own" on storage.objects;
create policy "private_media_delete_own"
on storage.objects
for delete
using (
  bucket_id = 'private-media'
  and auth.role() = 'authenticated'
  and name like auth.uid() || '/%'
);

commit;

