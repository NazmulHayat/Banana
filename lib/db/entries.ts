// Entries — encrypted journal entries, one row per day.
// Multiple "highlights" can live within a single day's encrypted payload.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AAD,
  dayBucket,
  decryptJson,
  encryptJson,
  keyring,
  monthBucket,
} from "../crypto";
import { supabase } from "../supabase";
import { enqueuePendingWrite } from "./pending-writes";
import { DateFormats } from "./schema";
import type { DailyEntry, EntryPayload } from "./types";

// ----------------------------------------------------------------------------
// Caches
// ----------------------------------------------------------------------------
const entriesMonthCache = new Map<string, DailyEntry[]>(); // userId:YYYY-MM
const entriesDayCache = new Map<string, DailyEntry[]>(); // userId:YYYY-MM-DD
// Storage key is a protocol constant, not branding — renaming orphans caches.
const ASYNC_STORAGE_PREFIX = "banana_entries_v2";

function monthKey(userId: string, yearMonth: string): string {
  return `${userId}:${yearMonth}`;
}

function dayKey(userId: string, date: string): string {
  return `${userId}:${date}`;
}

function storageKey(userId: string, yearMonth: string): string {
  return `${ASYNC_STORAGE_PREFIX}:${userId}:${yearMonth}`;
}

export function getCachedEntriesForMonth(
  year: number,
  month: number,
  userId: string,
): DailyEntry[] | null {
  return (
    entriesMonthCache.get(
      monthKey(userId, DateFormats.formatYearMonth(year, month)),
    ) ?? null
  );
}

export function setCachedEntriesForMonth(
  year: number,
  month: number,
  userId: string,
  entries: DailyEntry[],
): void {
  const ym = DateFormats.formatYearMonth(year, month);
  entriesMonthCache.set(monthKey(userId, ym), entries);
  void AsyncStorage.setItem(storageKey(userId, ym), JSON.stringify(entries)).catch(
    () => {},
  );
}

export function upsertEntryInCache(entry: DailyEntry, userId: string): void {
  const ym = entry.date.slice(0, 7);
  const mKey = monthKey(userId, ym);
  const existing = entriesMonthCache.get(mKey);
  if (existing) {
    const next = [...existing];
    const i = next.findIndex((e) => e.id === entry.id);
    if (i >= 0) next[i] = entry;
    else next.push(entry);
    entriesMonthCache.set(mKey, next);
    void AsyncStorage.setItem(
      storageKey(userId, ym),
      JSON.stringify(next),
    ).catch(() => {});
  }
  const dKey = dayKey(userId, entry.date);
  const dayExisting = entriesDayCache.get(dKey);
  if (dayExisting) {
    const next = [...dayExisting];
    const i = next.findIndex((e) => e.id === entry.id);
    if (i >= 0) next[i] = entry;
    else next.push(entry);
    entriesDayCache.set(dKey, next);
  }
}

export function clearEntriesCache(): void {
  entriesMonthCache.clear();
  entriesDayCache.clear();
}

export async function loadEntriesForMonthFromStorage(
  year: number,
  month: number,
  userId: string,
): Promise<DailyEntry[] | null> {
  try {
    const ym = DateFormats.formatYearMonth(year, month);
    const raw = await AsyncStorage.getItem(storageKey(userId, ym));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyEntry[];
    entriesMonthCache.set(monthKey(userId, ym), parsed);
    return parsed;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function payloadToEntries(payload: EntryPayload): DailyEntry[] {
  return payload.entries.map((e) => ({
    id: e.id,
    date: payload.date,
    text: e.text,
    mediaPaths: e.mediaPaths ?? [],
    createdAt: e.createdAt,
  }));
}

function entriesToPayload(date: string, entries: DailyEntry[]): EntryPayload {
  return {
    date,
    entries: entries.map((e) => ({
      id: e.id,
      text: e.text,
      createdAt: e.createdAt,
      mediaPaths: e.mediaPaths,
    })),
  };
}

async function requireUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Save (insert or merge) a single entry for the given day.
 * Multiple entries per day are merged into one encrypted row.
 */
export async function saveEntry(entry: DailyEntry): Promise<void> {
  if (!keyring.isUnlocked()) throw new Error("Encryption is locked");
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  const dBucket = dayBucket(mk, entry.date);
  const mBucket = monthBucket(mk, entry.date.slice(0, 7));

  // Fetch existing row (if any) to merge same-day highlights
  const { data: existing } = await supabase
    .from("entries")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .eq("day_bucket", dBucket)
    .maybeSingle();

  let merged: DailyEntry[] = [];
  if (existing) {
    try {
      const decrypted = decryptJson<EntryPayload>(
        mk,
        {
          ciphertext: existing.ciphertext as string,
          nonce: existing.nonce as string,
        },
        AAD.entry(dBucket, userId),
      );
      merged = payloadToEntries(decrypted);
    } catch (e) {
      if (__DEV__) {
        console.warn("[entries] Failed to decrypt existing day, replacing:", e);
      }
    }
  }

  const idx = merged.findIndex((e) => e.id === entry.id);
  if (idx >= 0) merged[idx] = entry;
  else merged.push(entry);

  const payload = entriesToPayload(entry.date, merged);
  const blob = encryptJson(mk, payload, AAD.entry(dBucket, userId));

  const { error } = await supabase.from("entries").upsert(
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
    // NFR-1: don't throw the write away on a server/network failure. Durably
    // enqueue it for retry (flushed on init + app-foreground in data-store).
    // The optimistic UI already reflects this edit, so returning normally keeps
    // the screen correct while the queue guarantees the write isn't lost.
    if (__DEV__) console.warn("[entries] Save failed, queued for retry");
    await enqueuePendingWrite(userId, { kind: "entry", payload: entry });
  }

  // Update caches
  for (const e of merged) upsertEntryInCache(e, userId);
}

/**
 * Delete one specific entry id (within a day). If the day becomes empty,
 * deletes the entire row.
 */
export async function deleteEntry(entryId: string, date: string): Promise<void> {
  if (!keyring.isUnlocked()) throw new Error("Encryption is locked");
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const dBucket = dayBucket(mk, date);

  const { data: existing } = await supabase
    .from("entries")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .eq("day_bucket", dBucket)
    .maybeSingle();

  if (!existing) return;

  const aad = AAD.entry(dBucket, userId);
  const decrypted = decryptJson<EntryPayload>(
    mk,
    {
      ciphertext: existing.ciphertext as string,
      nonce: existing.nonce as string,
    },
    aad,
  );
  const remaining = decrypted.entries.filter((e) => e.id !== entryId);

  if (remaining.length === 0) {
    await supabase
      .from("entries")
      .delete()
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket);
  } else {
    const blob = encryptJson(mk, { ...decrypted, entries: remaining }, aad);
    await supabase
      .from("entries")
      .update({ ciphertext: blob.ciphertext, nonce: blob.nonce })
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket);
  }

  // Invalidate caches for that month
  const ym = date.slice(0, 7);
  entriesMonthCache.delete(monthKey(userId, ym));
  entriesDayCache.delete(dayKey(userId, date));
}

export async function getEntriesForDate(date: string): Promise<DailyEntry[]> {
  if (!keyring.isUnlocked()) return [];
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const dKey = dayKey(userId, date);

  const cached = entriesDayCache.get(dKey);
  if (cached) return cached;

  const dBucket = dayBucket(mk, date);
  const { data, error } = await supabase
    .from("entries")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .eq("day_bucket", dBucket)
    .maybeSingle();

  if (error || !data) return [];
  try {
    const decrypted = decryptJson<EntryPayload>(
      mk,
      {
        ciphertext: data.ciphertext as string,
        nonce: data.nonce as string,
      },
      AAD.entry(dBucket, userId),
    );
    const entries = payloadToEntries(decrypted);
    entriesDayCache.set(dKey, entries);
    return entries;
  } catch (e) {
    if (__DEV__) console.error("[entries] Decrypt failure for date", date, e);
    return [];
  }
}

export async function getEntriesForMonth(
  year: number,
  month: number,
): Promise<DailyEntry[]> {
  if (!keyring.isUnlocked()) return [];
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const ym = DateFormats.formatYearMonth(year, month);
  const mBucket = monthBucket(mk, ym);

  const { data, error } = await supabase
    .from("entries")
    .select("ciphertext, nonce, day_bucket")
    .eq("owner_id", userId)
    .eq("month_bucket", mBucket);

  if (error) {
    if (__DEV__) console.error("[entries] Month fetch error:", error.message);
    return [];
  }

  const all: DailyEntry[] = [];
  for (const row of data ?? []) {
    try {
      const decrypted = decryptJson<EntryPayload>(
        mk,
        {
          ciphertext: row.ciphertext as string,
          nonce: row.nonce as string,
        },
        AAD.entry(row.day_bucket as string, userId),
      );
      all.push(...payloadToEntries(decrypted));
    } catch (e) {
      if (__DEV__) console.warn("[entries] Failed to decrypt a row:", e);
    }
  }

  setCachedEntriesForMonth(year, month, userId, all);
  return all;
}

export async function prefetchEntriesForMonth(
  year: number,
  month: number,
): Promise<void> {
  if (!keyring.isUnlocked()) return;
  try {
    const userId = await requireUserId();
    const ym = DateFormats.formatYearMonth(year, month);
    if (entriesMonthCache.has(monthKey(userId, ym))) return;
    await getEntriesForMonth(year, month);
  } catch {
    // best effort
  }
}
