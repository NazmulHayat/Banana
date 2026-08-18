// Habits — each habit is one encrypted row.
// Save flow uses replace-all semantics (delete all + insert new) to keep
// client code simple and consistent with the original UX.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AAD, decryptJson, encryptJson, keyring } from "../crypto";
import { supabase } from "../supabase";
import type { Habit, HabitPayload } from "./types";
import { UnrecoverableWriteError } from "./types";

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

/**
 * AsyncStorage tier of the read path (in-memory Map -> AsyncStorage -> network).
 * Returns `null` when nothing is persisted for this user, `[]` when an empty
 * list was persisted. A hit is promoted back into the in-memory cache.
 */
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
  if (!session) throw new UnrecoverableWriteError("Not signed in");
  return session.user.id;
}

/**
 * Replace all habits with the given list. Atomic-ish: deletes all existing rows
 * then inserts new ones. RLS guarantees we only touch our own rows.
 *
 * Array order IS the order: each row carries its 0-based index as
 * `HabitPayload.position` (D11), so drag-to-reorder is durable rather than an
 * accident of insertion order.
 *
 * Throws on failure (never queues its own retry — see saveEntry). The caller
 * queues the whole desired list once; the replay re-runs the full replace-all
 * against whatever the server currently has, so it is idempotent.
 */
export async function saveHabits(habits: Habit[]): Promise<void> {
  if (!keyring.isUnlocked()) {
    throw new UnrecoverableWriteError("Encryption is locked");
  }
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  // Delete all existing habits for this user (RLS scopes to owner_id = uid)
  const { error: delErr } = await supabase
    .from("habits")
    .delete()
    .eq("owner_id", userId);
  if (delErr) {
    // First half of replace-all failed — nothing was changed server-side.
    throw new Error(`Failed to save habits: ${delErr.message}`);
  }

  if (habits.length === 0) {
    setCachedHabits(userId, []);
    return;
  }

  const aad = AAD.habit(userId);
  const rows = habits.map((h, index) => {
    const payload: HabitPayload = {
      id: h.id,
      name: h.name,
      createdAt: h.createdAt,
      position: index,
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
    // The insert failed after the delete succeeded, so the server may now be
    // empty: the queued retry (owned by the caller) is what restores the list.
    throw new Error(`Failed to save habits: ${insErr.message}`);
  }

  setCachedHabits(userId, habits);
}

/**
 * Fetch habits. Reads short-circuit on the in-memory cache unless `force` is
 * set (pull-to-refresh), which goes straight to the network.
 *
 * Note `getCachedHabits` returns `null` when nothing has been resolved for this
 * user and `[]` when the user genuinely has no habits — an empty list is a real
 * result and short-circuits like any other.
 */
export async function getHabits(opts?: { force?: boolean }): Promise<Habit[]> {
  if (!keyring.isUnlocked()) return [];
  const userId = await requireUserId();
  const mk = keyring.getMasterKey();

  if (!opts?.force) {
    const cached = getCachedHabits(userId);
    if (cached !== null) return cached;
  }

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
  // Decrypt in `created_at` order (the query's order), keeping each habit's
  // stored `position` alongside it so we can restore the user's order below.
  const decrypted: { habit: Habit; position?: number }[] = [];
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
      decrypted.push({
        habit: {
          id: payload.id,
          name: payload.name,
          createdAt: payload.createdAt,
        },
        position:
          typeof payload.position === "number" && Number.isFinite(payload.position)
            ? payload.position
            : undefined,
      });
    } catch (e) {
      if (__DEV__) console.warn("[habits] Failed to decrypt a habit:", e);
    }
  }

  // D11 back-compat: only trust `position` when EVERY row has one (habits are
  // written wholesale, so it's all-or-nothing in practice). A list containing
  // any pre-position row keeps its `created_at` ordering untouched — upgrading
  // must never scramble someone's habits. The first save re-stamps positions.
  const ordered =
    decrypted.length > 0 && decrypted.every((d) => d.position !== undefined)
      ? [...decrypted].sort(
          (a, b) => (a.position as number) - (b.position as number),
        )
      : decrypted;
  const habits = ordered.map((d) => d.habit);

  setCachedHabits(userId, habits);
  return habits;
}
