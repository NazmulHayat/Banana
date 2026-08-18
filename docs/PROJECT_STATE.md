# PROJECT_STATE.md — Aight Bet

**Read this first.** It is the committed snapshot of *how this codebase works* so a fresh session
never has to re-explore it. It does not decide what to build.

| Question | File |
|---|---|
| What do I build next? | `tasks.md` — **law** (gitignored, local only) |
| What rules must I follow? | `CLAUDE.md` + `.claude/rules/frontend.md` + `.claude/rules/backend.md` |
| Why does the product exist? | `PRODUCT.md` |
| How does the schema / crypto work in detail? | `docs/DATABASE.md`, `docs/FLOW_EXPLANATION.md` |
| **How does the code work today?** | **this file** |

No duplication: rules live in `CLAUDE.md`, priorities live in `tasks.md`, mechanics live here.
When code and this doc disagree, **the code wins** — fix the doc in the same PR.

---

## 1. What this is

**Aight Bet** is a private, zero-knowledge, end-to-end-encrypted **habit tracker + daily journal**
for iPhone. The name is the pitch: *"aight, bet"* — a quiet agreement with yourself.

**The core loop (protect above all):** sign up → pick habits → each day tick habits + write a
highlight → browse the feed.

**Audience:** the private journaler who won't put their inner life in a mineable cloud; the
habit-builder burned out on slot-machine gamification; the reflective doer who thinks habits and
journaling are two halves of one check-in; design-literate younger users.

**Governing principles**
1. **Privacy is the product.** Zero-knowledge is non-negotiable; the threat model includes our own
   DB admin. Nothing plaintext, no key, ever reaches the server.
2. **Calm over engagement.** No dark patterns, no guilt mechanics, no manufactured urgency.
3. **Gamify against your past self, permanently, never punitively.** Streaks punish you for
   stopping; stamps reward you for having done it. **Nothing can ever be lost** — a stamp earned is
   never revoked, a record is beaten or tied but never taken away. (Governs the FR-G* work.)
4. **Tactile and personal.** Warm paper `#fbf8e9`, dot grid, near-black ink `#1A1A1A`, one soft
   orange accent `#FFB380`, ShantellSans handwriting. It's a notebook, not a dashboard.
5. **Honest by default.** Plain language and real disclosures (photos are *not* E2E-encrypted in v1
   and we say so).
6. **Daily, not addictive.** Success = the user opened it on day 3 because they wanted to.

**v1 boundaries (locked)**
- **iPhone only** (`supportsTablet: false`), **light theme only** (`userInterfaceStyle: "light"`).
  No iPad layouts, no Android, no web.
- **Analytics + gamification ship 100% free.** `components/premium-lock.tsx` stays on disk as the
  parked billing seam but wraps nothing.
- **Out of 1.0:** AI features, social/leaderboards/public accountability, data export, per-image
  E2E encryption, multi-device conflict resolution, key rotation, mood tracking, habit
  scheduling/frequency, dark mode.
- **Photos are NOT E2E-encrypted in v1** — private bucket + RLS only, disclosed to users. Do not
  claim otherwise; do not change it without a `tasks.md` item.

---

## 2. Stack + the two laws

Expo SDK 54 · React Native 0.81.5 · **React 19.1 with React Compiler ON** · expo-router v6 (typed
routes) · TypeScript ~5.9 `strict` (`@/*` → repo root) · Supabase (Postgres + RLS + Storage, **no
app server**) · `@noble/ciphers` + `@noble/hashes` · AsyncStorage (cache) + expo-secure-store
(master key) · ShantellSans via `@expo-google-fonts/shantell-sans` · `react-native-svg` (heatmap,
sparkline, wordmark).

**The two laws — full text in `CLAUDE.md`, not repeated here:**
1. `tasks.md` is law. One milestone in flight. Off-milestone ideas go to Nice-to-haves, unbuilt.
2. **Never rename the `banana:*` constants** — see §4.

React Compiler is on: do **not** hand-add `useMemo` / `useCallback` / `React.memo` for performance.
Existing memoization in `lib/data-store.tsx` is intentional and stays.

---

## 3. Architecture map

```
Screen (app/)  →  lib/data-store.tsx  →  lib/db/*  →  lib/crypto/* + lib/supabase.ts  →  Supabase
```

- **Screens** render, wire state, and call the store. They **never** import `supabase` or
  `lib/crypto` directly. *(Documented exceptions: `app/auth/*` and `app/security/*` drive the
  keyring and Supabase Auth directly — that is auth/crypto lifecycle, not app data. `lib/media` is
  called from the composer path.)*
- **`lib/data-store.tsx`** owns all React state, optimistic updates, load orchestration, and the
  pending-writes flush driver.
- **`lib/db/*`** owns persistence, caching, DTO mapping, and every crypto call. It is the only
  place that imports `supabase` for app data. Stateless per call apart from module-level caches.
- **`lib/crypto/*`** is the only place that imports `@noble/*` or touches the master key.
- A new server-data feature gets `lib/db/<thing>.ts` in the exact shape of the existing files,
  re-exported from `lib/db/index.ts`.

### Cache behaviour (as actually implemented)

The intended pattern is **in-memory `Map` (sync) → AsyncStorage (offline) → Supabase (network)**.
What ships today: the memory tier and the AsyncStorage **write** tier work; the AsyncStorage
**read** tier is written but has **no callers** (defect D2), so a cold start with no memory cache
goes straight to the network. Reads short-circuit on cache unless `force: true` (pull-to-refresh).

**In-memory keys** (module-level `Map`s inside `lib/db/*`):

| Cache | Key | Module |
|---|---|---|
| Entries by month | `userId:YYYY-MM` | `lib/db/entries.ts` |
| Entries by day | `userId:YYYY-MM-DD` | `lib/db/entries.ts` |
| Habit logs by month | `userId:YYYY-MM` | `lib/db/habit-logs.ts` |
| Habits | single `{ userId, habits }` slot | `lib/db/habits.ts` |
| Store-level state | `YYYY-MM` (`habitLogs`, `entries`), `YYYY-MM-DD` (`habitLogsByDay`) | `lib/data-store.tsx` |

**Persisted keys** (immutable protocol constants — renaming orphans every user's cache/keys):

| Key | Holds | Store |
|---|---|---|
| `banana_entries_v2:<userId>:<YYYY-MM>` | `DailyEntry[]` for a month | AsyncStorage |
| `banana_habits_v2:<userId>` | `Habit[]` | AsyncStorage |
| `banana_habit_logs_v2:<userId>:<YYYY-MM>` | `HabitLog[]` for a month | AsyncStorage |
| `banana_pending_writes_v1:<userId>` | `PendingWrite[]`, oldest first | AsyncStorage |
| `banana_mk_v1_<userId with dashes stripped>` | base64 master key | expo-secure-store |

AsyncStorage writes are fire-and-forget (`.catch(() => {})`) — a cache miss is recoverable, a
thrown error in a save path is not.

### Durability (NFR-1)

Every `lib/db` write that fails against Supabase enqueues its payload via `enqueuePendingWrite`
instead of throwing it away; the optimistic UI stays correct. `lib/data-store.tsx` flushes the
queue on provider init and on `AppState` → `active`, replaying each item through
`saveEntry` / `saveHabits` / `upsertHabitLog` (all idempotent upserts). `pendingWriteCount` is
exposed on the store for a "will sync" indicator. **Known gaps:** deletes are never queued (D6),
no coalescing (D7), and executors don't throw so failed replays are counted as flushed (D5).

### Backend (`supabase/migrations/`)

Six owner-scoped tables off `auth.users`: `profiles` (wrapped keys + KDF params), `accounts`
(username/email), `entries`, `entry_media`, `habits`, `habit_logs`. Every table has RLS enabled
with owner-only policies (`owner_id = auth.uid()` / `id = auth.uid()`), indexed on
`(owner_id, month_bucket)` and `(owner_id, day_bucket)`. Storage bucket `private-media` is
path-scoped to `auth.uid()`. `SECURITY DEFINER` functions: `username_available(text)`,
`delete_my_account()`, `set_updated_at()` — each sets `search_path`, revokes from `public`, grants
narrowly. One change = one new `YYYYMMDDHHMMSS_name.sql`; never edit an applied migration.

---

## 4. Crypto model

Full detail in `docs/DATABASE.md`. The operating facts:

### AAD is mandatory
Every `encryptJson` / `decryptJson` / `encryptBytes` / `decryptBytes` takes an `aad` built by the
`AAD` object in **`lib/crypto/payload.ts:76-87`**. Without it a hostile server admin could swap
ciphertext between rows (move an entry from one day to another) and the client would accept it.

| Builder | String |
|---|---|
| `AAD.entry(dayBucket, ownerId)` | `banana:v1:entry:<dayBucket>:<ownerId>` |
| `AAD.habit(ownerId)` | `banana:v1:habit:<ownerId>` |
| `AAD.habitLog(dayBucket, ownerId)` | `banana:v1:habitlog:<dayBucket>:<ownerId>` |
| `AAD.wrapMaster(userId)` | `banana:v1:wrap:master:<userId>` |
| `AAD.wrapRecovery(userId)` | `banana:v1:wrap:recovery:<userId>` |
| `AAD.recoveryDisplay(userId)` | `banana:v1:recovery_display:<userId>` |

A new encrypted type means a **new `AAD.<type>()` with the `banana:v1:` prefix** — never an ad-hoc
string, never skipped. No raw `aesEncrypt` outside `lib/crypto/primitives.ts`.

### Date privacy — HMAC buckets (`lib/crypto/buckets.ts`)
The server must be able to query by day/month without learning the date. Each bucket is
`bytesToHex(HMAC-SHA256(masterKey, "<prefix>:<value>")).slice(0, 32)` (16 bytes; a Postgres unique
constraint absorbs the 1-in-2^128 collision risk):

| Function | Prefix : value |
|---|---|
| `dayBucket(mk, "YYYY-MM-DD")` | `day:<date>` |
| `monthBucket(mk, "YYYY-MM")` | `month:<yearMonth>` |
| `habitLogDayBucket(mk, habitId, date)` | `habitlog:<habitId>:<date>` |
| `habitLogMonthBucket(mk, "YYYY-MM")` | `habitlogmonth:<yearMonth>` |

Never write a real date, habit name, or entry text to a non-ciphertext column.

### Keyring lifecycle (`lib/crypto/keyring.ts`, singleton `keyring`)
Master key = 32 random bytes, generated on device, wrapped two independent ways (password-derived
KEK via scrypt, and a 32-byte recovery key), persisted to the server only as ciphertext.

| Method | Does |
|---|---|
| `setupNewUser(userId, password)` → `{ recoveryKey }` | Signup. Refuses to overwrite an existing `profiles` row. Generates master + recovery key, wraps both, writes blobs, caches the key. Caller **must** display the recovery key once. |
| `unlock(userId, password)` | Login. Fetch profile → `deriveKekAsync(password, salt, kdfParams)` → unwrap master → cache. Wrong password throws `"Incorrect password"`. |
| `tryRestoreFromCache(userId)` → `boolean` | App restart. Loads the master key from SecureStore; no password prompt. |
| `unlockWithRecoveryKey(userId, input)` | Forgot-password path (needs an active Supabase session). Normalizes + base32-decodes the key, unwraps master via the recovery blob. |
| `setPassword(userId, newPassword)` | Re-wraps the master key under a new password-derived KEK. |
| `getRecoveryKey(userId)` / `regenerateRecoveryKey(userId)` | Reveal the stored display copy / mint a new recovery key and re-wrap. |
| `lock()` | Logout. Zeroizes memory **and** wipes SecureStore. |
| `isUnlocked()` / `getMasterKey()` / `getUserId()` | Guards. `getMasterKey()` returns a defensive copy and throws when locked. |

Every data op guards with `if (!keyring.isUnlocked())` — **reads return `[]`/empty, writes throw
`"Encryption is locked"`**. Read decrypt failures are **non-fatal**: catch, `if (__DEV__)
console.warn`, skip the row, keep going. One corrupt row must never blank a screen.

### Why `banana:*` is immutable
The AAD prefixes, the SecureStore prefix `banana_mk_v1`, and the AsyncStorage prefixes
`banana_*_v2` / `banana_pending_writes_v1` are **wire/protocol constants, not branding**. Every
existing ciphertext was sealed with its AAD string; changing one byte makes AES-GCM authentication
fail and permanently destroys the user's data. The app brands as "Aight Bet"; the protocol stays
"banana." New protocol strings get a new suffix — old ones never change.

---

## 5. File index

### `app/` — expo-router screens (default exports required)
| File | Owns |
|---|---|
| `app/_layout.tsx` | Root: font loading, `AuthProvider` + `DataProvider` + `OnboardingProvider`, splash, auth/onboarding routing. Holds `DEV_FORCE_INTRO`. |
| `app/(tabs)/_layout.tsx` | Tab bar (blur background, `HapticTab`, `IconSymbol` icons). |
| `app/(tabs)/index.tsx` | **Tracker** (home): today's habit grid, month nav, highlight composer, photo attach. Currently imports `lib/db` + `lib/media` directly (D15) and holds a dead habit modal (D16). |
| `app/(tabs)/feed.tsx` | Month-browsable journal feed; entry edit/delete with `ConfirmDialog`. The reference for going through the store. |
| `app/(tabs)/profile.tsx` | Profile hub: identity, free stats peek (`ProfileStats`), spokes to `/habits` and `/security`, About links + account actions. Holds `PRIVACY_URL` / `TERMS_URL` / `SUPPORT_EMAIL` placeholders. |
| `app/analysis/index.tsx` | All-habits analysis screen — `useRecentHabitLogs` + `AnalysisContent`. |
| `app/analysis/[habitId].tsx` | Per-habit deep dive — same modules scoped to one habit. |
| `app/habits/index.tsx` | Habit management: create / rename / delete / drag-reorder. |
| `app/security/index.tsx` | Security settings: change password, reveal + regenerate recovery key. |
| `app/auth/_layout.tsx` | Auth stack. |
| `app/auth/signup.tsx` | Email + username + password signup; stashes the password in `signupTransient`. |
| `app/auth/verify.tsx` | Email-verification wait/resume; consumes `signupTransient`. |
| `app/auth/recovery-setup.tsx` | Post-signup: create the `accounts` row, run `keyring.setupNewUser`, show the recovery key once, require explicit confirmation. |
| `app/auth/signin.tsx` | Login + `keyring.unlock`. |
| `app/auth/login.tsx` | Landing/marketing screen with `BrandMark`. |
| `app/auth/forgot-password.tsx` | Supabase password-reset email. |
| `app/auth/recover-with-key.tsx` | `keyring.unlockWithRecoveryKey` after a fresh password reset. |
| `app/onboarding/_layout.tsx` · `welcome.tsx` · `habits.tsx` · `feed-demo.tsx` | 3-step first run: welcome animation → pick habits → feed demo. Several uncleared `setTimeout`/`rAF` chains (D19). |

### `components/` — shared components
| File | Exports / owns |
|---|---|
| `habit-grid.tsx` | `HabitGrid` — the month × habit grid, drag-to-reorder, 3-ScrollView header sync. Hard `CELL_WIDTH = 62`. |
| `highlight-input.tsx` | `HighlightInput` — the composer (create + edit mode), photo attach. |
| `feed-entry-card.tsx` | `FeedEntryCard` — one day's entry; images sized via `determineLayout`, per-image loading states. The reference for async-state handling. |
| `profile-stats.tsx` | `ProfileStats` — free stats peek on Profile; fetches its own 12-month log window. |
| `analysis-content.tsx` | `AnalysisContent` — the whole analytics surface (hero band, heatmap + range control, trend sparkline, streak-vs-record, written insight). Shared by both analysis routes. |
| `habit-heatmap.tsx` | `HabitHeatmap` — SVG crosshatch grid over `HeatCell[]`, longest run outlined, per-day tap. |
| `stat-sparkline.tsx` | `StatSparkline` — small SVG line over `number[]`. |
| `day-highlight-sheet.tsx` | `DayHighlightSheet` — habits + journal entries for one tapped day. |
| `premium-lock.tsx` | `PremiumLock` — frosted paywall tease. **Parked billing seam; wraps nothing in v1.** |
| `animated-splash.tsx` | `AnimatedSplash` — launch animation. |
| `handwritten-wordmark.tsx` | `HandwrittenWordmark`, `WORDMARK_TOTAL_MS` — SVG stroke-draw wordmark. |
| `haptic-tab.tsx` | `HapticTab` — tab button with haptic feedback. |

### `components/ui/` — primitives (reuse before writing anything new)
| File | Exports |
|---|---|
| `paper-card.tsx` | `PaperCard` — the surface. Every card. |
| `paper-background.tsx` | `PaperBackground` — paper + dot grid page background. |
| `pressable-scale.tsx` | `PressableScale` — scale-on-press (0.97), single native-driver spring. |
| `icon-button.tsx` | `IconButton` — the icon-only tappable. |
| `icon-symbol.tsx` / `.ios.tsx` | `IconSymbol` — SF Symbols on iOS, MaterialIcons mapping elsewhere. |
| `skeleton.tsx` | `Skeleton` — the loading placeholder. |
| `confirm-dialog.tsx` | `ConfirmDialog` — the one destructive-action confirm pattern (double-submit guarded). |
| `habit-cell.tsx` | `HabitCell` — one grid cell (completed / current-day / size). |
| `image-viewer.tsx` | `ImageViewer` — full-screen image modal. |
| `screen-header.tsx` | `ScreenHeader` — back + title + optional right slot for spoke screens. |
| `settings-row.tsx` | `SettingsRow`, `SectionTitle` — settings list rows. |
| `brand-mark.tsx` | `BrandMark` — logo lockup. |

### `lib/`
| File | Owns / key exports |
|---|---|
| `data-store.tsx` | `DataProvider`, `useDataStore()` — all app state, optimistic updates, priority-based initial load, pending-writes flush driver. |
| `auth-context.tsx` | `AuthProvider`, `useAuth()` — `session`, `user`, `loading`, `keyringReady`, `markKeyringReady`, `signOut`. |
| `onboarding-context.tsx` | `OnboardingProvider`, `useOnboarding()` — first-run selections. |
| `supabase.ts` | `supabase` client, `SUPABASE_URL`, `isSupabaseConfigured()`. Only `EXPO_PUBLIC_*` env vars. |
| `stats.ts` | Pure, deterministic math over decrypted `HabitLog[]` (no React/network/crypto; `today` is always injected). `computeHabitStats`, `computeAllHabitStats`, `computeOverallStats`, `completionRateForMonth`, `monthOverMonthTrend`, `monthlyRateSeries`, `heatmapCells`, `longestStreakRange`, `daysToRecord`, `bestDayOfWeek`, `weekendComparison`, `hadRecentComeback`, `buildInsight`; types `HabitStats`, `OverallStats`, `HeatCell`, `HeatLevel`, `RatePoint`, `TrendResult`, `StreakRange`, `InsightParts`. |
| `use-recent-logs.ts` | `useRecentHabitLogs(monthsBack = 12, refreshToken = 0)` — merges N months of logs from the store via `allSettled`. |
| `layout-algorithm.ts` | `determineLayout`, `LayoutType`, `ImageDimension`, `LayoutDecision` — feed image layout math. |
| `auth/signup-transient.ts` | `signupTransient` — in-memory password bridge between signup and verify; self-clears after consumption or 10 minutes. Never persisted. |
| `media/storage.ts` (+ `media/index.ts`) | `uploadImage`, `getImageUrl` (signed URLs, cached), `deleteImage`, `clearMediaCache`, `clearUserMedia`. Bucket `private-media`, path `<userId>/<entryId>/<mediaId>.<ext>`. Bytes are **not** E2E-encrypted in v1. |

### `lib/crypto/`
| File | Owns / key exports |
|---|---|
| `index.ts` | Public surface: `keyring`, `AAD`, `encryptJson`/`decryptJson`/`encryptBytes`/`decryptBytes`, `EncryptedBlob`, the four bucket functions, `formatRecoveryKey`, `normalizeRecoveryKey`. |
| `keyring.ts` | The `Keyring` singleton — master-key lifecycle + wrap/unwrap against `profiles` (see §4). |
| `payload.ts` | JSON/bytes encrypt+decrypt with mandatory AAD; the six `AAD.*` builders. |
| `buckets.ts` | HMAC day/month bucket derivation. |
| `primitives.ts` | The only `@noble/*` importer: `aesEncrypt`, `aesEncryptWithNonce`, `aesDecrypt`, `hmacSha256`, `deriveKek`, `deriveKekAsync`, `randomBytes`, `generateNonce`/`Salt`/`MasterKey`, `KEY_LENGTH`, `NONCE_LENGTH`, `SALT_LENGTH`, `DEFAULT_KDF_PARAMS`, `KdfParams`. |
| `encoding.ts` | base64 / hex / base32 (`bytesToBase64`, `base64ToBytes`, `bytesToHex`, `bytesToBase32`, `base32ToBytes`) + `formatRecoveryKey` / `normalizeRecoveryKey`. |
| `cache.ts` | `cacheMasterKey`, `loadCachedMasterKey`, `clearCachedMasterKey` — SecureStore, key `banana_mk_v1_<userId no dashes>`. |

### `lib/db/`
| File | Owns / key exports |
|---|---|
| `index.ts` | The single re-export barrel — import `@/lib/db`, never a submodule, from outside the layer. |
| `types.ts` | App DTOs + encrypted payload shapes (see §6). |
| `schema.ts` | `Tables`, `*Columns`, `UsernameRules` (mirrors the DB check constraint), `HabitLimits`, `DateFormats`, `SCHEMA_VERSION`. |
| `entries.ts` | Journal entries, one encrypted row per day (multiple highlights merged into one payload). `saveEntry`, `deleteEntry`, `getEntriesForDate`, `getEntriesForMonth`, `prefetchEntriesForMonth`, `getCachedEntriesForMonth`, `setCachedEntriesForMonth`, `upsertEntryInCache`, `loadEntriesForMonthFromStorage`, `clearEntriesCache`. |
| `habits.ts` | Habits, one encrypted row each, **replace-all save semantics** (delete-all + insert). `saveHabits`, `getHabits`, `getCachedHabits`, `setCachedHabits`, `loadHabitsFromStorage`, `clearHabitsCache`. |
| `habit-logs.ts` | One encrypted row per (habit, day). `toggleHabitLog`, `upsertHabitLog` (idempotent — sets, never toggles), `getHabitLogsForMonth` (alias `getHabitLogsForMonthDirect`), cache getters/setters, `loadHabitLogsFromStorage`, `clearHabitLogsCache`. |
| `pending-writes.ts` | The durable retry queue (NFR-1). Generic + decoupled: no crypto, no Supabase, no network. `enqueuePendingWrite`, `getPendingWrites`, `pendingWriteCount`, `removePendingWrite`, `clearPendingWrites`, `flushPendingWrites(userId, executor)`, type `PendingWrite`. |

### `constants/` — the only source of design tokens
| File | Exports |
|---|---|
| `theme.ts` | `Colors` (`paper #fbf8e9`, `dotGrid #A8C4C4`, `ink #1A1A1A`, `card #FFFFFF`, `shadow #E0DDD8`, `accent #FFB380`, `completed`, `textSecondary #4A4A4A`, `border`, `danger #C62828`, `success #2E7D32`) and `Fonts` (`handwriting`, `handwritingMedium` = `ShantellSans_500`, `handwritingSemiBold` = `ShantellSans_600`). |
| `motion.ts` | `Motion`: `fast` 150, `base` 250, `slow` 350, `spring {15,180}`, `springBouncy {12,220}`, `stagger` 40, `staggerCap` 8. |
| `wordmark-paths.ts` | `WORDMARK_LETTERS`, `WORDMARK_W`, `WORDMARK_H`, `WordmarkLetter` — SVG path data for the handwritten wordmark. |

### `hooks/`, `tests/`, `supabase/`, `docs/`
| File | Owns |
|---|---|
| `hooks/use-color-scheme.ts` / `.web.ts` | `useColorScheme` re-export (app is light-only in v1). |
| `tests/helpers.ts` | The harness: `suite`, `test`, `only`, `assertEq`, `assertBytesEq`, `assertThrows`, `assertRejects`, `assertTrue`, `run`, `bench`. |
| `tests/setup.ts` | Node polyfills — `globalThis.crypto`, `__DEV__ = false`. Imported first by every suite. |
| `tests/crypto.test.ts` | Encoding, AES-GCM + AAD, KDF, buckets, recovery-key format. Offline. |
| `tests/stats.test.ts` | The pure stats engine, including strict date validation. Offline. |
| `tests/pending-writes.test.ts` | The retry queue against an in-memory AsyncStorage mock. Offline. |
| `tests/e2e.test.ts` | Live integration vs the real Supabase project with disposable users. Needs credentials. |
| `tests/benchmark.test.ts` | Crypto perf numbers (Node; scale ~0.5–0.7× for new iPhones). |
| `supabase/migrations/20260610120000_initial_setup.sql` | All six tables, indexes, RLS policies, `username_available`, `set_updated_at`, `private-media` storage policies. |
| `supabase/migrations/20260610130000_account_deletion.sql` | `delete_my_account()`. |
| `supabase/migrations/20260610160000_fixes_v1.sql` · `..._170000_fixes_v2.sql` | Hardening of `delete_my_account` + `username_available`. |
| `docs/DATABASE.md` | Authoritative schema + crypto reference. |
| `docs/FLOW_EXPLANATION.md` | End-to-end data/crypto walkthrough. |
| `docs/privacy-policy.md` | The policy text (needs a public URL / in-app screen). |
| `docs/parallel-builds.md` | Worktree-based parallel agent workflow. |

---

## 6. Data contracts

```ts
// lib/db/types.ts — app-facing DTOs
interface Habit {
  id: string;
  name: string;             // max HabitLimits.MAX_NAME_LENGTH (20)
  createdAt: string;        // ISO
  // position?: number;     // planned (D11): explicit order; falls back to created_at when absent
}

interface DailyEntry {
  id: string;
  date: string;             // "YYYY-MM-DD"
  text: string;
  mediaPaths: string[];     // "<userId>/<entryId>/<mediaId>.<ext>" in `private-media`;
                            // resolved to signed URLs at render via media/getImageUrl()
  createdAt: string;        // ISO
}

interface HabitLog {
  habitId: string;
  date: string;             // "YYYY-MM-DD"
  completed: boolean;
}

interface AccountRow { id: string; username: string; created_at: string; }

// Encrypted payload shapes (what actually goes inside `ciphertext`)
interface EntryPayload {
  date: string;
  entries: Array<{ id: string; text: string; createdAt: string; mediaPaths?: string[] }>;
}
interface HabitPayload { id: string; name: string; createdAt: string; }
interface HabitLogPayload { habitId: string; date: string; completed: boolean; }

// lib/db/pending-writes.ts — the durable queue item (discriminated by `kind`)
type PendingWrite =
  | { id: string; kind: "entry";    payload: DailyEntry; queuedAt: string }
  | { id: string; kind: "habits";   payload: Habit[];    queuedAt: string }
  | { id: string; kind: "habitLog"; payload: HabitLog;   queuedAt: string };
  // planned (D6/D7): `op: "save" | "delete"` + a stable `key` for coalescing

// lib/data-store.tsx — mapped from the `accounts` table, NOT the encrypted profiles row
interface ProfileData { id: string; username: string | null; created_at: string; }
```

### `useDataStore()` surface

**State**

```ts
habits: Habit[];  habitsLoading: boolean;  habitsReady: boolean;
habitLogs: Map<string /* YYYY-MM */, HabitLog[]>;
habitLogsByDay: Map<string /* YYYY-MM-DD */, HabitLog[]>;
habitLogsLoading: boolean; habitLogsReady: boolean; habitLogsProgress: number; // 0..1
entries: Map<string /* YYYY-MM */, DailyEntry[]>;
entriesLoading: boolean; entriesReady: boolean;
profile: ProfileData | null; profileLoading: boolean; profileReady: boolean;
initialLoadComplete: boolean;
pendingWriteCount: number;   // queued failed writes (NFR-1)
```

**Actions** — durable outcome in the comment:

```ts
refreshHabits(opts?: { force?: boolean }): Promise<Habit[]>;                   // cache unless force
refreshHabitLogs(year, month, opts?: { force?: boolean }): Promise<HabitLog[]>;
refreshEntries(year, month, opts?: { force?: boolean }): Promise<DailyEntry[]>;
refreshProfile(): Promise<void>;                                              // accounts row → ProfileData

getLogsForMonth(year, month): HabitLog[];                                     // sync read of store state
getEntriesForMonth(year, month): DailyEntry[];                                // sync read of store state

updateHabits(habits: Habit[]): void;    // optimistic local + persist via saveHabits (replace-all)
updateHabitLog(log: HabitLog): void;    // optimistic local + persist via upsertHabitLog (idempotent)
updateEntry(entry: DailyEntry): void;   // optimistic local only
saveEntry(entry: DailyEntry): Promise<void>;   // persists; queues on failure, never throws it away
deleteEntry(entry: DailyEntry): Promise<void>; // removes row/entry + syncs caches (not yet queued — D6)

clearAll(): void;                       // logout: drop state + pending queue
```

Screens read `*Loading` / `*Ready` to pick loading vs loaded vs empty. Optimistic update first,
then persist — always in that order.

---

## 7. Conventions

- **Commits** are prefixed with the `tasks.md` requirement ID: `FR-H4: drag-to-reorder habits`,
  `NFR-1: durable pending-writes retry queue`, `FR-P2/FR-P1: real habit stats on profile`.
  Housekeeping uses `chore:`. Keep the subject one line; bullets in the body.
- **PRs, never direct merges.** Branch per slice, open a PR, CodeRabbit reviews, **the user
  merges.** Never merge, rebase, or push to `main` yourself.
- **The gate — nothing is "done" until both are clean:**
  ```bash
  npm run lint
  npx tsc --noEmit
  ```
  Touching `lib/crypto/` or `lib/db/` also requires `npx tsx tests/crypto.test.ts` green.
- **Design tokens only.** No hex literal, font string, or duration in a component — `Colors`,
  `Fonts`, `Motion` from `constants/`. (One tolerated exception: the low-alpha
  `rgba(26,26,26,α)` hairline borders already in use — being tokenized.) For bold text set
  `fontFamily: Fonts.handwritingSemiBold`; iOS can't synthesize weight for custom fonts.
- **Reuse before you write.** `PaperCard`, `PressableScale`, `IconButton`, `Skeleton`,
  `ConfirmDialog`, `ImageViewer`, `DateFormats`. Extending a primitive beats forking it.
- **No new dependencies** without a clear, stated reason — the stack is complete for v1. The only
  authorized addition is `expo-notifications` for FR-N1.
- **No `any`.** No non-null `!` on crypto/session values — branch instead.
- **Never log** keys, tokens, ciphertext, or payloads. Debug logs go behind `if (__DEV__)`, and
  even then never carry secret material.
- **Tests use a custom tsx harness, not Jest.** Each file imports `./setup` first, registers with
  `suite()` / `test()`, and self-invokes:
  ```ts
  import "./setup";
  import { assertEq, run, suite, test } from "./helpers";

  suite("thing");
  test("does the thing", () => { assertEq(fn(1), 2); });

  run();          // top-level, self-invoking — `npx tsx tests/<file>.test.ts` runs it
  ```
  `run()` exits non-zero on any failure. Pure logic (`lib/stats.ts`, `lib/crypto/*`,
  `pending-writes`) is testable headless; anything React/native is not.

---

## 8. Status board

Baseline measured at commit `a9d4360` (`chore/v1-baseline`):
`npx tsc --noEmit` **clean** · `npm run lint` **16 errors** (all `react/no-unescaped-entities`) +
**13 warnings** (7 `no-unused-vars`, 6 `exhaustive-deps`) · `crypto` 30/30 · `stats` 26/26 ·
`pending-writes` 12/12 · `e2e` not yet run.

**Built and shipping:** auth + recovery key · E2E entries/habits/habit-logs · habit grid ·
create/rename/delete/reorder habits · highlights with photos · month feed · edit/delete entry ·
stats engine + profile stats · analytics surface (heatmap, trend sparkline, streak-vs-record,
written insight, per-habit deep dive, day sheet) · pending-writes queue + flush · onboarding ·
change password · account deletion RPC.

**Known defects.** All **open** unless noted. **PR 0 (`chore/v1-baseline`) housekeeping is in
flight**: the working tree is checkpointed, lint is being driven to zero, dead code removed, config
locked to iPhone/light, `PremiumLock` unwrapped, and this doc + the `tasks.md` / `PRODUCT.md`
amendments written. D16 and D20 are addressed inside that PR.

| # | Defect | Where | Status |
|---|---|---|---|
| D1 | Day keys built in **UTC** in some places, **local** in others — they disagree nightly | `lib/db/schema.ts:108` + `app/(tabs)/index.tsx:164,202,242` (UTC) vs `components/habit-grid.tsx:60,215` (local) | open |
| D2 | AsyncStorage read tier is **dead** — `loadEntriesForMonthFromStorage`, `loadHabitsFromStorage`, `loadHabitLogsFromStorage` have **zero callers**. Offline reads fall through to network. | `lib/db/entries.ts:94`, `habits.ts:34`, `habit-logs.ts:59` | open |
| D3 | Empty-but-loaded is treated as not-loaded — cache short-circuits require `cached.length > 0`, so an empty month refetches forever | `lib/data-store.tsx:189,227,290` | open |
| D4 | No in-flight dedupe on `refreshHabits`/`refreshHabitLogs`/`refreshEntries`/`flushQueue` | `lib/data-store.tsx` | open |
| D5 | Queue replay: db executors never throw, so a failed replay is counted flushed, removed, and re-appended with a new id + reset `queuedAt` | `lib/db/entries.ts:211`, `habits.ts:77,108`, `habit-logs.ts:163`; driver `lib/data-store.tsx:502-522` | open |
| D6 | **Deletes are never queued** — `deleteEntry` swallows the Supabase error entirely | `lib/db/entries.ts:222-267` | open |
| D7 | No coalescing — N toggles of one habit-log queue N items | `lib/db/pending-writes.ts:78` | open |
| D8 | Photo upload has **no rollback**; `deleteImage` has zero call sites, so failed saves orphan objects | `app/(tabs)/index.tsx:250-266`, `lib/media/storage.ts:100` | open |
| D9 | `clearUserMedia` doesn't paginate — two flat `list()` calls capped at `limit: 1000` | `lib/media/storage.ts:117-141` | open |
| D10 | Account deletion proceeds even if media cleanup fails; local caches + queue + SecureStore not cleared on success | `app/(tabs)/profile.tsx:116-133` | open |
| D11 | Habits have **no `position`** — order is implicit via row `created_at` | `lib/db/types.ts:45-49`, `habits.ts:89,147` | open |
| D12 | Habit deletion (via replace-all `saveHabits`) leaves orphaned `habit_logs` | `lib/db/habits.ts:61` | open |
| D13 | Stats ignore `Habit.createdAt`; future-dated logs inflate `totalCompletions`/`longestStreak`/`activeDays` | `lib/stats.ts:105,113,127-132` | open |
| D14 | Future dates are tappable — no date guard anywhere | `components/habit-grid.tsx:214`, `components/ui/habit-cell.tsx:14`, `app/(tabs)/index.tsx:210` | open |
| D15 | Tracker bypasses the store — imports `lib/db` + `lib/media` directly (layer violation) | `app/(tabs)/index.tsx:10-23,226,285,384` | open |
| D16 | Tracker habit modal is **unreachable dead code** (~100 lines + 4 handlers + 4 state vars) | `app/(tabs)/index.tsx:587-691` | open — in PR 0 |
| D17 | **Zero** accessibility props in the entire app; 14 icon-only touchables | app-wide | open |
| D18 | 3 `ConfirmDialog` vs 70 `Alert.alert`; habit-delete regressed to a native alert | `app/habits/index.tsx:78` | open |
| D19 | Onboarding runs ~5 `setTimeout`/`rAF` chains, **none cleared on unmount** | `app/onboarding/habits.tsx:121-205`, `feed-demo.tsx:62` | open |
| D20 | Ship-blocking config: `supportsTablet: true`, `userInterfaceStyle: "automatic"`, `DEV_FORCE_INTRO = __DEV__ && true` | `app.json:9,11`, `app/_layout.tsx:41` | open — in PR 0 |

Line numbers are from `a9d4360` and drift as the fixes land — treat them as pointers, not
addresses. **What gets fixed in which order is decided by `tasks.md`, not by this table.**

---

## 9. How to run and verify

```bash
# Dev
npm start              # Metro dev server, then press i / a / w
npm run ios            # iOS simulator directly
npm run android        # Android (not a v1 target)
npm run web            # web (not a v1 target)

# The gate — BOTH must be clean before anything is "done"
npm run lint           # expo lint
npx tsc --noEmit

# Offline test suites (custom tsx harness, no Jest; each self-invokes run())
npx tsx tests/crypto.test.ts          # encoding, AES-GCM + AAD, KDF, buckets, recovery keys
npx tsx tests/stats.test.ts           # the pure stats engine
npx tsx tests/pending-writes.test.ts  # the durable retry queue (in-memory AsyncStorage mock)

# Integration + perf
npx tsx tests/e2e.test.ts             # live Supabase; creates and cleans up disposable users
npx tsx tests/benchmark.test.ts       # crypto perf numbers

# Dependency hygiene (stay on SDK 54)
npx expo install --check
```

**Environment.** `.env` holds the public client vars only — `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (the anon key is public by design; RLS is the boundary).

**`tests/e2e.test.ts` prerequisite:** it needs `SUPABASE_SERVICE_ROLE_KEY` in **`.env.local`**
(gitignored via `.env*.local`) to create and tear down its disposable users. The service-role key
must **never** appear in app code, in `.env`, or in any commit. Without it, run the three offline
suites — they cover all pure logic.

**Manual verification that actually catches the bugs in §8:**
- **Dates (D1):** set the simulator to Tokyo, then Los Angeles; toggle a habit either side of local
  midnight and confirm the grid cell and the saved entry land on the *same* day.
- **Durability (D5–D8):** airplane mode → save an entry → force-quit → relaunch → reconnect →
  exactly one synced row and an empty queue. Repeat with a delete. Fail an upload mid-way and
  confirm no orphaned Storage objects.
- **Grid (D14):** 0, 1, 2, 3, 4, 8, 12 habits on the smallest and largest iPhone; tap a future
  date; try very long habit names.
- **Accounts (D9, D10):** delete an account seeded with >1000 media objects; confirm backend rows,
  Storage objects, AsyncStorage caches, the pending queue, and SecureStore are all cleared.
- **Analytics (D13):** a habit created mid-month, a deleted habit, a leap year, an empty month.
- **A11y (D17):** VoiceOver sweep, largest Dynamic Type, reduced motion.

**Definition of done for the v1 hardening effort:** lint + tsc clean; all offline suites and e2e
green; no path can silently discard a draft, completion, photo, queued op, or delete; account
deletion is complete and atomic; and this file matches shipped behaviour.
