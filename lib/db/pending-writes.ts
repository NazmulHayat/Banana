// Pending-writes retry queue (NFR-1: no silent data loss).
//
// When a save to Supabase fails (offline, transient network error, server
// hiccup), the write is enqueued here instead of being dropped. A flush driver
// later replays each queued write through a caller-supplied executor: successes
// are removed, failures stay queued for the next attempt. This is the durable
// safety net behind every save path in lib/db/*.
//
// This module is intentionally decoupled: a generic, typed AsyncStorage-backed
// queue plus a flush driver. It performs NO crypto, NO Supabase, and NO network
// itself — the executor passed into flushPendingWrites() owns the actual retry.
// The Lead wires enqueue-on-failure into entries/habits/habit-logs and flush
// into the data store; pendingWriteCount() backs a "will sync" indicator.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DailyEntry, Habit, HabitLog } from "./types";

/** A write that failed and must be retried. Discriminated by `kind`. */
export type PendingWrite =
  | { id: string; kind: "entry"; payload: DailyEntry; queuedAt: string }
  | { id: string; kind: "habits"; payload: Habit[]; queuedAt: string }
  | { id: string; kind: "habitLog"; payload: HabitLog; queuedAt: string };

// Storage key namespace. Protocol/storage constant, not branding — renaming it
// orphans every user's queued (and not-yet-retried) writes. Immutable once shipped.
const ASYNC_STORAGE_PREFIX = "banana_pending_writes_v1";

function storageKey(userId: string): string {
  return `${ASYNC_STORAGE_PREFIX}:${userId}`;
}

function genId(): string {
  // Unique enough for an append-only local queue: time + randomness.
  return `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read the raw queue for a user. Tolerant of missing/corrupt storage — returns
 * `[]` and never throws, so reads can never blank or crash a save path.
 */
async function readQueue(userId: string): Promise<PendingWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PendingWrite[];
  } catch {
    return [];
  }
}

/** Persist the queue for a user. Throws on failure so writers can react. */
async function writeQueue(userId: string, queue: PendingWrite[]): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(queue));
}

/**
 * Append a failed write to the user's retry queue. Generates a unique `id` and
 * `queuedAt` timestamp. New items go to the end (queue is oldest-first).
 */
export async function enqueuePendingWrite(
  userId: string,
  item: Omit<PendingWrite, "id" | "queuedAt">,
): Promise<void> {
  const queue = await readQueue(userId);
  const entry = {
    ...item,
    id: genId(),
    queuedAt: new Date().toISOString(),
  } as PendingWrite;
  queue.push(entry);
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

/**
 * Retry each queued write via `executor`, oldest first. A write whose executor
 * resolves is dropped; one that throws stays queued for the next flush. The
 * trimmed queue is persisted ONCE at the end. Never throws — returns counts.
 */
export async function flushPendingWrites(
  userId: string,
  executor: (item: PendingWrite) => Promise<void>,
): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue(userId);
  if (queue.length === 0) return { flushed: 0, remaining: 0 };

  const survivors: PendingWrite[] = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      await executor(item);
      flushed++;
    } catch {
      // Keep failed writes for the next attempt; no logging of payloads.
      survivors.push(item);
    }
  }

  // Persist the trimmed queue once. If this fails the next read still sees the
  // old queue (at worst a few already-flushed writes get retried — idempotent
  // upserts make that safe), so we swallow rather than throw out of the driver.
  await writeQueue(userId, survivors).catch(() => {});

  return { flushed, remaining: survivors.length };
}
