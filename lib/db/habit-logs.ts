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
import { enqueuePendingWrite } from "./pending-writes";
import { DateFormats } from "./schema";
import type { HabitLog, HabitLogPayload } from "./types";

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
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

export async function toggleHabitLog(
  habitId: string,
  date: string,
  currentCompleted?: boolean,
): Promise<HabitLog> {
  if (!keyring.isUnlocked()) throw new Error("Encryption is locked");
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
    const { data: existing } = await supabase
      .from("habit_logs")
      .select("ciphertext, nonce")
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket)
      .maybeSingle();
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

  // Persist the exact computed state via the idempotent upsert helper. On a
  // server/network failure it queues the final HabitLog for retry instead of
  // throwing (NFR-1) — we still return that log so the optimistic UI stays
  // correct and the queued write replays it verbatim later.
  return upsertHabitLog({ habitId, date, completed });
}

/**
 * Write an exact habit-log state (idempotent upsert — sets `completed` to the
 * given value, never toggles). Used by `toggleHabitLog` for the normal write
 * and by the data-store flush executor when replaying a queued `habitLog`.
 * On write failure the log is durably enqueued for retry (NFR-1) and returned.
 */
export async function upsertHabitLog(log: HabitLog): Promise<HabitLog> {
  if (!keyring.isUnlocked()) throw new Error("Encryption is locked");
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
  if (error) {
    // NFR-1: queue the exact final state for retry rather than dropping it.
    if (__DEV__) console.warn("[habit_logs] Save failed, queued for retry");
    await enqueuePendingWrite(userId, { kind: "habitLog", payload: log });
  }

  // Invalidate month cache for that month so next read is fresh
  const ym = log.date.slice(0, 7);
  logsMonthCache.delete(monthKey(userId, ym));

  return { habitId: log.habitId, date: log.date, completed: log.completed };
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
