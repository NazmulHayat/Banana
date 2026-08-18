// Pending-writes retry queue (NFR-1: no silent data loss).
//
// When a write to Supabase fails (offline, transient network error, server
// hiccup), the CALLER (data-store) enqueues it here instead of dropping it. A
// flush driver later replays each queued write through a caller-supplied
// executor: successes are removed, failures stay queued for the next attempt.
//
// Two invariants make that actually true (bugs D5/D7):
//   1. The executor must NOT re-enqueue on failure — it throws, and the item
//      survives untouched with its original `queuedAt`, so "pending since" is
//      knowable and the queue isn't rewritten on every flush.
//   2. Items coalesce on a stable `key` (one queued write per entry / habit-log
//      / habit list), so hammering a toggle offline queues one item, not N.
//
// This module is intentionally decoupled: a generic, typed AsyncStorage-backed
// queue plus a flush driver. It performs NO crypto, NO Supabase and NO network
// itself — the executor passed into flushPendingWrites() owns the actual retry.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  DailyEntry,
  EntryRef,
  Habit,
  HabitLog,
  HabitRef,
} from "./types";

/**
 * A write that failed and must be retried.
 *
 * - `kind` — which table/shape the payload belongs to.
 * - `op` — `"save"` (upsert the payload) or `"delete"` (remove what it names).
 * - `key` — the coalescing identity: at most one queued item per key, last
 *   write wins (a delete supersedes a pending save for the same key, and vice
 *   versa). Derived by `pendingWriteKey`, never supplied by callers.
 * - `id` — identity of this exact queued *revision*; changes whenever the item
 *   is replaced, so a flush can tell "the thing I just replayed" apart from
 *   "a newer edit queued while I was replaying it".
 * - `queuedAt` — when this key first became unsynced; preserved across
 *   coalescing so age is meaningful (D5).
 */
export type PendingWrite = {
  id: string;
  key: string;
  queuedAt: string;
} & PendingWriteBody;

/** The op/kind/payload half of a queued write — what the caller supplies. */
export type PendingWriteBody =
  | { op?: "save"; kind: "entry"; payload: DailyEntry }
  | { op: "delete"; kind: "entry"; payload: EntryRef }
  | { op?: "save"; kind: "habits"; payload: Habit[] }
  | { op?: "save"; kind: "habitLog"; payload: HabitLog }
  | { op: "delete"; kind: "habitLogs"; payload: HabitRef };

// Storage key namespace. Protocol/storage constant, not branding — renaming it
// orphans every user's queued (and not-yet-retried) writes. Immutable once shipped.
const ASYNC_STORAGE_PREFIX = "banana_pending_writes_v1";

function storageKey(userId: string): string {
  return `${ASYNC_STORAGE_PREFIX}:${userId}`;
}

function genId(): string {
  // Unique enough for a local queue: time + randomness.
  return `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The coalescing identity of a write. Same key ⇒ same target row, so the newer
 * item replaces the older one regardless of `op` (D7).
 */
export function pendingWriteKey(body: PendingWriteBody): string {
  switch (body.kind) {
    case "entry":
      return `entry:${body.payload.id}`;
    case "habits":
      // The habit list is written wholesale (replace-all), so there is exactly
      // one possible pending habits write per user.
      return "habits";
    case "habitLog":
      return `habitLog:${body.payload.habitId}:${body.payload.date}`;
    case "habitLogs":
      return `habitLogs:${body.payload.habitId}`;
  }
}

/**
 * Coerce one stored row into a current-format `PendingWrite`, or `null` if it
 * is unusable. Rows written by the pre-coalescing format have no `op`/`key`:
 * they are migrated in place (`op: "save"` + a derived key) rather than
 * dropped, so a user upgrading mid-queue keeps their unsynced writes.
 */
function migrateRow(raw: unknown): PendingWrite | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const payload = row.payload;
  if (payload === undefined || payload === null) return null;

  const op = row.op === "delete" ? "delete" : "save";
  let body: PendingWriteBody | null = null;

  switch (row.kind) {
    case "entry": {
      const p = payload as { id?: unknown; date?: unknown };
      if (typeof p.id !== "string" || typeof p.date !== "string") break;
      body =
        op === "delete"
          ? { op: "delete", kind: "entry", payload: payload as EntryRef }
          : { op: "save", kind: "entry", payload: payload as DailyEntry };
      break;
    }
    case "habits": {
      if (!Array.isArray(payload)) break;
      body = { op: "save", kind: "habits", payload: payload as Habit[] };
      break;
    }
    case "habitLog": {
      const p = payload as { habitId?: unknown; date?: unknown };
      if (typeof p.habitId !== "string" || typeof p.date !== "string") break;
      body = { op: "save", kind: "habitLog", payload: payload as HabitLog };
      break;
    }
    case "habitLogs": {
      const p = payload as { habitId?: unknown };
      if (typeof p.habitId !== "string") break;
      body = { op: "delete", kind: "habitLogs", payload: payload as HabitRef };
      break;
    }
  }
  if (!body) return null;

  const id = typeof row.id === "string" && row.id ? row.id : genId();
  const queuedAt =
    typeof row.queuedAt === "string" && !Number.isNaN(Date.parse(row.queuedAt))
      ? row.queuedAt
      : new Date().toISOString();
  const key = typeof row.key === "string" && row.key ? row.key : pendingWriteKey(body);

  return { ...body, id, key, queuedAt };
}

/** Drop earlier duplicates of a key (last write wins), preserving first-seen order. */
function coalesce(queue: PendingWrite[]): PendingWrite[] {
  const byKey = new Map<string, PendingWrite>();
  const order: string[] = [];
  for (const item of queue) {
    if (!byKey.has(item.key)) order.push(item.key);
    byKey.set(item.key, item);
  }
  return order.map((k) => byKey.get(k) as PendingWrite);
}

/**
 * Read the queue for a user, migrating/repairing anything odd on disk.
 * Tolerant of missing/corrupt storage — returns `[]` and never throws, so a
 * read can never blank or crash a save path.
 */
async function readQueue(userId: string): Promise<PendingWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      if (__DEV__) console.warn("[pending-writes] Queue not an array, ignoring");
      return [];
    }
    const migrated: PendingWrite[] = [];
    for (const row of parsed) {
      const item = migrateRow(row);
      // An unreadable row is dropped, not fatal: one bad record must not take
      // the rest of the user's queued writes with it. Never log the row (it
      // holds plaintext payloads).
      if (item) migrated.push(item);
      else if (__DEV__) console.warn("[pending-writes] Dropped an unreadable row");
    }
    return coalesce(migrated);
  } catch (e) {
    // Corrupt JSON — degrade to empty so a save path can never crash. Log the
    // error only (never the raw value, which holds plaintext payloads).
    if (__DEV__) console.warn("[pending-writes] Failed to parse queue:", e);
    return [];
  }
}

/** Persist the queue for a user. Throws on failure so writers can react. */
async function writeQueue(userId: string, queue: PendingWrite[]): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(queue));
}

/**
 * Queue a failed write for retry, coalescing on its key (D7).
 *
 * If the key is already queued the existing item is REPLACED in place — same
 * slot in the oldest-first order, same `queuedAt` (the age of the unsynced
 * state), new `id`/op/payload. Last write wins, and a `delete` supersedes a
 * pending `save` for that key exactly as a `save` supersedes a pending delete.
 */
export async function enqueuePendingWrite(
  userId: string,
  body: PendingWriteBody,
): Promise<void> {
  const queue = await readQueue(userId);
  const key = pendingWriteKey(body);
  const at = queue.findIndex((w) => w.key === key);
  const item: PendingWrite = {
    ...body,
    id: genId(),
    key,
    queuedAt: at >= 0 ? queue[at].queuedAt : new Date().toISOString(),
  };
  if (at >= 0) queue[at] = item;
  else queue.push(item);
  await writeQueue(userId, queue);
}

/** All queued writes for a user, oldest first. Never throws. */
export async function getPendingWrites(userId: string): Promise<PendingWrite[]> {
  return readQueue(userId);
}

/** Number of queued writes for a user. Never throws (returns 0 on error). */
export async function pendingWriteCount(userId: string): Promise<number> {
  const queue = await readQueue(userId);
  return queue.length;
}

/** Remove a single queued write by id. No-op if it's already gone. */
export async function removePendingWrite(
  userId: string,
  id: string,
): Promise<void> {
  const queue = await readQueue(userId);
  const next = queue.filter((w) => w.id !== id);
  if (next.length !== queue.length) {
    await writeQueue(userId, next);
  }
}

/** Drop the entire queue for a user (e.g. on logout). Best effort, never throws. */
export async function clearPendingWrites(userId: string): Promise<void> {
  // Fire-and-forget: a stale queue is recoverable, so a storage error here is
  // swallowed rather than thrown out of a logout/cleanup path.
  await AsyncStorage.removeItem(storageKey(userId)).catch(() => {});
}

// One flush at a time per user. Init, an AppState→active transition and a
// manual retry can all fire together; overlapping flushes would replay the same
// writes twice. Callers join the running flush instead (the data store keeps its
// own guard too — this is the backstop for anything that calls in directly).
const flushInFlight = new Map<string, Promise<{ flushed: number; remaining: number }>>();

/**
 * Retry each queued write via `executor`, oldest first and strictly serially.
 * A write whose executor resolves is dropped; one that throws stays queued,
 * untouched, for the next flush. The executor must NOT enqueue on failure —
 * throwing IS how it says "keep this" (D5).
 *
 * Writes queued *during* the flush are preserved: the final persist re-reads
 * the queue and removes only the exact revisions (`id`) that were replayed
 * successfully. Never throws — returns counts.
 */
export async function flushPendingWrites(
  userId: string,
  executor: (item: PendingWrite) => Promise<void>,
): Promise<{ flushed: number; remaining: number }> {
  const running = flushInFlight.get(userId);
  if (running) return running;

  const started = (async () => {
    const queue = await readQueue(userId);
    if (queue.length === 0) return { flushed: 0, remaining: 0 };

    const flushedIds = new Set<string>();
    for (const item of queue) {
      try {
        await executor(item);
        flushedIds.add(item.id);
      } catch {
        // Keep failed writes for the next attempt; no logging of payloads.
      }
    }

    // Re-read so anything queued mid-flush survives, then drop only the exact
    // revisions we replayed (a key edited during the flush has a new id).
    const current = await readQueue(userId);
    const survivors = current.filter((w) => !flushedIds.has(w.id));

    // Persist once. If this fails the next read still sees the old queue (at
    // worst a few already-flushed writes get retried — the persists are
    // idempotent), so we swallow rather than throw out of the driver.
    await writeQueue(userId, survivors).catch(() => {});

    return { flushed: flushedIds.size, remaining: survivors.length };
  })().finally(() => {
    if (flushInFlight.get(userId) === started) flushInFlight.delete(userId);
  });

  flushInFlight.set(userId, started);
  return started;
}
