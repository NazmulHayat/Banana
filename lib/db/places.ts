// Places — the names you've given to locations, one encrypted row each.
//
// Nothing here is legible to the server. The heading, the address AND the
// coordinates all live inside `ciphertext`; the `places` table has no
// coordinate column at all, because an unencrypted lat/long would tell our own
// admin where the user sleeps. That is the threat model this app exists for.
//
// Save flow uses replace-all semantics (delete all + insert new), matching
// habits.ts — the set is small and always written wholesale.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AAD, decryptJson, encryptJson, keyring } from "../crypto";
import { supabase } from "../supabase";
import { queueCacheWrite } from "./cache-writer";
import type { PlacePayload, ReadResult, SavedPlace } from "./types";
import { UnrecoverableWriteError } from "./types";

// Storage key is a protocol constant, not branding — renaming orphans caches.
const PLACES_STORAGE_KEY = "banana_places_v2";

let memCache: { userId: string; places: SavedPlace[] } | null = null;

export function getCachedPlaces(userId: string): SavedPlace[] | null {
  if (memCache && memCache.userId === userId) return memCache.places;
  return null;
}

export function setCachedPlaces(userId: string, places: SavedPlace[]): void {
  memCache = { userId, places };
  queueCacheWrite(`${PLACES_STORAGE_KEY}:${userId}`, places);
}

export function clearPlacesCache(): void {
  memCache = null;
}

/**
 * AsyncStorage tier of the read path (in-memory Map -> AsyncStorage -> network).
 * Returns `null` when nothing is persisted, so the caller can tell "no cache"
 * apart from "cached empty list".
 */
export async function loadPlacesFromStorage(
  userId: string,
): Promise<SavedPlace[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PLACES_STORAGE_KEY}:${userId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const places = parsed as SavedPlace[];
    memCache = { userId, places };
    return places;
  } catch (e) {
    if (__DEV__) console.warn("[places] Cache read failed:", e);
    return null;
  }
}

/**
 * Replace the whole saved-place set. Throws on failure — the caller decides
 * whether to queue a retry, exactly as it does for habits.
 */
export async function savePlaces(
  places: SavedPlace[],
  userId: string,
): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const mk = keyring.getMasterKey();

  const { error: delErr } = await supabase
    .from("places")
    .delete()
    .eq("owner_id", userId);
  if (delErr) {
    // First half of replace-all failed — nothing was changed server-side.
    throw new Error(`Failed to save places: ${delErr.message}`);
  }

  if (places.length === 0) {
    setCachedPlaces(userId, []);
    return;
  }

  const aad = AAD.place(userId);
  const rows = places.map((p) => {
    const payload: PlacePayload = {
      id: p.id,
      heading: p.heading,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
      createdAt: p.createdAt,
    };
    const blob = encryptJson(mk, payload, aad);
    return {
      owner_id: userId,
      ciphertext: blob.ciphertext,
      nonce: blob.nonce,
    };
  });

  const { error: insErr } = await supabase.from("places").insert(rows);
  if (insErr) {
    throw new Error(`Failed to save places: ${insErr.message}`);
  }

  setCachedPlaces(userId, places);
}

/**
 * Network tier of the read path. `ok: false` means the read never produced
 * data — the caller keeps whatever it already had rather than blanking the list.
 */
export async function getPlaces(
  userId: string,
): Promise<ReadResult<SavedPlace[]>> {
  if (!keyring.isUnlocked()) return { ok: false, reason: "locked" };
  const mk = keyring.getMasterKey();

  const { data, error } = await supabase
    .from("places")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    if (__DEV__) console.warn("[places] Fetch error:", error.message);
    return { ok: false, reason: error.message };
  }

  const aad = AAD.place(userId);
  const places: SavedPlace[] = [];
  for (const row of data ?? []) {
    try {
      const payload = decryptJson<PlacePayload>(
        mk,
        {
          ciphertext: row.ciphertext as string,
          nonce: row.nonce as string,
        },
        aad,
      );
      places.push({
        id: payload.id,
        heading: payload.heading,
        address: payload.address,
        latitude: payload.latitude,
        longitude: payload.longitude,
        createdAt: payload.createdAt,
      });
    } catch (e) {
      // One unreadable row must not blank the list.
      if (__DEV__) console.warn("[places] Failed to decrypt a place:", e);
    }
  }

  setCachedPlaces(userId, places);
  return { ok: true, data: places };
}
