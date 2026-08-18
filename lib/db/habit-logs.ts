// Habit logs — encrypted "did the user complete this habit on this day"
// One row per (habit, day), keyed by day_bucket = HMAC(masterKey, "habitlog:<habitId>:<date>").

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AAD,
  decryptJson,
  encryptJson,
  habitLogDayBucket,
  habitLogMonthBucket,
  keyring,
} from "../crypto";
import { supabase } from "../supabase";
import { DateFormats } from "./schema";
import type { HabitLog, HabitLogPayload } from "./types";
import { UnrecoverableWriteError } from "./types";

// Storage key is a protocol constant, not branding — renaming orphans caches.
const LOGS_STORAGE_KEY = "banana_habit_logs_v2";
const logsMonthCache = new Map<string, HabitLog[]>(); // userId:YYYY-MM

function monthKey(userId: string, yearMonth: string): string {
  return `${userId}:${yearMonth}`;
}

function storageKey(userId: string, yearMonth: string): string {
  return `${LOGS_STORAGE_KEY}:${userId}:${yearMonth}`;
}

export function getCachedHabitLogsForMonth(
  year: number,
  month: number,
  userId: string,
): HabitLog[] | null {
  return (
    logsMonthCache.get(
      monthKey(userId, DateFormats.formatYearMonth(year, month)),
    ) ?? null
  );
}

export function setCachedHabitLogsForMonth(
  year: number,
  month: number,
  userId: string,
  logs: HabitLog[],
): void {
  const ym = DateFormats.formatYearMonth(year, month);
  logsMonthCache.set(monthKey(userId, ym), logs);
  void AsyncStorage.setItem(storageKey(userId, ym), JSON.stringify(logs)).catch(
    () => {},
  );
}

export function clearHabitLogsCache(): void {
  logsMonthCache.clear();
}

/**
 * Write one log into the cached month it belongs to (if that month is cached).
 * A write used to invalidate the whole month, which offline left the tracker
 * with no cached logs at all and nothing to refill them from.
 */
function upsertLogInCache(userId: string, log: HabitLog): void {
  const ym = log.date.slice(0, 7);
  const mKey = monthKey(userId, ym);
  const month = logsMonthCache.get(mKey);
  if (!month) return;
  const next = [...month];
  const i = next.findIndex(
    (l) => l.habitId === log.habitId && l.date === log.date,
  );
  if (i >= 0) next[i] = log;
  else next.push(log);
  logsMonthCache.set(mKey, next);
  void AsyncStorage.setItem(storageKey(userId, ym), JSON.stringify(next)).catch(
    () => {},
  );
}

/** Drop every cached log belonging to one habit, across all cached months (D12). */
function removeHabitFromLogCaches(userId: string, habitId: string): void {
  for (const [key, logs] of logsMonthCache) {
    if (!key.startsWith(`${userId}:`)) continue;
    const next = logs.filter((l) => l.habitId !== habitId);
    if (next.length === logs.length) continue;
    logsMonthCache.set(key, next);
    const ym = key.slice(userId.length + 1);
    void AsyncStorage.setItem(
      storageKey(userId, ym),
      JSON.stringify(next),
    ).catch(() => {});
  }
}

/**
 * AsyncStorage tier of the read path (in-memory Map -> AsyncStorage -> network).
 * Returns `null` when nothing is persisted for that month, `[]` when a month
 * that is genuinely empty was persisted. A hit is promoted back into the
 * in-memory cache. Callers (data-store) use this on a Map miss, before the
 * network, so an offline cold start still paints.
 */
export async function loadHabitLogsFromStorage(
  year: number,
  month: number,
  userId: string,
): Promise<HabitLog[] | null> {
  try {
    const ym = DateFormats.formatYearMonth(year, month);
    const raw = await AsyncStorage.getItem(storageKey(userId, ym));
    if (!raw) return null;
    const logs = JSON.parse(raw) as HabitLog[];
    logsMonthCache.set(monthKey(userId, ym), logs);
    return logs;
  } catch {
    return null;
  }
}

async function requireUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new UnrecoverableWriteError("Not signed in");
  return session.user.id;
}

export async function toggleHabitLog(
  habitId: string,
  date: string,
  currentCompleted?: boolean,
): Promise<HabitLog> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  // Only the day bucket / AAD are needed here to read the current state; the
  // month bucket and final encryption happen inside upsertHabitLog.
  const dBucket = habitLogDayBucket(mk, habitId, date);
  const aad = AAD.habitLog(dBucket, userId);
  let completed: boolean;
  if (typeof currentCompleted === "boolean") {
    completed = !currentCompleted;
  } else {
    // Read current from server
    const { data: existing, error: readErr } = await supabase
      .from("habit_logs")
      .select("ciphertext, nonce")
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket)
      .maybeSingle();
    // Don't guess the current state from a failed read — a wrong guess flips
    // the cell the wrong way. Callers pass `currentCompleted` from local state
    // for exactly this reason.
    if (readErr) {
      throw new Error(`Failed to update habit: ${readErr.message}`);
    }
    if (existing) {
      const payload = decryptJson<HabitLogPayload>(
        mk,
        {
          ciphertext: existing.ciphertext as string,
          nonce: existing.nonce as string,
        },
        aad,
      );
      completed = !payload.completed;
    } else {
      completed = true;
    }
  }

  // Persist the exact computed state via the idempotent upsert helper, which
  // throws on failure so the caller can queue this log for retry (NFR-1).
  return upsertHabitLog({ habitId, date, completed });
}

/**
 * Write an exact habit-log state (idempotent upsert — sets `completed` to the
 * given value, never toggles). Used by `toggleHabitLog` for the normal write
 * and by the data-store flush executor when replaying a queued `habitLog`.
 * Throws on failure; the caller queues the retry (never this layer — D5).
 */
export async function upsertHabitLog(log: HabitLog): Promise<HabitLog> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const dBucket = habitLogDayBucket(mk, log.habitId, log.date);
  const mBucket = habitLogMonthBucket(mk, log.date.slice(0, 7));
  const aad = AAD.habitLog(dBucket, userId);

  const payload: HabitLogPayload = {
    habitId: log.habitId,
    date: log.date,
    completed: log.completed,
  };
  const blob = encryptJson(mk, payload, aad);

  const { error } = await supabase.from("habit_logs").upsert(
    {
      owner_id: userId,
      day_bucket: dBucket,
      month_bucket: mBucket,
      ciphertext: blob.ciphertext,
      nonce: blob.nonce,
    },
    { onConflict: "owner_id,day_bucket" },
  );
  // NFR-1: never swallow a write error — the caller queues the exact final
  // state and replays it verbatim later.
  if (error) {
    throw new Error(`Failed to update habit: ${error.message}`);
  }

  // Keep the cached month in step with the write (no invalidation: offline the
  // cache is the only copy the tracker has).
  upsertLogInCache(userId, log);

  return { habitId: log.habitId, date: log.date, completed: log.completed };
}

/**
 * Delete every habit log belonging to one habit (D12 — habit deletion used to
 * orphan its logs forever, polluting analytics).
 *
 * `day_bucket` is HMAC(masterKey, "habitlog:<habitId>:<date>"), so the server
 * cannot filter by habit for us and we cannot reverse a bucket into a date.
 * The only exact way is to read this user's log rows (RLS-scoped), decrypt them
 * client-side, and delete the buckets whose payload names this habit. Habit
 * deletion is rare, so one scan is an acceptable price for not leaving rows
 * behind. Throws on failure so the caller can queue the purge for retry.
 */
export async function deleteHabitLogsForHabit(habitId: string): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  // Purge the local caches up front: the habit is gone from the user's list
  // either way, so its logs must not survive in a cached month even if the
  // server half has to be queued and replayed later.
  removeHabitFromLogCaches(userId, habitId);

  const { data, error } = await supabase
    .from("habit_logs")
    .select("ciphertext, nonce, day_bucket")
    .eq("owner_id", userId);

  if (error) {
    throw new Error(`Failed to remove habit history: ${error.message}`);
  }

  const buckets: string[] = [];
  for (const row of data ?? []) {
    const dBucket = row.day_bucket as string;
    try {
      const payload = decryptJson<HabitLogPayload>(
        mk,
        {
          ciphertext: row.ciphertext as string,
          nonce: row.nonce as string,
        },
        AAD.habitLog(dBucket, userId),
      );
      if (payload.habitId === habitId) buckets.push(dBucket);
    } catch (e) {
      // A row we can't read isn't provably ours to delete — skip it, keep going.
      if (__DEV__) console.warn("[habit_logs] Failed to decrypt log:", e);
    }
  }

  // Chunked so a long history can't blow past the URL/statement limits.
  const CHUNK = 100;
  for (let i = 0; i < buckets.length; i += CHUNK) {
    const { error: delErr } = await supabase
      .from("habit_logs")
      .delete()
      .eq("owner_id", userId)
      .in("day_bucket", buckets.slice(i, i + CHUNK));
    if (delErr) {
      throw new Error(`Failed to remove habit history: ${delErr.message}`);
    }
  }

  // A refresh between the purge above and here could have re-cached the rows.
  removeHabitFromLogCaches(userId, habitId);
}

export async function getHabitLogsForMonth(
  year: number,
  month: number,
): Promise<HabitLog[]> {
  if (!keyring.isUnlocked()) return [];
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const ym = DateFormats.formatYearMonth(year, month);
  const mBucket = habitLogMonthBucket(mk, ym);

  const { data, error } = await supabase
    .from("habit_logs")
    .select("ciphertext, nonce, day_bucket")
    .eq("owner_id", userId)
    .eq("month_bucket", mBucket);

  if (error) {
    if (__DEV__) console.error("[habit_logs] Fetch error:", error.message);
    return [];
  }

  const logs: HabitLog[] = [];
  for (const row of data ?? []) {
    try {
      const payload = decryptJson<HabitLogPayload>(
        mk,
        {
          ciphertext: row.ciphertext as string,
          nonce: row.nonce as string,
        },
        AAD.habitLog(row.day_bucket as string, userId),
      );
      logs.push({
        habitId: payload.habitId,
        date: payload.date,
        completed: payload.completed,
      });
    } catch (e) {
      if (__DEV__) console.warn("[habit_logs] Failed to decrypt log:", e);
    }
  }

  setCachedHabitLogsForMonth(year, month, userId, logs);
  return logs;
}

// Back-compat name used by data-store.tsx
export const getHabitLogsForMonthDirect = getHabitLogsForMonth;
