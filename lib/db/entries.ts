import { isSupabaseConfigured, supabase, SUPABASE_URL } from "../supabase";
import {
  deriveKeyFromUuid,
  generateDayBucket,
  generateMonthBucket,
} from "./crypto";
import { sessionManager } from "./session-manager";
import { DateFormats } from "./schema";
import type { DailyEntry, EntryPayload, LegacyEntryPayload } from "./types";

function payloadToEntries(
  payload: EntryPayload | LegacyEntryPayload,
  fallbackId: string,
): DailyEntry[] {
  if ("entries" in payload && Array.isArray(payload.entries)) {
    return payload.entries.map((e) => ({
      id: e.id,
      date: payload.date,
      text: e.text,
      mediaUrls: e.localMediaUrls || [],
      createdAt: e.createdAt,
    }));
  }
  const legacy = payload as LegacyEntryPayload;
  return [
    {
      id: fallbackId,
      date: legacy.date,
      text: legacy.text,
      mediaUrls: legacy.localMediaUrls || [],
      createdAt: legacy.createdAt,
    },
  ];
}

function entriesToPayload(entries: DailyEntry[], date: string): EntryPayload {
  return {
    date,
    entries: entries.map((e) => ({
      id: e.id,
      text: e.text,
      createdAt: e.createdAt,
      localMediaUrls: e.mediaUrls,
    })),
  };
}

export async function saveEntry(entry: DailyEntry): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const userId = await sessionManager.getUserId();
  const accessToken = await sessionManager.getAccessToken();
  const key = deriveKeyFromUuid(userId);
  const dayBucket = generateDayBucket(key, entry.date);
  const monthBucket = generateMonthBucket(key, entry.date.slice(0, 7));

  // Fetch existing entry to merge
  const { data: existing } = await supabase
    .from("entries")
    .select("id")
    .eq("owner_id", userId)
    .eq("day_bucket", dayBucket)
    .maybeSingle();

  let allEntries: DailyEntry[] = [];
  if (existing) {
    const fetchResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=entries&owner_id=${userId}&day_bucket=${dayBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (fetchResponse.ok) {
      const { data: decrypted } = await fetchResponse.json();
      if (decrypted?.[0]) {
        allEntries = payloadToEntries(decrypted[0], entry.id);
      }
    }
  }

  const existingIndex = allEntries.findIndex((e) => e.id === entry.id);
  if (existingIndex >= 0) {
    allEntries[existingIndex] = entry;
  } else {
    allEntries.push(entry);
  }

  const payload = entriesToPayload(allEntries, entry.date);

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/encrypt-and-save`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        table: "entries",
        data: payload,
        owner_id: userId,
        day_bucket: dayBucket,
        month_bucket: monthBucket,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save entry");
  }
}

export async function getEntriesForDate(date: string): Promise<DailyEntry[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    const key = deriveKeyFromUuid(userId);
    const dayBucket = generateDayBucket(key, date);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=entries&owner_id=${userId}&day_bucket=${dayBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return [];

    const { data } = await response.json();
    if (!data?.[0]) return [];

    return payloadToEntries(data[0], "");
  } catch {
    return [];
  }
}

export async function getEntriesForMonth(
  year: number,
  month: number,
): Promise<DailyEntry[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    const key = deriveKeyFromUuid(userId);
    const monthBucket = generateMonthBucket(
      key,
      DateFormats.formatYearMonth(year, month),
    );

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=entries&owner_id=${userId}&month_bucket=${monthBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return [];

    const { data } = await response.json();
    const entries: DailyEntry[] = [];
    for (const item of data || []) {
      entries.push(...payloadToEntries(item, item._id || ""));
    }
    return entries;
  } catch {
    return [];
  }
}

export async function deleteEntry(
  entryId: string,
  date: string,
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    const key = deriveKeyFromUuid(userId);
    const dayBucket = generateDayBucket(key, date);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=entries&owner_id=${userId}&day_bucket=${dayBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return;

    const { data } = await response.json();
    if (!data?.[0]) return;

    let allEntries = payloadToEntries(data[0], entryId);
    allEntries = allEntries.filter((e) => e.id !== entryId);

    if (allEntries.length === 0) {
      await supabase
        .from("entries")
        .delete()
        .eq("owner_id", userId)
        .eq("day_bucket", dayBucket);
    } else {
      const payload = entriesToPayload(allEntries, date);
      const monthBucket = generateMonthBucket(key, date.slice(0, 7));

      await fetch(`${SUPABASE_URL}/functions/v1/encrypt-and-save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          table: "entries",
          data: payload,
          owner_id: userId,
          day_bucket: dayBucket,
          month_bucket: monthBucket,
        }),
      });
    }
  } catch {}
}
