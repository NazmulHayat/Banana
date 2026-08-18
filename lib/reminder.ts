// One local daily reminder (FR-N1).
//
// Deliberately the smallest thing that works: OFF by default, one time of day,
// scheduled by the OS on this device. There is no push server, no device token,
// no remote trigger — nothing about the reminder ever reaches Supabase.
//
// Privacy: the notification body is fixed copy. Habit names and journal text
// are end-to-end encrypted, and a notification payload sits in the OS in
// plaintext, so **no user content may ever go into `content`**. Not a habit
// name, not a streak count, not a date.
//
// Tone: the app rejects guilt mechanics, so the copy never counts what you
// missed, never says "don't break the chain", and never nags twice.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// New protocol string, new suffix — existing `banana_*` keys are never renamed.
const STORAGE_KEY = "banana_reminder_v1";

// A fixed identifier means "re-schedule" is always replace-one, never
// accumulate-many, even if a write is interrupted halfway.
const REMINDER_ID = "banana_reminder_v1_daily";
const ANDROID_CHANNEL_ID = "banana_reminder_v1";

/**
 * What the reminder says. Fixed, gentle, and free of any user data — an
 * invitation, not a scoreboard.
 */
const REMINDER_TITLE = "Aight Bet";
const REMINDER_BODY = "A quiet minute for today, whenever you're ready.";

/**
 * Tell the OS how to present the reminder if the app happens to be open.
 * Call once, at the root layout. Banner + list, no badge — a count on the
 * icon is a debt, and this app doesn't keep score.
 */
export function configureReminders(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export interface ReminderPref {
  /** Off until the user says otherwise. Never opt someone in. */
  enabled: boolean;
  /** Local time of day, 24h. */
  hour: number;
  minute: number;
}

/** 8:00 PM — evening, after the day has happened, not a morning to-do. */
export const DEFAULT_REMINDER: ReminderPref = {
  enabled: false,
  hour: 20,
  minute: 0,
};

/**
 * Why a sync didn't end up scheduling anything. The UI turns each of these
 * into a calm line of copy — none of them are errors the user caused.
 */
export type ReminderStatus =
  /** A daily reminder is live at the saved time. */
  | "scheduled"
  /** Nothing is scheduled, because nothing should be. */
  | "off"
  /** Notifications are denied at the OS level — needs a trip to Settings. */
  | "denied"
  /** No habits yet, so there's nothing to be reminded about. */
  | "no-habits";

let cached: ReminderPref | null = null;

function normalise(raw: unknown): ReminderPref {
  const p = raw as Partial<ReminderPref> | null;
  if (!p || typeof p !== "object") return { ...DEFAULT_REMINDER };
  const hour = Number.isInteger(p.hour) && p.hour! >= 0 && p.hour! <= 23
    ? p.hour!
    : DEFAULT_REMINDER.hour;
  const minute = Number.isInteger(p.minute) && p.minute! >= 0 && p.minute! <= 59
    ? p.minute!
    : DEFAULT_REMINDER.minute;
  return { enabled: p.enabled === true, hour, minute };
}

/** Read the preference — memory first, then disk. Never throws. */
export async function loadReminder(): Promise<ReminderPref> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = normalise(raw ? JSON.parse(raw) : null);
  } catch (e) {
    if (__DEV__) console.warn("[reminder] read failed:", e);
    cached = { ...DEFAULT_REMINDER };
  }
  return cached;
}

/** Persist the preference. Memory updates now; disk is fire-and-forget. */
export function saveReminder(pref: ReminderPref): void {
  cached = { ...pref };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
}

/** Forget the preference (account deletion / local purge). */
export async function clearReminder(): Promise<void> {
  cached = null;
  await cancelReminder();
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/**
 * Ask for permission, but only when the user has just asked to be reminded.
 * Returns false for "denied" — the caller shows the explainer, never an alert.
 */
export async function requestReminderPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    // iOS only shows the system sheet once ever; after that this resolves
    // immediately with the standing answer.
    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch (e) {
    if (__DEV__) console.warn("[reminder] permission check failed:", e);
    return false;
  }
}

/** Drop any scheduled reminder. Safe to call when nothing is scheduled. */
export async function cancelReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch (e) {
    // Cancelling something that isn't there is a no-op, not a failure.
    if (__DEV__) console.warn("[reminder] cancel failed:", e);
  }
}

/**
 * Make the OS match the saved preference: exactly one daily notification when
 * it's on and earned, none otherwise.
 *
 * `hasHabits` is required rather than optional — a reminder with nothing to
 * remind you about is just noise, so the caller has to answer the question.
 * Never asks for permission; call `requestReminderPermission` first.
 */
export async function syncReminder(
  pref: ReminderPref,
  hasHabits: boolean,
): Promise<ReminderStatus> {
  if (!pref.enabled) {
    await cancelReminder();
    return "off";
  }
  if (!hasHabits) {
    await cancelReminder();
    return "no-habits";
  }

  let granted = false;
  try {
    granted = (await Notifications.getPermissionsAsync()).granted;
  } catch (e) {
    if (__DEV__) console.warn("[reminder] permission read failed:", e);
  }
  if (!granted) {
    await cancelReminder();
    return "denied";
  }

  try {
    if (Platform.OS === "android") {
      // Android needs a channel before anything can be delivered.
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Daily reminder",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    // Replace rather than add — same identifier every time.
    await cancelReminder();
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        // No badge: a number on the icon is a debt, and this app doesn't keep
        // score. No `data` either — nothing to carry.
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        channelId: ANDROID_CHANNEL_ID,
        hour: pref.hour,
        minute: pref.minute,
      },
    });
    return "scheduled";
  } catch (e) {
    if (__DEV__) console.warn("[reminder] schedule failed:", e);
    return "denied";
  }
}

/** "8:00 PM" — the one place the reminder time gets formatted. */
export function formatReminderTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
