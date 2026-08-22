-- Fix: places.ciphertext / places.nonce must be `text`, not `bytea`.
--
-- 20260820030000_places.sql declared them `bytea`, copied from the shape in
-- 20260610120000_initial_setup.sql. That was wrong: every live encrypted table
-- (entries, habits, habit_logs, entry_media) is `text`, because the client
-- stores base64 (`encryptJson` -> bytesToBase64), not raw bytes.
--
-- The consequence was silent and total: Postgres accepted the base64 STRING
-- into a bytea column as escape-format input, so the ASCII of the base64 got
-- stored, and PostgREST handed it back as "\x<hex>". decryptJson then failed on
-- every read, so saved places wrote successfully and vanished on reload.
--
-- The stored bytes are exactly the UTF-8 of the original base64, so
-- convert_from recovers it losslessly — no data is dropped by this change.

begin;

alter table public.places
  alter column ciphertext type text using convert_from(ciphertext, 'UTF8'),
  alter column nonce type text using convert_from(nonce, 'UTF8');

commit;
