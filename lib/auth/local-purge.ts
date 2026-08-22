// Local teardown for account deletion (bug D10).
//
// Signing out only drops the in-memory caches; the AsyncStorage tier survives
// on purpose so an offline user keeps their journal. After the server row is
// gone that data has no owner left, so deletion has to wipe the device too:
// the decrypted month caches, the durable write queue (which would otherwise
// try to replay writes for a user that no longer exists), and the master key
// in SecureStore.
//
// This lives beside the auth flow rather than in lib/db because it spans every
// store at once — db caches, the pending queue, and the keyring — and only the
// account lifecycle ever needs it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { keyring } from "../crypto";
import {
  clearEntriesCache,
  clearHabitLogsCache,
  clearHabitsCache,
  clearPendingWrites,
  clearPlacesCache,
} from "../db";
import { clearLocationPref } from "../location";
import { clearMediaCache } from "../media";
import { clearReminder } from "../reminder";

// Must match the prefixes in lib/db/*. These are protocol constants — the
// `banana_*_v2` names key every cached row already on disk and are never
// renamed (see CLAUDE.md); a new cache shape gets a new suffix instead.
const USER_SCOPED_PREFIXES = [
  "banana_entries_v2",
  "banana_habits_v2",
  "banana_habit_logs_v2",
  "banana_places_v2",
  "banana_pending_writes_v1",
];

/**
 * Erase everything this device holds for one user. Best effort by design —
 * it runs only after the backend delete succeeded, so a storage hiccup must
 * not surface as a failed deletion.
 *
 * Only keys scoped to this user id are removed; a second account's cache on a
 * shared device is left alone.
 */
export async function purgeLocalUserData(userId: string): Promise<void> {
  // In-memory tiers first — cheap and can't fail.
  clearEntriesCache();
  clearHabitsCache();
  clearHabitLogsCache();
  clearPlacesCache();
  clearMediaCache();

  try {
    await clearPendingWrites(userId);
  } catch {
    // clearPendingWrites already swallows storage errors; belt and braces.
  }

  // The daily reminder is device-local, not user-scoped, so it has to be
  // unscheduled here — otherwise a deleted account keeps getting nudged.
  try {
    await clearReminder();
  } catch (e) {
    if (__DEV__) console.warn("[purge] reminder clear failed:", e);
  }

  // Location tagging is a device setting like the reminder, so it has to be
  // switched off here too — a deleted account must not leave a phone still
  // configured to geocode where the next person writes.
  try {
    await clearLocationPref();
  } catch (e) {
    if (__DEV__) console.warn("[purge] location pref clear failed:", e);
  }

  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) =>
      USER_SCOPED_PREFIXES.some((prefix) => key.startsWith(`${prefix}:${userId}`)),
    );
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch (e) {
    if (__DEV__) console.warn("[purge] cache sweep failed:", e);
  }

  // Last: the master key itself (memory + SecureStore).
  try {
    await keyring.lock();
  } catch (e) {
    if (__DEV__) console.warn("[purge] keyring lock failed:", e);
  }
}
