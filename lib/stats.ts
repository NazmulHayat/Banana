// Pure, deterministic stats over already-decrypted HabitLog[].
// No React / network / storage / crypto — just math over plain data.
// `today` is always passed in (never Date.now()) so results are reproducible.

import type { Habit, HabitLog } from "@/lib/db";

/** Per-habit completion stats. `today` is "YYYY-MM-DD". */
export interface HabitStats {
  habitId: string;
  totalCompletions: number; // count of distinct days with a completed log (deduped per date)
  currentStreak: number; // consecutive days ending today (or yesterday) with completed
  longestStreak: number; // longest run of consecutive completed days, ever
}

export interface OverallStats {
  totalCompletions: number;
  bestCurrentStreak: number;
  bestLongestStreak: number;
  activeDays: number;
}

// "YYYY-MM-DD" -> UTC day index (days since epoch). Returns NaN for anything
// that isn't a real calendar date. Date.parse alone normalizes overflow
// ("2026-02-30" -> Mar 2), so we require strict YYYY-MM-DD and verify the
// parsed date round-trips to the same components — rejecting overflow and
// non-leap-year Feb 29.
function dayIndex(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return NaN;
  const d = new Date(ms);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return NaN;
  }
  return Math.floor(ms / 86_400_000);
}

/** Distinct, valid day indices (ascending) for completed logs of one habit. */
function completedDayIndices(habitId: string, logs: HabitLog[]): number[] {
  const days = new Set<number>();
  for (const log of logs) {
    if (log.habitId !== habitId || !log.completed) continue;
    const d = dayIndex(log.date);
    if (!Number.isNaN(d)) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

// Longest run of consecutive day indices in an ascending, de-duped array.
function longestRun(sortedDays: number[]): number {
  if (sortedDays.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    if (sortedDays[i] === sortedDays[i - 1] + 1) {
      run++;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
  }
  return longest;
}

// Current streak: only counts if the most recent completed day is today or
// yesterday, then walks backwards over consecutive days.
function currentRun(sortedDays: number[], todayIdx: number): number {
  if (sortedDays.length === 0 || Number.isNaN(todayIdx)) return 0;
  const last = sortedDays[sortedDays.length - 1];
  if (last !== todayIdx && last !== todayIdx - 1) return 0;
  let streak = 1;
  for (let i = sortedDays.length - 2; i >= 0; i--) {
    if (sortedDays[i] === sortedDays[i + 1] - 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function computeHabitStats(
  habitId: string,
  logs: HabitLog[],
  today: string,
): HabitStats {
  const days = completedDayIndices(habitId, logs);
  const todayIdx = dayIndex(today);
  return {
    habitId,
    totalCompletions: days.length,
    currentStreak: currentRun(days, todayIdx),
    longestStreak: longestRun(days),
  };
}

export function computeAllHabitStats(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): HabitStats[] {
  return habits.map((h) => computeHabitStats(h.id, logs, today));
}

export function computeOverallStats(
  stats: HabitStats[],
  logs: HabitLog[],
): OverallStats {
  let totalCompletions = 0;
  let bestCurrentStreak = 0;
  let bestLongestStreak = 0;
  for (const s of stats) {
    totalCompletions += s.totalCompletions;
    if (s.currentStreak > bestCurrentStreak) bestCurrentStreak = s.currentStreak;
    if (s.longestStreak > bestLongestStreak) bestLongestStreak = s.longestStreak;
  }

  // Distinct calendar dates with at least one completion across all habits.
  const activeDates = new Set<number>();
  for (const log of logs) {
    if (!log.completed) continue;
    const d = dayIndex(log.date);
    if (!Number.isNaN(d)) activeDates.add(d);
  }

  return {
    totalCompletions,
    bestCurrentStreak,
    bestLongestStreak,
    activeDays: activeDates.size,
  };
}
