// Calm gamification — FR-G2 (records board) + FR-G3 (permanent stamps).
//
// THE RULE (PRODUCT.md): streaks punish you for stopping; stamps reward you
// for having done it. Gamify against your past self, permanently, never
// punitively — NOTHING CAN EVER BE LOST. So:
//
// - Every stamp is derived from a BEST-EVER value (longest streak, lifetime
//   entry count, lifetime perfect days). Breaking a streak can never revoke a
//   stamp, because the value a stamp reads is monotonic by construction.
// - Every record is beaten or tied, never taken away: the record always
//   includes the current period, so "current" can equal it but never exceed
//   it, and the distance marker is how far you are from your own best.
//
// Derived on read, never stored: no new table, no new encrypted type, no
// migration. The log/entry set is already in memory (lib/use-recent-logs.ts).
// Pure + deterministic, `today` passed in — same contract as lib/stats.ts.

import type { DailyEntry, Habit, HabitLog } from "@/lib/db";
import { computeJournalStats } from "./journal-stats";
import {
  completionForMonth,
  computeAllHabitStats,
  dayIndexOf,
  dayKeyFromIndex,
  perfectDayIndices,
} from "./stats";

// ---------------------------------------------------------------------------
// Shared input
// ---------------------------------------------------------------------------

export interface GamificationInput {
  habits: Habit[];
  logs: HabitLog[];
  entries: DailyEntry[];
  today: string; // "YYYY-MM-DD"
}

// Ascending, de-duped completed day indices for one habit, never past today.
function habitDays(logs: HabitLog[], habitId: string, todayIdx: number): number[] {
  const days = new Set<number>();
  for (const log of logs) {
    if (!log.completed || log.habitId !== habitId) continue;
    const d = dayIndexOf(log.date);
    if (Number.isNaN(d) || d > todayIdx) continue;
    days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

// The day index where a run of `n` consecutive days was FIRST completed, or
// null if it never was. This is the "earned on" date — it is history, so it
// can never move once it has happened.
function firstRunOf(sorted: number[], n: number): number | null {
  if (n <= 0 || sorted.length === 0) return null;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run >= n) return sorted[i];
  }
  return null;
}

function longestRunOf(sorted: number[]): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return longest;
}

// Month keys ("YYYY-MM") present in the data, plus the current month, so the
// records board always compares against every period the user has lived.
function monthKeys(input: GamificationInput): string[] {
  const keys = new Set<string>([input.today.slice(0, 7)]);
  const todayIdx = dayIndexOf(input.today);
  for (const log of input.logs) {
    if (!log.completed) continue;
    const d = dayIndexOf(log.date);
    if (Number.isNaN(d) || d > todayIdx) continue;
    keys.add(log.date.slice(0, 7));
  }
  for (const entry of input.entries) {
    const d = dayIndexOf(entry.date);
    if (Number.isNaN(d) || d > todayIdx) continue;
    keys.add(entry.date.slice(0, 7));
  }
  return [...keys].sort();
}

// Last day of a month key, clamped to today (the "as of" for that month).
function monthAsOf(key: string, today: string): string {
  if (key === today.slice(0, 7)) return today;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// FR-G2 — records board
// ---------------------------------------------------------------------------

export type RecordKey =
  | "longestStreak"
  | "bestMonth"
  | "mostHabitsInADay"
  | "longestJournalRun"
  | "mostPhotosInAMonth"
  | "mostPerfectDaysInAMonth";

export type RecordUnit = "days" | "percent" | "habits" | "photos" | "entries";

/** One beatable personal record: where you are, your best, and the gap. */
export interface PersonalRecord {
  key: RecordKey;
  /** Where you stand right now (today / this month). */
  current: number;
  /** Your best ever — includes the current period, so it can be tied. */
  record: number;
  unit: RecordUnit;
  /** Context for the record, e.g. "Mar 2026". Empty when there isn't one. */
  detail: string;
  /** Current ties or beats the record (and a record exists at all). */
  atRecord: boolean;
  /** How far the current value is from the record. 0 when at it. */
  distance: number;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function labelForMonth(key: string): string {
  const idx = Number(key.slice(5, 7)) - 1;
  return `${MONTH_LABELS[idx] ?? key.slice(5, 7)} ${key.slice(0, 4)}`;
}

// Assemble one record. The record value always includes `current`, so the
// board can say "tied" but never "lost".
function makeRecord(
  key: RecordKey,
  current: number,
  best: number,
  unit: RecordUnit,
  detail = "",
): PersonalRecord {
  const record = Math.max(best, current);
  return {
    key,
    current,
    record,
    unit,
    detail,
    atRecord: record > 0 && current >= record,
    distance: Math.max(0, record - current),
  };
}

/**
 * The six beatable records. Every stat on the analysis screen becomes a
 * personal best you can tie or beat — and nothing else. There is no "lost"
 * state anywhere in this function.
 */
export function computeRecords(input: GamificationInput): PersonalRecord[] {
  const { habits, logs, entries, today } = input;
  const todayIdx = dayIndexOf(today);
  if (Number.isNaN(todayIdx)) return [];

  const stats = computeAllHabitStats(habits, logs, today);
  const bestCurrentStreak = stats.reduce((m, s) => Math.max(m, s.currentStreak), 0);
  const bestLongestStreak = stats.reduce((m, s) => Math.max(m, s.longestStreak), 0);

  // Habits completed per day (current habits only — deleted ones leave no ghosts).
  const known = new Set(habits.map((h) => h.id));
  const perDay = new Map<number, Set<string>>();
  for (const log of logs) {
    if (!log.completed || !known.has(log.habitId)) continue;
    const d = dayIndexOf(log.date);
    if (Number.isNaN(d) || d > todayIdx) continue;
    let set = perDay.get(d);
    if (!set) {
      set = new Set();
      perDay.set(d, set);
    }
    set.add(log.habitId);
  }
  const todayHabits = perDay.get(todayIdx)?.size ?? 0;
  let bestDayCount = 0;
  let bestDayIdx: number | null = null;
  for (const [idx, set] of perDay) {
    if (set.size > bestDayCount) {
      bestDayCount = set.size;
      bestDayIdx = idx;
    }
  }

  const journal = computeJournalStats(entries, today);
  const perfect = new Set(perfectDayIndices(habits, logs, today));
  const months = monthKeys(input);
  const currentMonthKey = today.slice(0, 7);

  let bestRate = 0;
  let bestRateMonth = "";
  let bestPerfect = 0;
  let bestPerfectMonth = "";
  let currentRate = 0;
  let currentPerfect = 0;
  for (const key of months) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    const c = completionForMonth(logs, year, month, monthAsOf(key, today), { habits });
    const rate = c.days > 0 ? Math.round(c.rate * 100) : 0;
    let perfectCount = 0;
    for (const idx of perfect) if (dayKeyFromIndex(idx).slice(0, 7) === key) perfectCount++;
    if (key === currentMonthKey) {
      currentRate = rate;
      currentPerfect = perfectCount;
    }
    if (rate > bestRate) {
      bestRate = rate;
      bestRateMonth = key;
    }
    if (perfectCount > bestPerfect) {
      bestPerfect = perfectCount;
      bestPerfectMonth = key;
    }
  }

  const photoMonths = journal.photosByMonth;
  const currentPhotos =
    photoMonths.find((m) => m.key === currentMonthKey)?.count ?? 0;
  const bestPhotoMonth = photoMonths.reduce<{ key: string; count: number }>(
    (best, m) => (m.count > best.count ? { key: m.key, count: m.count } : best),
    { key: "", count: 0 },
  );

  return [
    makeRecord("longestStreak", bestCurrentStreak, bestLongestStreak, "days"),
    makeRecord(
      "bestMonth",
      currentRate,
      bestRate,
      "percent",
      bestRateMonth ? labelForMonth(bestRateMonth) : "",
    ),
    makeRecord(
      "mostHabitsInADay",
      todayHabits,
      bestDayCount,
      "habits",
      bestDayIdx !== null ? dayKeyFromIndex(bestDayIdx) : "",
    ),
    makeRecord(
      "longestJournalRun",
      journal.currentStreak,
      journal.longestStreak,
      "days",
    ),
    makeRecord(
      "mostPhotosInAMonth",
      currentPhotos,
      bestPhotoMonth.count,
      "photos",
      bestPhotoMonth.key ? labelForMonth(bestPhotoMonth.key) : "",
    ),
    makeRecord(
      "mostPerfectDaysInAMonth",
      currentPerfect,
      bestPerfect,
      "days",
      bestPerfectMonth ? labelForMonth(bestPerfectMonth) : "",
    ),
  ];
}

// ---------------------------------------------------------------------------
// FR-G3 — permanent stamps
// ---------------------------------------------------------------------------

export type StampKind = "streak" | "journal" | "perfect-week" | "perfect-days";

/**
 * A stamp is a fact about your past. `earned` is derived from a BEST-EVER
 * value, so it survives a broken streak, a deleted month of motivation, and
 * anything else — that retention is the entire mechanic.
 */
export interface Stamp {
  /** Stable id: "streak:<habitId>:7", "journal:10", "perfect-week:7". */
  id: string;
  kind: StampKind;
  /** What it takes to earn it (7 days, 10 entries, 50 perfect days…). */
  threshold: number;
  /** The habit it belongs to, for per-habit streak stamps. */
  habitId?: string;
  habitName?: string;
  earned: boolean;
  /** Day key the threshold was first met. History — it never moves. */
  earnedOn: string | null;
  /** Best-ever value behind the stamp. Monotonic: it never falls. */
  best: number;
  /** `best / threshold`, capped at 1. */
  progress: number;
}

/** Streak stamps every habit can earn. */
export const STREAK_THRESHOLDS = [7, 30, 100, 365] as const;
/** Journal stamps: the first entry, then ten. */
export const JOURNAL_THRESHOLDS = [1, 10] as const;
/** A perfect week is seven perfect days in a row. */
export const PERFECT_WEEK = 7;
/** Fifty perfect days, lifetime. */
export const PERFECT_DAYS_MILESTONE = 50;

function stamp(
  id: string,
  kind: StampKind,
  threshold: number,
  best: number,
  earnedOn: string | null,
  habit?: Habit,
): Stamp {
  const earned = best >= threshold;
  return {
    id,
    kind,
    threshold,
    habitId: habit?.id,
    habitName: habit?.name,
    earned,
    earnedOn: earned ? earnedOn : null,
    best,
    progress: threshold > 0 ? Math.min(1, best / threshold) : 0,
  };
}

/**
 * The whole stamp catalogue, earned and unearned, in display order:
 * per-habit streaks (7/30/100/365), the journal stamps (first entry, 10
 * entries), a perfect week, and 50 perfect days.
 *
 * Every `earned` flag reads a best-ever value — longest streak, lifetime entry
 * count, longest perfect run, lifetime perfect days — so a stamp earned in
 * March is still earned after you miss all of April. Nothing here can be lost.
 */
export function computeStamps(input: GamificationInput): Stamp[] {
  const { habits, logs, entries, today } = input;
  const todayIdx = dayIndexOf(today);
  if (Number.isNaN(todayIdx)) return [];

  const out: Stamp[] = [];

  for (const habit of habits) {
    const days = habitDays(logs, habit.id, todayIdx);
    const best = longestRunOf(days);
    for (const threshold of STREAK_THRESHOLDS) {
      const at = firstRunOf(days, threshold);
      out.push(
        stamp(
          `streak:${habit.id}:${threshold}`,
          "streak",
          threshold,
          best,
          at === null ? null : dayKeyFromIndex(at),
          habit,
        ),
      );
    }
  }

  // Journal stamps count entries, not days — the Nth entry ever written.
  const written = entries
    .filter((e) => {
      const d = dayIndexOf(e.date);
      return !Number.isNaN(d) && d <= todayIdx;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  for (const threshold of JOURNAL_THRESHOLDS) {
    const nth = written[threshold - 1];
    out.push(
      stamp(
        `journal:${threshold}`,
        "journal",
        threshold,
        written.length,
        nth ? nth.date : null,
      ),
    );
  }

  const perfect = perfectDayIndices(habits, logs, today);
  const weekAt = firstRunOf(perfect, PERFECT_WEEK);
  out.push(
    stamp(
      `perfect-week:${PERFECT_WEEK}`,
      "perfect-week",
      PERFECT_WEEK,
      longestRunOf(perfect),
      weekAt === null ? null : dayKeyFromIndex(weekAt),
    ),
  );
  const fiftieth = perfect[PERFECT_DAYS_MILESTONE - 1];
  out.push(
    stamp(
      `perfect-days:${PERFECT_DAYS_MILESTONE}`,
      "perfect-days",
      PERFECT_DAYS_MILESTONE,
      perfect.length,
      fiftieth === undefined ? null : dayKeyFromIndex(fiftieth),
    ),
  );

  return out;
}

/** Earned stamps only, newest earn first — the wall worth looking at. */
export function earnedStamps(stamps: Stamp[]): Stamp[] {
  return stamps
    .filter((s) => s.earned)
    .sort((a, b) => (b.earnedOn ?? "").localeCompare(a.earnedOn ?? ""));
}

/**
 * The closest unearned stamps, nearest first — "what's next", never a scold.
 * Only stamps with some progress qualify, so a brand-new user isn't shown a
 * wall of zeroes.
 */
export function nextStamps(stamps: Stamp[], limit = 3): Stamp[] {
  return stamps
    .filter((s) => !s.earned && s.best > 0)
    .sort((a, b) => b.progress - a.progress || a.threshold - b.threshold)
    .slice(0, limit);
}
