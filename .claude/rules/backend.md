# Backend rules — `lib/`, `supabase/`

Scope: the data layer (`lib/db/`), crypto (`lib/crypto/`), state (`lib/data-store.tsx`, `lib/*-context.tsx`), media (`lib/media/`), the Supabase client (`lib/supabase.ts`), and SQL (`supabase/migrations/`).

There is **no application server** — Postgres + RLS + Storage is the entire backend, and from the server's point of view the client is an untrusted holder of ciphertext. Full schema + crypto model: `docs/DATABASE.md`.

## Layering — never cross these lines

```
Screen (app/)  →  data-store.tsx  →  lib/db/*  →  lib/crypto + lib/supabase
```

- `lib/crypto/` is the **only** place that imports `@noble/*` or touches the master key. Nothing else calls `aesEncrypt` / `aesDecrypt` / `scrypt` / `hmac`.
- `lib/db/*` is the **only** place that imports `supabase` for app data. Screens and components never `import { supabase }`.
- `data-store.tsx` owns React state, optimistic updates, and load orchestration. `lib/db/*` is stateless per call except for its module-level caches.
- A new server-data feature gets a `lib/db/<thing>.ts` in the existing file's exact shape, re-exported from `lib/db/index.ts`.

## Crypto

The product is zero-knowledge — treat every shortcut as a breach.

- **AAD is mandatory.** Every `encryptJson` / `decryptJson` / `encryptBytes` / `decryptBytes` passes an `aad` from the `AAD` builders in `lib/crypto/payload.ts`. A new encrypted type means a new `AAD.<type>()` with the `banana:v1:` prefix — never inline an ad-hoc string, never skip AAD.
- **Never rename `banana:*`** (AAD prefixes, `banana_mk_v1`, `banana_*_v2`). They seal existing data. New protocol strings get a new suffix; old ones are immutable.
- **Master-key hygiene** — lives in memory + expo-secure-store only. `zeroize()` on logout/lock. Never log it, never put it in a query, never return it across into `app/`.
- **Guard every data op** with `if (!keyring.isUnlocked())` — reads return `[]` / empty, writes `throw new Error("Encryption is locked")` (see `entries.ts`).
- **Date privacy** — server-visible keys are `day_bucket` / `month_bucket` = HMAC(masterKey, …) via `lib/crypto/buckets.ts`. Never write a real date, habit name, or entry text to a non-ciphertext column.
- **Read decrypt failures are non-fatal** — catch, `if (__DEV__) console.warn`, skip the row, keep going (see `getEntriesForMonth`). One corrupt row must not blank the screen.

## Supabase / queries

- **Query builder only** — `.select('a, b')`, `.eq()`, `.upsert(…, { onConflict })`, `.maybeSingle()`. No string-interpolated filters. RLS already scopes per user, but still pass `.eq('owner_id', userId)` for explicit intent + index use.
- **Select narrowly, map to DTOs** — request only the columns you need and convert rows to app types (`DailyEntry`, `HabitLog`, `ProfileData`) before they leave `lib/db` / the store. Never hand a raw row to a component. Widening a select to "grab everything" is review-blocking.
- **Errors** — writes throw with a useful message: `throw new Error(\`Failed to save entry: ${error.message}\`)`. Reads degrade to empty + a `__DEV__` log. Never swallow a write error — for a journal app, a lost write is the unforgivable bug (tasks.md M1).
- **No N+1** — fetch a month in one query filtered by `month_bucket`, then decrypt the rows. Never one round-trip per day/item; batch a multi-month window with `.in("month_bucket", buckets)` and always bound a read with `.range()` so it can't silently truncate at the PostgREST row cap.
- **Decryption is synchronous CPU on the JS thread.** `decryptJson` → `aesDecrypt` is pure computation, so `Promise.all` buys nothing — the only levers are fewer rows, fewer round trips, or chunked yielding. Measured: ~0.03 ms/row in Node, 3–10× slower on Hermes.
- **Caching is fixed** — in-memory `Map` (sync) → AsyncStorage (`JSON.stringify`, fire-and-forget `.catch(() => {})`) → network. Keys are `userId:YYYY-MM`. Reuse `monthKey` / `storageKey` / `DateFormats`. No parallel cache mechanism.

## SQL / migrations (`supabase/migrations/`)

- **One change = one new file** (`YYYYMMDDHHMMSS_name.sql`). Never edit an applied migration — append. Wrap in `begin; … commit;`.
- **Idempotent always** — `create table if not exists`, `create index if not exists`, `drop policy if exists` before `create policy`, `create or replace function`.
- **Every new table, same migration** — `enable row level security` + owner-only policies (`owner_id = auth.uid()` or `id = auth.uid()`). No table ships without RLS. Index `(owner_id, month_bucket)` / `(owner_id, day_bucket)` for anything queried by bucket.
- **`SECURITY DEFINER` functions** — set `search_path`, `revoke all on function … from public`, then `grant execute … to` the minimal roles (mirror `username_available`). Return the least data possible (a boolean, not a row set).
- **Keep DB validation in sync with the client** — the `accounts_username_format` check ↔ `UsernameRules`. Change one, change both.
- **Storage objects are path-scoped** to `auth.uid()` — keep the `name like auth.uid()::text || '/%'` guard on every storage policy.
