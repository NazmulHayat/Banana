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
  /** Where it was written, when location tagging was on. */
  place?: EntryPlace;
  /**
   * Storage object paths inside the `private-media` bucket
   * (format: "<user_id>/<entry_id>/<media_id>.<ext>"). Resolved to signed
   * URLs at render time via lib/media/storage.getImageUrl().
   */
  mediaPaths: string[];
  /**
   * Dimensions for the paths above, when known. Absent on entries written
   * before this existed — those fall back to measuring, so no migration and no
   * re-upload. Matched to `mediaPaths` by `path`, not by index.
   */
  media?: EntryMedia[];
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

/**
 * The `accounts` columns we select — the raw row shape, mapped to `Account`
 * inside lib/db before it goes anywhere near a screen.
 */
export interface AccountRow {
  id: string;
  username: string;
  avatar_path: string | null;
  created_at: string;
}

/**
 * App-facing account DTO (the store surfaces it as `profile`). Plaintext by
 * design: the username is public-facing and `avatarPath` is an opaque Storage
 * object key the server already owns — neither reveals a date, habit or
 * journal line, so neither is encrypted.
 *
 * `created_at` keeps its snake_case name because the store has exposed this
 * exact field on `profile` since v1 and screens read it; renaming it would be
 * a silent break for no gain.
 */
export interface Account {
  id: string;
  username: string;
  /** Storage key "<uid>/avatar/<id>.<ext>" in `private-media`, or null. */
  avatarPath: string | null;
  created_at: string;
}

/**
 * The answer to "can I have this username?" — the live check behind the edit
 * field. `unknown` means we couldn't ask (offline / server error), which the
 * UI must present as "couldn't check", never as "taken".
 */
export type UsernameCheck =
  | { status: "available" }
  | { status: "taken" }
  | { status: "invalid"; reason: string }
  | { status: "unknown" };

// Payloads stored as encrypted JSON in `ciphertext` columns
/**
 * Where an entry was written. A *snapshot*, deliberately: renaming a place
 * later changes what new entries say, never what an old one said. A journal
 * that rewrites its own history is worse than one with a stale label.
 */
/**
 * A stored photo's shape. Written at upload time so a card can lay out its
 * grid without downloading anything: `Image.getSize` fetches the whole file
 * just to read its header, which made every photo arrive twice.
 */
export interface EntryMedia {
  path: string;
  width: number;
  height: number;
}

export interface EntryPlace {
  /** The short label shown on the card — "Haneda Airport", "Home". */
  heading: string;
  /** The fuller address behind it, shown when you tap to edit. */
  address: string;
  /** Rounded before it is ever stored — see PLACE_COORD_PRECISION. */
  latitude: number;
  longitude: number;
}

export interface EntryPayload {
  date: string;
  entries: Array<{
    id: string;
    text: string;
    createdAt: string;
    mediaPaths?: string[];
    media?: EntryMedia[];
    /**
     * Optional place tag. Absent on every entry written before location
     * existed, and absent whenever the setting is off — the entries row is
     * opaque ciphertext, so this needed no SQL migration (same as
     * `HabitPayload.position`).
     */
    place?: EntryPlace;
  }>;
}

/** A place the user has named, so next time it's called what they call it. */
export interface SavedPlace {
  id: string;
  /** What you call it. This is the label an entry gets. */
  heading: string;
  /** The address it was detected at. */
  address: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

export interface PlacePayload {
  id: string;
  heading: string;
  address: string;
  latitude: number;
  longitude: number;
  createdAt: string;
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
