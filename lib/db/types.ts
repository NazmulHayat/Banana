// App-facing types. DB row types live in the per-table modules.

export interface Habit {
  id: string;
  name: string;
  createdAt: string;
}

export interface DailyEntry {
  id: string;
  date: string;
  text: string;
  /**
   * Storage object paths inside the `private-media` bucket
   * (format: "<user_id>/<entry_id>/<media_id>.<ext>"). Resolved to signed
   * URLs at render time via lib/media/storage.getImageUrl().
   */
  mediaPaths: string[];
  createdAt: string;
}

export interface HabitLog {
  habitId: string;
  date: string;
  completed: boolean;
}

/** One calendar month, 1-12. The unit every read is keyed by. */
export interface MonthRef {
  year: number;
  month: number;
}

export interface AccountRow {
  id: string;
  username: string;
  created_at: string;
}

// Payloads stored as encrypted JSON in `ciphertext` columns
export interface EntryPayload {
  date: string;
  entries: Array<{
    id: string;
    text: string;
    createdAt: string;
    mediaPaths?: string[];
  }>;
}

export interface HabitPayload {
  id: string;
  name: string;
  createdAt: string;
  /**
   * Explicit display order, 0-based (D11). Written from the array index by
   * `saveHabits` and read back by `getHabits` so drag-to-reorder survives a
   * reinstall or a second device. Optional on read only: rows written before
   * this field existed decrypt without it, and `getHabits` then falls back to
   * `created_at` ordering (see habits.ts) so no existing list gets scrambled
   * on upgrade. The habits row stores opaque ciphertext, so no SQL migration.
   */
  position?: number;
}

export interface HabitLogPayload {
  habitId: string;
  date: string;
  completed: boolean;
}

// ----------------------------------------------------------------------------
// Write results — the durability contract between the store and the UI
// ----------------------------------------------------------------------------

/**
 * The result of a store write. Store actions NEVER throw — this is the channel:
 * - `synced` — the server accepted the write.
 * - `queued` — the server couldn't be reached; the write is durably queued and
 *   replays on the next flush (NFR-1: no silent data loss).
 * - `failed` — the write can't be made at all right now (e.g. encryption
 *   locked). `reason` is a short, user-safe sentence, never a raw server error.
 */
export type WriteOutcome =
  | { status: "synced" }
  | { status: "queued" }
  | { status: "failed"; reason: string };

/**
 * The result of a `lib/db` READ. Reads used to degrade to `[]` on a
 * server error, which the store then wrote into the in-memory Map AND
 * AsyncStorage — so one failed pull-to-refresh while offline wiped the month
 * off the device and blanked the UI. A read now says which of the two it is:
 *
 * - `ok: true`  — the network answered; `data` is the truth and is safe to
 *   cache, even when it's empty (a genuinely empty month is a real result).
 * - `ok: false` — the read never produced data (offline, server error, locked
 *   keyring). NOTHING may be cached; the caller keeps what it already had.
 *   `reason` is for a `__DEV__` log only, never for the UI.
 *
 * A single row that fails to DECRYPT is a different thing and stays non-fatal:
 * it's skipped with a `__DEV__` warn and the read still reports `ok: true`.
 */
export type ReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

/**
 * Thrown by `lib/db` writes that can never succeed by retrying as-is (locked
 * keyring, no session, undecryptable row). The data store maps these to
 * `{ status: "failed" }` rather than queueing them, so a doomed write can't sit
 * in the retry queue forever. A plain `Error` from a server/network failure is
 * the queueable kind.
 */
export class UnrecoverableWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecoverableWriteError";
  }
}

/** Identifies one entry for a queued delete — no plaintext body needed. */
export interface EntryRef {
  id: string;
  date: string;
}

/**
 * Identifies the habit whose logs a queued purge must remove (D12), plus the
 * day range to sweep. `day_bucket` is HMAC(masterKey, habitlog:<id>:<date>)
 * and therefore forward-computable, so the purge enumerates days instead of
 * downloading and decrypting the user's entire log history to find them.
 * `from`/`to` are local day keys ("YYYY-MM-DD"); both are optional so a purge
 * queued by an older build still replays (the caller supplies a fallback).
 */
export interface HabitRef {
  habitId: string;
  from?: string;
  to?: string;
}
