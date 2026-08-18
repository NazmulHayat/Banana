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

/** Identifies the habit whose logs a queued purge must remove (D12). */
export interface HabitRef {
  habitId: string;
}
