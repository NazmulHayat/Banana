// Local daily reminders (FR-N1).
//
// Up to three times a day, scheduled by the OS on this device. There is no
// push server, no device token, no remote trigger — nothing about a reminder
// ever reaches Supabase.
//
// Privacy: a notification payload sits in the OS in plaintext and shows on the
// lock screen. Habit names and journal text are end-to-end encrypted, so **no
// stored user content may ever be put into `content`** — not a habit name, not
// an entry, not a streak count. The one exception is the custom message, which
// the user typed *for* this purpose knowing where it appears; it is never
// pre-filled from their data, and it never leaves the device.
//
// Tone: the app rejects guilt mechanics, so the copy asks about today rather
// than counting what was missed. It never says "don't break the chain".

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// New protocol string, new suffix — existing `banana_*` keys are never renamed.
const STORAGE_KEY = "banana_reminder_v1";

// One fixed identifier per slot means "re-schedule" is always replace, never
// accumulate, even if a write is interrupted halfway.
const SLOT_ID_PREFIX = "banana_reminder_v1_daily";
/** What a single-time reminder was scheduled under before slots existed. */
const LEGACY_SLOT_ID = "banana_reminder_v1_daily";
const ANDROID_CHANNEL_ID = "banana_reminder_v1";

/** At most three a day. More than that is nagging, which is the one thing this feature must not do. */
export const MAX_REMINDERS = 3;

/** Long enough for a real sentence, short enough to survive a lock screen. */
export const MESSAGE_MAX_LENGTH = 90;

const REMINDER_TITLE = "Aight Bet";

/**
 * The standard message. It has one job: make coming back feel like a small,
 * specific thing rather than a chore.
 *
 * It asks a question (something to answer, not a task to dread), names both
 * actions so there's no guessing what "open the app" means, and sets the bar
 * at *one line* so a tired evening still clears it. What it deliberately does
 * not do is count: no streak, no "you missed two days", no habit names.
 */
export const STANDARD_MESSAGE =
  "How did today go? Tick your habits and write one line.";

/**
 * Tell the OS how to present a reminder if the app happens to be open.
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

/** One local time of day, 24h. */
export interface ReminderTime {
  hour: number;
  minute: number;
}

export interface ReminderPref {
  /** Off until the user says otherwise. Never opt someone in. */
  enabled: boolean;
  /** 1 to `MAX_REMINDERS` times, de-duplicated and sorted earliest first. */
  times: ReminderTime[];
  /** User-authored copy, or `null` to use `STANDARD_MESSAGE`. */
  message: string | null;
}

/** 8:00 PM — evening, after the day has happened, not a morning to-do. */
export const DEFAULT_REMINDER: ReminderPref = {
  enabled: false,
  times: [{ hour: 20, minute: 0 }],
  message: null,
};

/**
 * Why a sync didn't end up scheduling anything. The UI turns each of these
 * into a calm line of copy — none of them are errors the user caused.
 */
export type ReminderStatus =
  /** Reminders are live at the saved times. */
  | "scheduled"
  /** Nothing is scheduled, because nothing should be. */
  | "off"
  /** Notifications are denied at the OS level — needs a trip to Settings. */
  | "denied"
  /** No habits yet, so there's nothing to be reminded about. */
  | "no-habits";

let cached: ReminderPref | null = null;

function clonePref(pref: ReminderPref): ReminderPref {
  return {
    enabled: pref.enabled,
    times: pref.times.map((t) => ({ ...t })),
    message: pref.message,
  };
}

/** Minutes since midnight — the sort key and the dedupe key for a time. */
export function minutesOfDay(time: ReminderTime): number {
  return time.hour * 60 + time.minute;
}

function readTime(raw: unknown): ReminderTime | null {
  if (!raw || typeof raw !== "object") return null;
  const { hour, minute } = raw as { hour?: unknown; minute?: unknown };
  const validHour =
    typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23;
  const validMinute =
    typeof minute === "number" &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59;
  if (!validHour || !validMinute) return null;
  return { hour, minute };
}

/**
 * De-duplicate, sort and cap. Two reminders at the same minute would schedule
 * one notification and leave a phantom row in the UI, so the same time can
 * never appear twice.
 */
export function tidyTimes(times: ReminderTime[]): ReminderTime[] {
  const seen = new Set<number>();
  const unique: ReminderTime[] = [];
  for (const t of times) {
    const key = minutesOfDay(t);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...t });
  }
  unique.sort((a, b) => minutesOfDay(a) - minutesOfDay(b));
  return unique.slice(0, MAX_REMINDERS);
}

/** Collapse whitespace and clamp length. Newlines can't survive a notification body. */
export function tidyMessage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX_LENGTH);
}

function normalise(raw: unknown): ReminderPref {
  if (!raw || typeof raw !== "object") return clonePref(DEFAULT_REMINDER);
  const p = raw as {
    enabled?: unknown;
    times?: unknown;
    message?: unknown;
    hour?: unknown;
    minute?: unknown;
  };

  let times: ReminderTime[] = [];
  if (Array.isArray(p.times)) {
    times = tidyTimes(
      p.times
        .map(readTime)
        .filter((t): t is ReminderTime => t !== null),
    );
  } else {
    // Saved before multiple times existed: one flat `hour`/`minute` pair.
    // Carry it forward rather than resetting someone's chosen time.
    const legacy = readTime({ hour: p.hour, minute: p.minute });
    if (legacy) times = [legacy];
  }
  if (times.length === 0) times = DEFAULT_REMINDER.times.map((t) => ({ ...t }));

  const message =
    typeof p.message === "string" && tidyMessage(p.message).length > 0
      ? tidyMessage(p.message)
      : null;

  return { enabled: p.enabled === true, times, message };
}

/** Read the preference — memory first, then disk. Never throws. */
export async function loadReminder(): Promise<ReminderPref> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    cached = normalise(raw ? JSON.parse(raw) : null);
  } catch (e) {
    if (__DEV__) console.warn("[reminder] read failed:", e);
    cached = clonePref(DEFAULT_REMINDER);
  }
  return cached;
}

/** Persist the preference. Memory updates now; disk is fire-and-forget. */
export function saveReminder(pref: ReminderPref): void {
  cached = clonePref(pref);
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

/**
 * Drop every scheduled reminder, including the one a pre-slots version of the
 * app left behind. Safe to call when nothing is scheduled.
 */
export async function cancelReminder(): Promise<void> {
  const ids = [
    LEGACY_SLOT_ID,
    ...Array.from({ length: MAX_REMINDERS }, (_, i) => `${SLOT_ID_PREFIX}_${i}`),
  ];
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch (e) {
      // Cancelling something that isn't there is a no-op, not a failure.
      if (__DEV__) console.warn("[reminder] cancel failed:", e);
    }
  }
}

/** What the notification will actually say, standard copy or the user's own. */
export function reminderBody(pref: ReminderPref): string {
  return pref.message ?? STANDARD_MESSAGE;
}

/**
 * Make the OS match the saved preference: one daily notification per saved
 * time when reminders are on and earned, none otherwise.
 *
 * `hasHabits` is required rather than optional — a reminder with nothing to
 * remind you about is just noise, so the caller has to answer the question.
 * Never asks for permission; call `requestReminderPermission` first.
 */
export async function syncReminder(
  pref: ReminderPref,
  hasHabits: boolean,
): Promise<ReminderStatus> {
  if (!pref.enabled || pref.times.length === 0) {
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
    // Clear every slot first, so dropping from three times to one doesn't
    // leave the third still firing.
    await cancelReminder();
    const times = tidyTimes(pref.times);
    const body = reminderBody(pref);
    for (let i = 0; i < times.length; i++) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${SLOT_ID_PREFIX}_${i}`,
        content: {
          title: REMINDER_TITLE,
          body,
          // No badge: a number on the icon is a debt, and this app doesn't
          // keep score. No `data` either — nothing to carry.
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          channelId: ANDROID_CHANNEL_ID,
          hour: times[i].hour,
          minute: times[i].minute,
        },
      });
    }
    return "scheduled";
  } catch (e) {
    if (__DEV__) console.warn("[reminder] schedule failed:", e);
    return "denied";
  }
}

/** "8:00 PM" — the one place a reminder time gets formatted. */
export function formatReminderTime(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** One line of plain English for the Profile row and the toggle subtitle. */
export function describeReminder(pref: ReminderPref): string {
  if (!pref.enabled || pref.times.length === 0) return "Off";
  const labels = pref.times.map((t) => formatReminderTime(t.hour, t.minute));
  if (labels.length === 1) return `Every day at ${labels[0]}`;
  const last = labels[labels.length - 1];
  return `Every day at ${labels.slice(0, -1).join(", ")} and ${last}`;
}
