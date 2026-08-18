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
import { DateFormats } from "./schema";
import type { DailyEntry, EntryPayload } from "./types";
import { UnrecoverableWriteError } from "./types";

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

/**
 * Drop one entry from both cache tiers, keeping the rest of the month intact.
 * Used by `deleteEntry` instead of invalidating the whole month: an offline
 * delete must leave a usable (just smaller) cached month behind, not a hole
 * the next read can only fill from a server it can't reach.
 */
function removeEntryFromCache(
  entryId: string,
  date: string,
  userId: string,
): void {
  const ym = date.slice(0, 7);
  const mKey = monthKey(userId, ym);
  const month = entriesMonthCache.get(mKey);
  if (month) {
    const next = month.filter((e) => e.id !== entryId);
    entriesMonthCache.set(mKey, next);
    void AsyncStorage.setItem(
      storageKey(userId, ym),
      JSON.stringify(next),
    ).catch(() => {});
  }
  const dKey = dayKey(userId, date);
  const day = entriesDayCache.get(dKey);
  if (day) entriesDayCache.set(dKey, day.filter((e) => e.id !== entryId));
}

export function clearEntriesCache(): void {
  entriesMonthCache.clear();
  entriesDayCache.clear();
}

/**
 * AsyncStorage tier of the read path (in-memory Map -> AsyncStorage -> network).
 * Returns `null` when nothing is persisted for that month, `[]` when a month
 * that is genuinely empty was persisted. A hit is promoted back into the
 * in-memory cache. Callers (data-store) use this on a Map miss, before the
 * network, so an offline cold start still paints.
 */
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
  if (!session) throw new UnrecoverableWriteError("Not signed in");
  return session.user.id;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Save (insert or merge) a single entry for the given day.
 * Multiple entries per day are merged into one encrypted row.
 *
 * Throws on failure — an `UnrecoverableWriteError` when the write can never
 * land as-is (locked, signed out), a plain `Error` when the server/network is
 * at fault. The caller (data-store) decides what to do; this layer NEVER
 * queues its own retry (D5: a replaying executor that re-queues rewrites the
 * queue instead of retrying it).
 */
export async function saveEntry(entry: DailyEntry): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  const dBucket = dayBucket(mk, entry.date);
  const mBucket = monthBucket(mk, entry.date.slice(0, 7));

  // Fetch existing row (if any) to merge same-day highlights
  const { data: existing, error: readErr } = await supabase
    .from("entries")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .eq("day_bucket", dBucket)
    .maybeSingle();

  // Can't read the day → can't merge it. Fail rather than overwrite the day
  // with just this entry (that would delete the other highlights on it).
  if (readErr) {
    throw new Error(`Failed to save entry: ${readErr.message}`);
  }

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

  // NFR-1: never swallow a write error. The data store catches this and
  // durably queues the entry for retry (flushed on init + app-foreground).
  if (error) {
    throw new Error(`Failed to save entry: ${error.message}`);
  }

  // Update caches
  for (const e of merged) upsertEntryInCache(e, userId);
}

/**
 * Delete one specific entry id (within a day). If the day becomes empty,
 * deletes the entire row.
 *
 * Throws on failure exactly like `saveEntry`, so a delete that can't reach the
 * server is queued by the caller and replayed later (D6: it used to ignore the
 * error entirely, and the "deleted" entry reappeared on the next sync).
 * Replays are safe: an already-deleted entry resolves as a no-op.
 */
export async function deleteEntry(entryId: string, date: string): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();
  const dBucket = dayBucket(mk, date);

  const { data: existing, error: readErr } = await supabase
    .from("entries")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .eq("day_bucket", dBucket)
    .maybeSingle();

  if (readErr) {
    throw new Error(`Failed to delete entry: ${readErr.message}`);
  }

  // Nothing on the server (already deleted, or never synced) — the local caches
  // still have to lose it, and the delete is done.
  if (!existing) {
    removeEntryFromCache(entryId, date, userId);
    return;
  }

  const aad = AAD.entry(dBucket, userId);
  let decrypted: EntryPayload;
  try {
    decrypted = decryptJson<EntryPayload>(
      mk,
      {
        ciphertext: existing.ciphertext as string,
        nonce: existing.nonce as string,
      },
      aad,
    );
  } catch {
    // Retrying can't fix a row we can't read — surface it as unrecoverable so
    // it isn't queued forever. Never log the ciphertext.
    throw new UnrecoverableWriteError("Could not read that day's entries");
  }
  const remaining = decrypted.entries.filter((e) => e.id !== entryId);

  if (remaining.length === 0) {
    const { error } = await supabase
      .from("entries")
      .delete()
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket);
    if (error) throw new Error(`Failed to delete entry: ${error.message}`);
  } else {
    const blob = encryptJson(mk, { ...decrypted, entries: remaining }, aad);
    const { error } = await supabase
      .from("entries")
      .update({ ciphertext: blob.ciphertext, nonce: blob.nonce })
      .eq("owner_id", userId)
      .eq("day_bucket", dBucket);
    if (error) throw new Error(`Failed to delete entry: ${error.message}`);
  }

  removeEntryFromCache(entryId, date, userId);
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
