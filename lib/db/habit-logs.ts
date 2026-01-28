import { isSupabaseConfigured, supabase, SUPABASE_URL } from "../supabase";
import { sessionManager } from "./session-manager";
import { DateFormats } from "./schema";
import type { HabitLog } from "./types";

function getLogDayBucket(habitId: string, date: string): string {
  return `${habitId}:${date}`;
}

function getMonthBucket(date: string): string {
  return date.slice(0, 7);
}

export async function toggleHabitLog(
  habitId: string,
  date: string,
  currentCompleted?: boolean,
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const userId = await sessionManager.getUserId();
  const accessToken = await sessionManager.getAccessToken();
  const dayBucket = getLogDayBucket(habitId, date);
  const monthBucket = getMonthBucket(date);

  // Fast path: if caller knows current state, just flip it
  let completed: boolean;
  if (typeof currentCompleted === "boolean") {
    completed = !currentCompleted;
  } else {
    // Fallback: check current value from DB (plaintext)
    const { data: existing } = await supabase
      .from("habit_logs")
      .select("completed")
      .eq("owner_id", userId)
      .eq("day_bucket", dayBucket)
      .maybeSingle();

    if (existing) {
      completed = !existing.completed;
    } else {
      completed = true;
    }
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/encrypt-and-save`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        table: "habit_logs",
        data: { habitId, date, completed },
        owner_id: userId,
        day_bucket: dayBucket,
        month_bucket: monthBucket,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save habit log");
  }
}

export async function setHabitLog(
  habitId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const userId = await sessionManager.getUserId();
  const accessToken = await sessionManager.getAccessToken();
  const dayBucket = getLogDayBucket(habitId, date);
  const monthBucket = getMonthBucket(date);

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/encrypt-and-save`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        table: "habit_logs",
        data: { habitId, date, completed },
        owner_id: userId,
        day_bucket: dayBucket,
        month_bucket: monthBucket,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save habit log");
  }
}

export async function getHabitLogsForMonth(
  year: number,
  month: number,
): Promise<HabitLog[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    const monthBucket = DateFormats.formatYearMonth(year, month);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=habit_logs&owner_id=${userId}&month_bucket=${monthBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return [];

    const { data } = await response.json();
    return (data || []).map((item: any) => ({
      habitId: item.habitId,
      date: item.date,
      completed: item.completed,
    }));
  } catch {
    return [];
  }
}

export async function getHabitLog(
  habitId: string,
  date: string,
): Promise<HabitLog | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const userId = await sessionManager.getUserId();
    const accessToken = await sessionManager.getAccessToken();
    const dayBucket = getLogDayBucket(habitId, date);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/fetch-and-decrypt?table=habit_logs&owner_id=${userId}&day_bucket=${dayBucket}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) return null;
    const { data } = await response.json();
    if (!data?.[0]) return null;

    const item = data[0];
    return {
      habitId: item.habitId,
      date: item.date,
      completed: item.completed,
    };
  } catch {
    return null;
  }
}

export async function deleteLogsForHabit(_habitId: string): Promise<void> {}

export async function deleteAllHabitLogs(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const userId = await sessionManager.getUserId();
    await supabase.from("habit_logs").delete().eq("owner_id", userId);
  } catch {}
}
