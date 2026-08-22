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
import { fromDayKey, toDayKey, todayKey } from "../dates";
import { supabase } from "../supabase";
import { DateFormats } from "./schema";
import type {
  HabitLog,
  HabitLogPayload,
  MonthRef,
  ReadResult,
} from "./types";
import { UnrecoverableWriteError } from "./types";

// Storage key is a protocol constant, not branding — renaming orphans caches.
const LOGS_STORAGE_KEY = "banana_habit_logs_v2";
// This module owns both cache tiers for habit logs — the store never
// writes them a second time.
const logsMonthCache = new Map<string, HabitLog[]>(); // userId:YYYY-MM

// Rows per page on a batched read: PostgREST can cap a response (`db-max-rows`)
// and would truncate it silently, so multi-month reads page explicitly.
const PAGE_SIZE = 500;
// Day buckets per delete request — keeps the URL well inside any proxy limit.
const DELETE_CHUNK = 100;
// Hard ceiling on a purge sweep, in days (~12 years). A nonsense `from` (clock
// skew, corrupt payload) must not turn one deletion into a million HMACs.
const MAX_PURGE_DAYS = 366 * 12;

function monthKey(userId: string, yearMonth: string): string {
  return `${userId}:${yearMonth}`;
}

function storageKey(userId: string, yearMonth: string): string {
  return `${LOGS_STORAGE_KEY}:${userId}:${yearMonth}`;
}

function writeMonth(userId: string, ym: string, logs: HabitLog[]): void {
  logsMonthCache.set(monthKey(userId, ym), logs);
  void AsyncStorage.setItem(storageKey(userId, ym), JSON.stringify(logs)).catch(
    () => {},
  );
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
  writeMonth(userId, DateFormats.formatYearMonth(year, month), logs);
}

export function clearHabitLogsCache(): void {
  logsMonthCache.clear();
}

/**
 * Write one log into the cached month it belongs to (if that month is cached).
 * A write used to invalidate the whole month, which offline left the tracker
 * with no cached logs at all and nothing to refill them from. A month that
 * isn't cached is left alone — caching a single optimistic log as the whole
 * month would hide every other log in it.
 */
export function upsertHabitLogInCache(userId: string, log: HabitLog): void {
  const ym = log.date.slice(0, 7);
  const month = logsMonthCache.get(monthKey(userId, ym));
  if (!month) return;
  const next = [...month];
  const i = next.findIndex(
    (l) => l.habitId === log.habitId && l.date === log.date,
  );
  if (i >= 0) next[i] = log;
  else next.push(log);
  writeMonth(userId, ym, next);
}

/**
 * Drop every cached log belonging to one habit, across BOTH tiers (D12).
 *
 * The in-memory pass alone used to leave AsyncStorage-only months untouched —
 * months this session never loaded kept the deleted habit's logs on disk and
 * resurrected them on the next cold start, inflating every stat. So the disk
 * is swept too, and only for keys scoped to this user.
 */
async function removeHabitFromLogCaches(
  userId: string,
  habitId: string,
): Promise<void> {
  const handled = new Set<string>();
  for (const [key, logs] of logsMonthCache) {
    if (!key.startsWith(`${userId}:`)) continue;
    const ym = key.slice(userId.length + 1);
    handled.add(ym);
    const next = logs.filter((l) => l.habitId !== habitId);
    // write-through keeps this month's on-disk copy in step
    if (next.length !== logs.length) writeMonth(userId, ym, next);
  }

  try {
    const prefix = `${LOGS_STORAGE_KEY}:${userId}:`;
    const keys = (await AsyncStorage.getAllKeys()).filter((k) =>
      k.startsWith(prefix),
    );
    for (const key of keys) {
      const ym = key.slice(prefix.length);
      if (handled.has(ym)) continue;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      let stored: unknown;
      try {
        stored = JSON.parse(raw);
      } catch {
        continue; // corrupt month; the read path already tolerates it
      }
      if (!Array.isArray(stored)) continue;
      const logs = stored as HabitLog[];
      const next = logs.filter((l) => l.habitId !== habitId);
      if (next.length === logs.length) continue;
      await AsyncStorage.setItem(key, JSON.stringify(next));
    }
  } catch (e) {
    if (__DEV__) console.warn("[habit_logs] Cache sweep failed:", e);
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

/**
 * Write an exact habit-log state (idempotent upsert — sets `completed` to the
 * given value, never toggles). Used for the normal write and by the data-store
 * flush executor when replaying a queued `habitLog`. `userId` comes from the
 * caller's session. Throws on failure; the caller queues the retry
 * (never this layer — D5).
 */
export async function upsertHabitLog(
  log: HabitLog,
  userId: string,
): Promise<HabitLog> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
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
  upsertHabitLogInCache(userId, log);

  return { habitId: log.habitId, date: log.date, completed: log.completed };
}

/** The days a purge has to sweep — see `deleteHabitLogsForHabit`. */
export interface HabitLogPurgeRange {
  /** First day that could hold a log for this habit ("YYYY-MM-DD"). */
  from: string;
  /** Last day, inclusive. Defaults to today (local). */
  to?: string;
}

/**
 * Inclusive local day keys from `from` to `to`, newest-anchored and clamped to
 * MAX_PURGE_DAYS: an absurd `from` sweeps the most recent window (the one that
 * can actually hold data) instead of running unbounded.
 */
export function enumeratePurgeDays(from: string, to: string): string[] {
  const start = fromDayKey(from);
  const end = fromDayKey(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (start > end) return [];

  // Walk backwards from `to` so the clamp keeps the newest days.
  const days: string[] = [];
  const cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor >= start && days.length < MAX_PURGE_DAYS) {
    days.push(toDayKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return days.reverse();
}

/**
 * Delete every habit log belonging to one habit (D12 — habit deletion used to
 * orphan its logs forever, polluting analytics).
 *
 * `day_bucket` is HMAC(masterKey, "habitlog:<habitId>:<date>"), so the server
 * cannot filter by habit for us — but the bucket is FORWARD-computable, and
 * that is the whole trick. This used to select every log row the user
 * had (unbounded, no `.range()` — so a server row cap could truncate it and
 * orphan logs with no error), decrypt all of them to find the matching ones,
 * and do that once per deleted habit. Now we enumerate the candidate days
 * locally, HMAC each one (~0.02 ms), and delete by bucket: zero reads, zero
 * decrypts, nothing to truncate.
 *
 * Throws on failure so the caller can queue the purge for retry.
 */
export async function deleteHabitLogsForHabit(
  habitId: string,
  userId: string,
  range: HabitLogPurgeRange,
): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const mk = keyring.getMasterKey();

  // Purge the local caches up front: the habit is gone from the user's list
  // either way, so its logs must not survive in a cached month even if the
  // server half has to be queued and replayed later.
  await removeHabitFromLogCaches(userId, habitId);

  const days = enumeratePurgeDays(range.from, range.to ?? todayKey());
  const buckets = days.map((date) => habitLogDayBucket(mk, habitId, date));

  for (let i = 0; i < buckets.length; i += DELETE_CHUNK) {
    const { error } = await supabase
      .from("habit_logs")
      .delete()
      .eq("owner_id", userId)
      .in("day_bucket", buckets.slice(i, i + DELETE_CHUNK));
    if (error) {
      throw new Error(`Failed to remove habit history: ${error.message}`);
    }
  }

  // A refresh between the purge above and here could have re-cached the rows.
  await removeHabitFromLogCaches(userId, habitId);
}

interface HabitLogRow {
  ciphertext: string;
  nonce: string;
  day_bucket: string;
}

/**
 * Every row for the given month buckets, paged so a server-side row cap can
 * never silently truncate the window.
 */
async function fetchByMonthBuckets(
  userId: string,
  buckets: string[],
): Promise<ReadResult<HabitLogRow[]>> {
  const rows: HabitLogRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("habit_logs")
      .select("ciphertext, nonce, day_bucket")
      .eq("owner_id", userId)
      .in("month_bucket", buckets)
      .order("day_bucket", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { ok: false, reason: error.message };
    const page = (data ?? []) as HabitLogRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { ok: true, data: rows };
  }
}

/**
 * Every habit log this user has. For export only — same reasoning as
 * `getAllEntries`: unfiltered by bucket, paged, and tolerant of a bad row.
 */
export async function getAllHabitLogs(
  userId: string,
): Promise<ReadResult<HabitLog[]>> {
  if (!keyring.isUnlocked()) return { ok: false, reason: "locked" };
  const mk = keyring.getMasterKey();

  const all: HabitLog[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("habit_logs")
      .select("ciphertext, nonce, day_bucket")
      .eq("owner_id", userId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (__DEV__) console.warn("[habit_logs] export fetch failed:", error.message);
      return { ok: false, reason: error.message };
    }
    const rows = data ?? [];
    for (const row of rows) {
      try {
        const payload = decryptJson<HabitLogPayload>(
          mk,
          { ciphertext: row.ciphertext, nonce: row.nonce },
          AAD.habitLog(row.day_bucket, userId),
        );
        all.push({
          habitId: payload.habitId,
          date: payload.date,
          completed: payload.completed,
        });
      } catch {
        // Skip the row, keep the export.
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, data: all };
}

/**
 * Read a whole window of months in ONE round trip — the analysis screens
 * asked for twelve months as twelve queries. The client computes the month
 * buckets, so the server learns nothing new; rows are regrouped locally by
 * their decrypted date.
 *
 * Every requested month is present in the result (`[]` when genuinely empty).
 * A transport failure returns `ok: false` and caches NOTHING.
 */
export async function getHabitLogsForMonths(
  months: MonthRef[],
  userId: string,
): Promise<ReadResult<Map<string, HabitLog[]>>> {
  if (!keyring.isUnlocked()) return { ok: false, reason: "locked" };
  const mk = keyring.getMasterKey();

  const byMonth = new Map<string, HabitLog[]>();
  for (const m of months) {
    byMonth.set(DateFormats.formatYearMonth(m.year, m.month), []);
  }
  if (byMonth.size === 0) return { ok: true, data: byMonth };

  const buckets = [...byMonth.keys()].map((ym) => habitLogMonthBucket(mk, ym));
  const fetched = await fetchByMonthBuckets(userId, buckets);
  if (!fetched.ok) {
    if (__DEV__) console.warn("[habit_logs] Fetch error:", fetched.reason);
    return fetched;
  }

  for (const row of fetched.data) {
    try {
      const payload = decryptJson<HabitLogPayload>(
        mk,
        { ciphertext: row.ciphertext, nonce: row.nonce },
        AAD.habitLog(row.day_bucket, userId),
      );
      const list = byMonth.get(payload.date.slice(0, 7));
      if (list) {
        list.push({
          habitId: payload.habitId,
          date: payload.date,
          completed: payload.completed,
        });
      }
    } catch (e) {
      // One unreadable row must not blank the window.
      if (__DEV__) console.warn("[habit_logs] Failed to decrypt log:", e);
    }
  }

  byMonth.forEach((logs, ym) => writeMonth(userId, ym, logs));
  return { ok: true, data: byMonth };
}

