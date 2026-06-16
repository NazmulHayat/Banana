// Habits — each habit is one encrypted row.
// Save flow uses replace-all semantics (delete all + insert new) to keep
// client code simple and consistent with the original UX.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AAD, decryptJson, encryptJson, keyring } from "../crypto";
import { supabase } from "../supabase";
import { enqueuePendingWrite } from "./pending-writes";
import type { Habit, HabitPayload } from "./types";

// Storage key is a protocol constant, not branding — renaming orphans caches.
const HABITS_STORAGE_KEY = "banana_habits_v2";

// In-memory cache keyed by userId
let memCache: { userId: string; habits: Habit[] } | null = null;

export function getCachedHabits(userId: string): Habit[] | null {
  if (memCache && memCache.userId === userId) return memCache.habits;
  return null;
}

export function setCachedHabits(userId: string, habits: Habit[]): void {
  memCache = { userId, habits };
  void AsyncStorage.setItem(
    `${HABITS_STORAGE_KEY}:${userId}`,
    JSON.stringify(habits),
  ).catch(() => {});
}

export function clearHabitsCache(): void {
  memCache = null;
}

export async function loadHabitsFromStorage(
  userId: string,
): Promise<Habit[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`${HABITS_STORAGE_KEY}:${userId}`);
    if (!raw) return null;
    const habits = JSON.parse(raw) as Habit[];
    memCache = { userId, habits };
    return habits;
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

/**
 * Replace all habits with the given list. Atomic-ish:
 * deletes all existing rows then inserts new ones. RLS guarantees
 * we only touch our own rows.
 */
export async function saveHabits(habits: Habit[]): Promise<void> {
  if (!keyring.isUnlocked()) throw new Error("Encryption is locked");
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  // Delete all existing habits for this user (RLS scopes to owner_id = uid)
  const { error: delErr } = await supabase
    .from("habits")
    .delete()
    .eq("owner_id", userId);
  if (delErr) {
    // NFR-1: the delete (first half of replace-all) failed — queue the full
    // desired list for retry instead of throwing it away. The replay re-runs
    // saveHabits, which redoes delete-all + insert atomically against the
    // server's current rows. Cache reflects the desired state optimistically.
    if (__DEV__) console.warn("[habits] Clear failed, queued for retry");
    await enqueuePendingWrite(userId, { kind: "habits", payload: habits });
    setCachedHabits(userId, habits);
    return;
  }

  if (habits.length === 0) {
    setCachedHabits(userId, []);
    return;
  }

  const aad = AAD.habit(userId);
  const rows = habits.map((h) => {
    const payload: HabitPayload = {
      id: h.id,
      name: h.name,
      createdAt: h.createdAt,
    };
    const blob = encryptJson(mk, payload, aad);
    return {
      owner_id: userId,
      ciphertext: blob.ciphertext,
      nonce: blob.nonce,
    };
  });

  const { error: insErr } = await supabase.from("habits").insert(rows);
  if (insErr) {
    // NFR-1: the insert failed after the delete succeeded — queue the full list
    // for retry so the habits aren't lost (the delete may have already cleared
    // the server rows). The replay re-runs the full replace-all.
    if (__DEV__) console.warn("[habits] Save failed, queued for retry");
    await enqueuePendingWrite(userId, { kind: "habits", payload: habits });
    setCachedHabits(userId, habits);
    return;
  }

  setCachedHabits(userId, habits);
}

export async function getHabits(): Promise<Habit[]> {
  if (!keyring.isUnlocked()) return [];
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  const cached = getCachedHabits(userId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from("habits")
    .select("ciphertext, nonce")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    if (__DEV__) console.error("[habits] Fetch error:", error.message);
    return [];
  }

  const aad = AAD.habit(userId);
  const habits: Habit[] = [];
  for (const row of data ?? []) {
    try {
      const payload = decryptJson<HabitPayload>(
        mk,
        {
          ciphertext: row.ciphertext as string,
          nonce: row.nonce as string,
        },
        aad,
      );
      habits.push({
        id: payload.id,
        name: payload.name,
        createdAt: payload.createdAt,
      });
    } catch (e) {
      if (__DEV__) console.warn("[habits] Failed to decrypt a habit:", e);
    }
  }

  setCachedHabits(userId, habits);
  return habits;
}
