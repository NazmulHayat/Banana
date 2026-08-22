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
import type {
  DailyEntry,
  EntryPayload,
  MonthRef,
  ReadResult,
} from "./types";
import { UnrecoverableWriteError } from "./types";

// ----------------------------------------------------------------------------
// Caches
// ----------------------------------------------------------------------------
// This module owns BOTH cache tiers for entries: every write through here
// updates the in-memory Map and AsyncStorage together, and the data store never
// writes them a second time. One owner, one JSON.stringify per change.
const entriesMonthCache = new Map<string, DailyEntry[]>(); // userId:YYYY-MM
// Storage key is a protocol constant, not branding — renaming orphans caches.
const ASYNC_STORAGE_PREFIX = "banana_entries_v2";

// Rows per page on a batched read. PostgREST can cap a response (`db-max-rows`)
// and would silently truncate it, so every multi-month read pages explicitly.
const PAGE_SIZE = 500;

function monthKey(userId: string, yearMonth: string): string {
  return `${userId}:${yearMonth}`;
}

function storageKey(userId: string, yearMonth: string): string {
  return `${ASYNC_STORAGE_PREFIX}:${userId}:${yearMonth}`;
}

function writeMonth(userId: string, ym: string, entries: DailyEntry[]): void {
  entriesMonthCache.set(monthKey(userId, ym), entries);
  void AsyncStorage.setItem(storageKey(userId, ym), JSON.stringify(entries)).catch(
    () => {},
  );
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
  writeMonth(userId, DateFormats.formatYearMonth(year, month), entries);
}

/**
 * Write one entry into the cached month it belongs to. A month that isn't
 * cached is left alone: caching a single optimistic entry as if it were the
 * whole month would hide every other entry in it on the next cold start.
 */
export function upsertEntryInCache(entry: DailyEntry, userId: string): void {
  const ym = entry.date.slice(0, 7);
  const existing = entriesMonthCache.get(monthKey(userId, ym));
  if (!existing) return;
  const next = [...existing];
  const i = next.findIndex((e) => e.id === entry.id);
  if (i >= 0) next[i] = entry;
  else next.push(entry);
  writeMonth(userId, ym, next);
}

/**
 * Drop one entry from the cached month, keeping the rest of it intact.
 * Used by `deleteEntry` (and by the store's optimistic delete) instead of
 * invalidating the whole month: an offline delete must leave a usable (just
 * smaller) cached month behind, not a hole the next read can only fill from a
 * server it can't reach.
 */
export function removeEntryFromCache(
  entryId: string,
  date: string,
  userId: string,
): void {
  const ym = date.slice(0, 7);
  const month = entriesMonthCache.get(monthKey(userId, ym));
  if (!month) return;
  writeMonth(
    userId,
    ym,
    month.filter((e) => e.id !== entryId),
  );
}

export function clearEntriesCache(): void {
  entriesMonthCache.clear();
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
    media: e.media,
    createdAt: e.createdAt,
    // Absent on every entry written before place tagging, and whenever the
    // setting is off — stays `undefined` rather than becoming an empty shape.
    place: e.place,
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
      media: e.media,
      place: e.place,
    })),
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Save (insert or merge) a single entry for the given day.
 * Multiple entries per day are merged into one encrypted row.
 *
 * `userId` comes from the caller's session (the data store already holds it) —
 * this layer no longer re-reads the session on every call.
 *
 * Throws on failure — an `UnrecoverableWriteError` when the write can never
 * land as-is (locked, signed out), a plain `Error` when the server/network is
 * at fault. The caller (data-store) decides what to do; this layer NEVER
 * queues its own retry (D5: a replaying executor that re-queues rewrites the
 * queue instead of retrying it).
 */
export async function saveEntry(
  entry: DailyEntry,
  userId: string,
): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
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
export async function deleteEntry(
  entryId: string,
  date: string,
  userId: string,
): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
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

interface EntryRow {
  ciphertext: string;
  nonce: string;
  day_bucket: string;
}

/**
 * Every row for the given month buckets, paged so a server-side row cap can
 * never silently truncate the window. Ordered by `day_bucket` — an
 * opaque HMAC, but a stable one, which is all `.range()` paging needs.
 */
async function fetchByMonthBuckets(
  userId: string,
  buckets: string[],
): Promise<ReadResult<EntryRow[]>> {
  const rows: EntryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("entries")
      .select("ciphertext, nonce, day_bucket")
      .eq("owner_id", userId)
      .in("month_bucket", buckets)
      .order("day_bucket", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { ok: false, reason: error.message };
    const page = (data ?? []) as EntryRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { ok: true, data: rows };
  }
}

/**
 * Every entry this user has, oldest first. For export only.
 *
 * Deliberately unfiltered by bucket: an export that quietly missed a month
 * because its HMAC didn't match a computed window would be worse than no
 * export at all. Paged with `.range()` so PostgREST's row cap can't truncate
 * it silently, and a row that won't decrypt is skipped rather than aborting
 * the whole file.
 */
export async function getAllEntries(
  userId: string,
): Promise<ReadResult<DailyEntry[]>> {
  if (!keyring.isUnlocked()) return { ok: false, reason: "locked" };
  const mk = keyring.getMasterKey();

  const all: DailyEntry[] = [];
  let skipped = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("entries")
      .select("ciphertext, nonce, day_bucket")
      .eq("owner_id", userId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (__DEV__) console.warn("[entries] export fetch failed:", error.message);
      return { ok: false, reason: error.message };
    }
    const rows = data ?? [];
    for (const row of rows) {
      try {
        const decrypted = decryptJson<EntryPayload>(
          mk,
          { ciphertext: row.ciphertext, nonce: row.nonce },
          AAD.entry(row.day_bucket, userId),
        );
        all.push(...payloadToEntries(decrypted));
      } catch {
        // One unreadable row must not cost the user the rest of their journal.
        skipped += 1;
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  if (__DEV__ && skipped > 0) {
    console.warn(`[entries] export skipped ${skipped} unreadable row(s)`);
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return { ok: true, data: all };
}

/**
 * Read a whole window of months in ONE round trip. The client computes
 * the month buckets, so the server still learns nothing it didn't already
 * store; rows are regrouped locally by their decrypted date.
 *
 * Every requested month is present in the result — a month with no rows maps
 * to `[]`, which is a real "this month is empty" answer and is cached as such.
 * A transport failure returns `ok: false` and caches NOTHING.
 */
export async function getEntriesForMonths(
  months: MonthRef[],
  userId: string,
): Promise<ReadResult<Map<string, DailyEntry[]>>> {
  if (!keyring.isUnlocked()) return { ok: false, reason: "locked" };
  const mk = keyring.getMasterKey();

  const byMonth = new Map<string, DailyEntry[]>();
  for (const m of months) {
    byMonth.set(DateFormats.formatYearMonth(m.year, m.month), []);
  }
  if (byMonth.size === 0) return { ok: true, data: byMonth };

  const buckets = [...byMonth.keys()].map((ym) => monthBucket(mk, ym));
  const fetched = await fetchByMonthBuckets(userId, buckets);
  if (!fetched.ok) {
    if (__DEV__) console.warn("[entries] Month fetch error:", fetched.reason);
    return fetched;
  }

  for (const row of fetched.data) {
    try {
      const decrypted = decryptJson<EntryPayload>(
        mk,
        { ciphertext: row.ciphertext, nonce: row.nonce },
        AAD.entry(row.day_bucket, userId),
      );
      // Group by the decrypted date: the day bucket is opaque, the payload is
      // not. A row from a month we didn't ask for can't happen, but if it did
      // it would be dropped rather than corrupt a requested month.
      const ym = decrypted.date.slice(0, 7);
      const bucketList = byMonth.get(ym);
      if (bucketList) bucketList.push(...payloadToEntries(decrypted));
    } catch (e) {
      // One unreadable row must not blank the window.
      if (__DEV__) console.warn("[entries] Failed to decrypt a row:", e);
    }
  }

  byMonth.forEach((list, ym) => writeMonth(userId, ym, list));
  return { ok: true, data: byMonth };
}

