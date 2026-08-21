// Pure, deterministic stats over already-decrypted HabitLog[].
// No React / network / storage / crypto — just math over plain data.
// `today` is always passed in (never Date.now()) so results are reproducible.
//
// THREE RULES THIS ENGINE ENFORCES EVERYWHERE (bug D13):
//
// 1. ELIGIBILITY — a habit is only scored from the day it was created. Rating
//    a habit created on the 20th against all 30 days of the month tells the
//    user they failed 19 days they never agreed to. The denominator is always
//    "days you had committed to this habit", never "days on the calendar".
// 2. NO FUTURE — a log dated tomorrow (clock skew, a mis-tapped cell, a synced
//    device in another zone) must never inflate a total, a streak, an active
//    day or a rate. Every aggregate clamps at `today`.
// 3. NO ORPHANS — logs whose habit has been deleted are filtered out whenever
//    the caller hands us the current habit set. Deleting a habit must not
//    leave ghost completions in the aggregates.
//
// Pass `habits` in the `StatsScope` to get all three; omit it and you get the
// raw log math (used only where the habit set genuinely isn't known).

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
  /** Lifetime days where every *eligible* habit was completed (FR-G1). */
  perfectDays: number;
}

/**
 * What a stat is measured over.
 * - `habitId` — restrict to one habit; omit for "any habit" aggregates.
 * - `habits` — the CURRENT habit set. Supplying it turns on eligibility
 *   windows (per-habit `createdAt`) and drops logs from deleted habits.
 */
export interface StatsScope {
  habitId?: string;
  habits?: Habit[];
}

// "YYYY-MM-DD" -> UTC day index (days since epoch). Returns NaN for anything
// that isn't a real calendar date. Date.parse alone normalizes overflow
// ("2026-02-30" -> Mar 2), so we require strict YYYY-MM-DD and verify the
// parsed date round-trips to the same components — rejecting overflow and
// non-leap-year Feb 29.
//
// NOTE: the UTC round-trip here is deliberate — it yields a stable, DST-proof
// integer index. Inputs are already uniform LOCAL day keys from lib/dates.ts,
// so no timezone conversion happens; this is pure integer indexing.
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

const MS_PER_DAY = 86_400_000;

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Reverse of dayIndex: UTC day index -> "YYYY-MM-DD".
function ymdFromIndex(idx: number): string {
  const d = new Date(idx * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** "YYYY-MM-DD" -> stable integer day index (NaN if not a real date). */
export function dayIndexOf(date: string): number {
  return dayIndex(date);
}

/** Integer day index -> "YYYY-MM-DD". Inverse of `dayIndexOf`. */
export function dayKeyFromIndex(idx: number): string {
  return ymdFromIndex(idx);
}

// ---------------------------------------------------------------------------
// Eligibility (rule 1 + rule 3)
// ---------------------------------------------------------------------------

// A habit's `createdAt` is an ISO instant ("2026-06-20T09:12:00.000Z") in real
// data and a bare day key in fixtures/tests — both start with the day.
function dayPart(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

/** Resolved eligibility for one habit set. */
interface Eligibility {
  /** habitId -> first day index the habit can be scored on. */
  start: Map<string, number>;
  /** Known habit ids, or null when the caller gave us no habit set. */
  ids: Set<string> | null;
  /** Earliest start across the set (the overall window), or null. */
  earliest: number | null;
}

const NO_START = Number.NEGATIVE_INFINITY;

/**
 * First scorable day per habit:
 * `min(createdAt, first ever completion)` — a log older than the recorded
 * creation date (device clocks, a UTC `createdAt` read in a western zone)
 * still proves commitment, so it opens the window rather than being scored as
 * impossible. A habit with neither a usable `createdAt` nor any log is
 * eligible from today only — it can't retroactively drag old months down.
 */
function buildEligibility(
  logs: HabitLog[],
  todayIdx: number,
  habits?: Habit[],
): Eligibility {
  if (!habits) return { start: new Map(), ids: null, earliest: null };

  const firstLog = new Map<string, number>();
  for (const log of logs) {
    if (!log.completed) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d)) continue;
    const prev = firstLog.get(log.habitId);
    if (prev === undefined || d < prev) firstLog.set(log.habitId, d);
  }

  const start = new Map<string, number>();
  const ids = new Set<string>();
  let earliest: number | null = null;
  for (const h of habits) {
    ids.add(h.id);
    const created = dayIndex(dayPart(h.createdAt));
    const seen = firstLog.get(h.id);
    let s: number;
    if (!Number.isNaN(created) && seen !== undefined) s = Math.min(created, seen);
    else if (!Number.isNaN(created)) s = created;
    else if (seen !== undefined) s = seen;
    else s = todayIdx;
    start.set(h.id, s);
    if (earliest === null || s < earliest) earliest = s;
  }
  return { start, ids, earliest };
}

// First scorable day for the scope: one habit's window, or the earliest window
// across the set. `NO_START` when the caller gave no habit set (no clamping).
function scopeStart(elig: Eligibility, habitId?: string): number {
  if (elig.ids === null) return NO_START;
  if (habitId) return elig.start.get(habitId) ?? NO_START;
  return elig.earliest ?? NO_START;
}

// How many habits were eligible on a given day index.
function eligibleOn(habits: Habit[], elig: Eligibility, idx: number): number {
  let n = 0;
  for (const h of habits) {
    const s = elig.start.get(h.id);
    if (s !== undefined && s <= idx) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Day sets (rule 2 + rule 3 applied at the source)
// ---------------------------------------------------------------------------

/**
 * Distinct completed day indices, ascending. Never includes a day after
 * `maxIdx` (rule 2) and never includes a deleted habit's logs when `ids` is
 * given (rule 3).
 */
function completedDays(
  logs: HabitLog[],
  maxIdx: number,
  habitId?: string,
  ids?: Set<string> | null,
): number[] {
  const days = new Set<number>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (habitId && log.habitId !== habitId) continue;
    if (ids && !ids.has(log.habitId)) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d) || d > maxIdx) continue;
    days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

// Set form of `completedDays`, for O(1) membership tests.
function daySet(
  logs: HabitLog[],
  maxIdx: number,
  habitId?: string,
  ids?: Set<string> | null,
): Set<number> {
  return new Set(completedDays(logs, maxIdx, habitId, ids));
}

// dayIdx -> distinct habit ids completed that day (clamped + orphan-filtered).
function habitsByDay(
  logs: HabitLog[],
  maxIdx: number,
  ids?: Set<string> | null,
): Map<number, Set<string>> {
  const byDay = new Map<number, Set<string>>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (ids && !ids.has(log.habitId)) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d) || d > maxIdx) continue;
    let s = byDay.get(d);
    if (!s) {
      s = new Set();
      byDay.set(d, s);
    }
    s.add(log.habitId);
  }
  return byDay;
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
  const todayIdx = dayIndex(today);
  const days = Number.isNaN(todayIdx)
    ? []
    : completedDays(logs, todayIdx, habitId);
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

/**
 * Roll per-habit stats up. Pass `habits` (the current set) so logs from
 * deleted habits stay out of `activeDays` and perfect days can be counted.
 */
export function computeOverallStats(
  stats: HabitStats[],
  logs: HabitLog[],
  today: string,
  habits?: Habit[],
): OverallStats {
  let totalCompletions = 0;
  let bestCurrentStreak = 0;
  let bestLongestStreak = 0;
  for (const s of stats) {
    totalCompletions += s.totalCompletions;
    if (s.currentStreak > bestCurrentStreak) bestCurrentStreak = s.currentStreak;
    if (s.longestStreak > bestLongestStreak) bestLongestStreak = s.longestStreak;
  }

  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) {
    return {
      totalCompletions,
      bestCurrentStreak,
      bestLongestStreak,
      activeDays: 0,
      perfectDays: 0,
    };
  }

  const ids = habits ? new Set(habits.map((h) => h.id)) : null;
  return {
    totalCompletions,
    bestCurrentStreak,
    bestLongestStreak,
    activeDays: daySet(logs, todayIdx, undefined, ids).size,
    perfectDays: habits ? perfectDayIndices(habits, logs, today).length : 0,
  };
}

// ---------------------------------------------------------------------------
// Analytics dashboard math. All pure + deterministic; `today` / `asOf` are
// always passed in. Levels are 0..3 for the crosshatch heatmap; rates are 0..1
// fractions; trend deltas are percentage points.
// ---------------------------------------------------------------------------

export type HeatLevel = 0 | 1 | 2 | 3;
/** One day in the heatmap. `inLongest` marks the all-time longest run (glow). */
export interface HeatCell {
  date: string; // "YYYY-MM-DD"
  level: HeatLevel;
  inLongest: boolean;
  /** Every eligible habit completed that day (FR-G1) — the darkest cell. */
  perfect: boolean;
  /** False before any habit existed — drawn as "not yet yours", not a miss. */
  eligible: boolean;
  /**
   * Single-habit only: how deep into a streak this day was, 0..1, on a smooth
   * curve rather than the three buckets `level` gives. Three steps meant day 3
   * and day 7 of a run looked identical while day 4 jumped — the grid showed
   * plateaus the streak never had. Absent on the all-habits view, where `level`
   * means share-of-habits and has real steps.
   */
  intensity?: number;
}
/** One point of a completion-rate series (for the sparkline). */
export interface RatePoint {
  label: string; // 3-letter month ("Jun") or day-of-month ("14")
  rate: number; // 0..1
  /** Eligible days behind the point — 0 means "nothing to score yet". */
  days: number;
}
/** This-month vs last-month completion rate. `delta` is in percentage points. */
export interface TrendResult {
  current: number; // 0..1
  previous: number; // 0..1
  delta: number; // (current - previous) * 100
}
export interface StreakRange {
  startDate: string;
  endDate: string;
  length: number;
}
/** Inputs to the templated "your story" insight. */
export interface InsightParts {
  bestDow: number | null; // 0=Sun..6=Sat
  weekendDrop: boolean;
  currentStreak: number;
  longestStreak: number;
  trendDelta: number; // percentage points vs last month
  hadComeback: boolean;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

// Day-of-week for a UTC day index. 0=Sunday..6=Saturday (matches getUTCDay).
function dowFromIndex(idx: number): number {
  return (((idx % 7) + 4) % 7 + 7) % 7;
}

// Number of days in a 1-based month.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseYMD(date: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

// Longest consecutive run as index range (first occurrence). null if empty.
function longestRunRange(
  sortedDays: number[],
): { startIdx: number; endIdx: number; length: number } | null {
  if (sortedDays.length === 0) return null;
  let bestStart = sortedDays[0];
  let bestEnd = sortedDays[0];
  let bestLen = 1;
  let curStart = sortedDays[0];
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    if (sortedDays[i] === sortedDays[i - 1] + 1) {
      run++;
    } else {
      run = 1;
      curStart = sortedDays[i];
    }
    if (run > bestLen) {
      bestLen = run;
      bestStart = curStart;
      bestEnd = sortedDays[i];
    }
  }
  return { startIdx: bestStart, endIdx: bestEnd, length: bestLen };
}

/** Completed days over eligible days for one month. */
export interface MonthCompletion {
  done: number;
  /** Eligible days in the month — 0 means the habit didn't exist yet. */
  days: number;
  rate: number; // 0..1, 0 when days === 0
}

/**
 * Completion for one month. The denominator is ELIGIBLE days only:
 *
 *     eligible = [ max(month start, habit created) … min(month end, asOf) ]
 *
 * so a habit created on the 20th is scored out of the days since the 20th, and
 * no month is ever scored past today. With `scope.habitId` it's that habit;
 * otherwise it's the share of days with any completion, eligible from the
 * earliest habit's creation. Months entirely before creation report 0 days.
 */
export function completionForMonth(
  logs: HabitLog[],
  year: number,
  month: number,
  asOf: string,
  scope: StatsScope = {},
): MonthCompletion {
  const monthStart = dayIndex(`${year}-${pad2(month)}-01`);
  const asOfIdx = dayIndex(asOf);
  if (Number.isNaN(monthStart) || Number.isNaN(asOfIdx)) {
    return { done: 0, days: 0, rate: 0 };
  }
  const elig = buildEligibility(logs, asOfIdx, scope.habits);
  const start = Math.max(monthStart, scopeStart(elig, scope.habitId));
  const end = Math.min(monthStart + daysInMonth(year, month) - 1, asOfIdx);
  if (end < start) return { done: 0, days: 0, rate: 0 };
  const set = daySet(logs, asOfIdx, scope.habitId, elig.ids);
  let done = 0;
  for (let i = start; i <= end; i++) if (set.has(i)) done++;
  const days = end - start + 1;
  return { done, days, rate: done / days };
}

/** Completion rate for one month, 0..1. See `completionForMonth`. */
export function completionRateForMonth(
  logs: HabitLog[],
  year: number,
  month: number,
  asOf: string,
  scope: StatsScope = {},
): number {
  return completionForMonth(logs, year, month, asOf, scope).rate;
}

/** This-month vs last-month completion rate (delta in percentage points). */
export function monthOverMonthTrend(
  logs: HabitLog[],
  today: string,
  scope: StatsScope = {},
): TrendResult {
  const t = parseYMD(today);
  if (!t) return { current: 0, previous: 0, delta: 0 };
  const current = completionRateForMonth(logs, t.year, t.month, today, scope);
  let py = t.year;
  let pm = t.month - 1;
  if (pm <= 0) {
    pm += 12;
    py -= 1;
  }
  const prevAsOf = ymdFromIndex(
    dayIndex(`${py}-${pad2(pm)}-01`) + daysInMonth(py, pm) - 1,
  );
  const previous = completionRateForMonth(logs, py, pm, prevAsOf, scope);
  return { current, previous, delta: (current - previous) * 100 };
}

/** Last `n` months of completion rate, oldest → newest (for the sparkline). */
export function monthlyRateSeries(
  logs: HabitLog[],
  today: string,
  n = 6,
  scope: StatsScope = {},
): RatePoint[] {
  const t = parseYMD(today);
  if (!t) return [];
  const out: RatePoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let y = t.year;
    let m = t.month - i;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const asOf =
      i === 0
        ? today
        : ymdFromIndex(dayIndex(`${y}-${pad2(m)}-01`) + daysInMonth(y, m) - 1);
    const c = completionForMonth(logs, y, m, asOf, scope);
    out.push({ label: MONTHS[m - 1], rate: c.rate, days: c.days });
  }
  return out;
}

export type ProgressMode = "month" | "year";

export interface ProgressSeries {
  points: RatePoint[];
  mode: ProgressMode;
  /** Months of history. Below `MIN_PROGRESS_MONTHS` there is nothing to compare. */
  historyMonths: number;
  /** Whether the yearly view has two calendar years to put side by side. */
  yearlyAvailable: boolean;
}

/** A rolling year is as far back as the monthly view goes. */
export const MAX_PROGRESS_MONTHS = 12;
/** One month is a reading, not a comparison — a chart needs two. */
export const MIN_PROGRESS_MONTHS = 2;
/** Absolute ceiling on how far back to look. 20 years is nobody's habit app. */
const MAX_HISTORY_MONTHS = 240;

/** Months from the first thing this user ever recorded to now, inclusive. */
function historyMonthsOf(
  logs: HabitLog[],
  today: string,
  scope: StatsScope,
): number {
  const t = parseYMD(today);
  if (!t) return 1;
  const nowIdx = t.year * 12 + (t.month - 1);
  let earliest = nowIdx;

  const consider = (date: string | undefined) => {
    if (!date) return;
    const p = parseYMD(date.slice(0, 10));
    if (!p) return;
    const idx = p.year * 12 + (p.month - 1);
    if (idx < earliest) earliest = idx;
  };

  for (const habit of scope.habits ?? []) {
    if (scope.habitId && habit.id !== scope.habitId) continue;
    consider(habit.createdAt);
  }
  for (const log of logs) {
    if (!log.completed) continue;
    if (scope.habitId && log.habitId !== scope.habitId) continue;
    consider(log.date);
  }
  return Math.min(nowIdx - earliest + 1, MAX_HISTORY_MONTHS);
}

/** Weighted mean of a run of points — `days` is the weight, never the count. */
function mergePoints(chunk: RatePoint[], label: string): RatePoint {
  let days = 0;
  let done = 0;
  for (const p of chunk) {
    days += p.days;
    done += p.rate * p.days;
  }
  return { label, rate: days > 0 ? done / days : 0, days };
}

/**
 * The Progress series, in one of exactly two shapes.
 *
 * Monthly is the default and stops at a rolling twelve — more than that and the
 * bars thin to hairlines and the dots collide. Yearly has no ceiling: a year
 * per bar stays readable for as long as anyone will use this.
 *
 * Years are whole calendar years, never a floating twelve-month window ending
 * today: "2025 vs 2024" is a comparison someone can reason about, "the twelve
 * months to last August" is not.
 */
export function progressSeries(
  logs: HabitLog[],
  today: string,
  scope: StatsScope = {},
  mode: ProgressMode = "month",
): ProgressSeries {
  const t = parseYMD(today);
  const months = Math.max(1, historyMonthsOf(logs, today, scope));
  const startIdx = t ? t.year * 12 + (t.month - 1) - (months - 1) : 0;
  const yearsSpanned = t ? t.year - Math.floor(startIdx / 12) + 1 : 1;
  const yearlyAvailable = yearsSpanned >= 2;

  const base = { historyMonths: months, yearlyAvailable };
  if (!t) return { points: [], mode: "month", ...base };

  if (mode === "year" && yearlyAvailable) {
    // Reach back to January of the first year so every bar is a whole year.
    const n = Math.min((t.month - 1) + (yearsSpanned - 1) * 12 + 1, MAX_HISTORY_MONTHS);
    const monthly = monthlyRateSeries(logs, today, n, scope);
    const firstYear = t.year - (yearsSpanned - 1);
    const points: RatePoint[] = [];
    for (let i = 0; i < monthly.length; i += 12) {
      points.push(
        mergePoints(monthly.slice(i, i + 12), String(firstYear + i / 12)),
      );
    }
    return { points, mode: "year", ...base };
  }

  return {
    points: monthlyRateSeries(
      logs,
      today,
      Math.min(months, MAX_PROGRESS_MONTHS),
      scope,
    ),
    mode: "month",
    ...base,
  };
}

/**
 * Last `days` days as a daily series, oldest → newest. Each point is the share
 * of that day's ELIGIBLE habits that were completed (0 or 1 for a single
 * habit). Powers the sparkline when the user picks the short range.
 */
export function dailyRateSeries(
  logs: HabitLog[],
  today: string,
  days = 30,
  scope: StatsScope = {},
): RatePoint[] {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx) || days <= 0) return [];
  const habits = scope.habits ?? [];
  const elig = buildEligibility(logs, todayIdx, scope.habits);
  const byDay = habitsByDay(logs, todayIdx, elig.ids);
  const single = scope.habitId;
  const out: RatePoint[] = [];
  for (let i = todayIdx - days + 1; i <= todayIdx; i++) {
    const done = byDay.get(i);
    let rate = 0;
    let eligible = 0;
    if (single) {
      eligible = (elig.start.get(single) ?? NO_START) <= i ? 1 : 0;
      rate = done?.has(single) ? 1 : 0;
    } else {
      eligible = scope.habits ? eligibleOn(habits, elig, i) : 1;
      rate = eligible > 0 ? Math.min(1, (done?.size ?? 0) / eligible) : 0;
    }
    out.push({
      label: String(Number(ymdFromIndex(i).slice(8))),
      rate,
      days: eligible > 0 ? 1 : 0,
    });
  }
  return out;
}

/**
 * How dark a day in a streak should be, 0..1.
 *
 * Saturating rather than linear: the difference between day 1 and day 5 is
 * what the eye should notice, and by three weeks in it barely matters whether
 * it's 21 or 40 — a linear ramp would spend most of its range on lengths
 * almost nobody reaches. Day one already starts visibly filled, because a day
 * you did is never nothing.
 */
export function streakIntensity(run: number): number {
  if (run <= 0) return 0;
  const FLOOR = 0.26;
  // e-folding over ~9 days: ~54% of the way up by a week, ~90% by three.
  return FLOOR + (1 - FLOOR) * (1 - Math.exp(-run / 9));
}

/**
 * Heatmap cells for the last `rangeDays` ending today. Per-habit (`habitId`)
 * level reflects streak strength at that day; overall level reflects how many
 * of that day's ELIGIBLE habits were completed. `inLongest` marks the
 * per-habit all-time longest run so the UI can glow it; `perfect` marks a day
 * where every eligible habit was done (FR-G1).
 */
export function heatmapCells(
  logs: HabitLog[],
  today: string,
  rangeDays: number,
  opts: StatsScope & { totalHabits?: number } = {},
): HeatCell[] {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return [];
  const { habitId, habits, totalHabits = 1 } = opts;
  const start = todayIdx - rangeDays + 1;
  const elig = buildEligibility(logs, todayIdx, habits);
  const counts = habitsByDay(logs, todayIdx, elig.ids);
  const perfect = habits
    ? new Set(perfectDayIndices(habits, logs, today))
    : new Set<number>();

  const range = habitId
    ? longestRunRange(completedDays(logs, todayIdx, habitId))
    : null;

  // Seed the running per-habit streak with completions just before the window.
  let run = 0;
  if (habitId) {
    const set = daySet(logs, todayIdx, habitId);
    let k = start - 1;
    while (set.has(k)) {
      run++;
      k--;
    }
  }

  const from = scopeStart(elig, habitId);
  const cells: HeatCell[] = [];
  for (let i = start; i <= todayIdx; i++) {
    const day = counts.get(i);
    const done = habitId ? (day?.has(habitId) ? 1 : 0) : (day?.size ?? 0);
    let level: HeatLevel = 0;
    let intensity: number | undefined;
    if (habitId) {
      run = done > 0 ? run + 1 : 0;
      level = run === 0 ? 0 : run >= 8 ? 3 : run >= 4 ? 2 : 1;
      intensity = streakIntensity(run);
    } else {
      const denom = habits ? eligibleOn(habits, elig, i) : totalHabits;
      const ratio = denom > 0 ? done / denom : 0;
      level = done === 0 ? 0 : ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
    }
    cells.push({
      date: ymdFromIndex(i),
      level,
      intensity,
      inLongest: range ? i >= range.startIdx && i <= range.endIdx : false,
      perfect: !habitId && perfect.has(i),
      eligible: i >= from,
    });
  }
  return cells;
}

/** One habit's week in the grid. */
export interface WeekCell {
  /** Days completed in that week. */
  done: number;
  /** Days of that week the habit actually existed. 0 = before it started. */
  eligible: number;
}

export interface WeekRow {
  habitId: string;
  name: string;
  /** Same length and order as `WeeklyTimeline.weeks`. */
  cells: WeekCell[];
  /** Completed / eligible across the whole window, 0..1. */
  rate: number;
}

export interface WeeklyTimeline {
  /** First day of each bucket, oldest → newest, as day keys. */
  weeks: string[];
  rows: WeekRow[];
  /** What one column means. Weeks until the history is long, then months. */
  bucket: "week" | "month";
}

/**
 * Past this many weeks the grid switches to one column per month.
 *
 * Scrolling is fine for a season and absurd for three years — at ~31pt a
 * column, two years of weeks is nine screens wide. Coarsening the bucket keeps
 * the squares big (which is the whole point) and keeps the history on a couple
 * of screens, instead of shrinking cells back to unreadable.
 */
const MAX_WEEK_COLUMNS = 40;

// Epoch day 0 (1970-01-01) was a Thursday, so Monday falls on idx % 7 === 4.
function mondayOf(idx: number): number {
  return idx - ((((idx - 4) % 7) + 7) % 7);
}

/**
 * Habits down the side, weeks across — from the week the user started to this
 * one.
 *
 * This replaced an aggregated day heatmap. That grid could show *that* a
 * stretch went badly but never *which* habit went badly, which is the only
 * question worth asking. Weeks rather than days because a phone cannot show
 * months of individual days at a size anyone can read, and the window runs
 * from the real start rather than a fixed six months so it never shows empty
 * time that was never yours.
 */
export function habitWeeklyTimeline(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): WeeklyTimeline {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx) || habits.length === 0) {
    return { weeks: [], rows: [], bucket: "week" };
  }
  const elig = buildEligibility(logs, todayIdx, habits);
  const earliest = elig.earliest ?? todayIdx;

  const firstMonday = mondayOf(Math.min(earliest, todayIdx));
  const lastMonday = mondayOf(todayIdx);
  const weekCount = Math.floor((lastMonday - firstMonday) / 7) + 1;

  // Long history: one column per calendar month instead of per week.
  if (weekCount > MAX_WEEK_COLUMNS) {
    return monthlyTimeline(habits, logs, elig, Math.min(earliest, todayIdx), todayIdx);
  }

  const weeks: string[] = [];
  for (let w = 0; w < weekCount; w++) {
    weeks.push(ymdFromIndex(firstMonday + w * 7));
  }

  // Completed (habit, day) pairs once, rather than rescanning per habit.
  const done = new Set<string>();
  for (const log of logs) {
    if (!log.completed) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d) || d > todayIdx || d < firstMonday) continue;
    done.add(`${log.habitId}:${d}`);
  }

  const rows: WeekRow[] = habits.map((habit) => {
    const from = elig.start.get(habit.id) ?? todayIdx;
    const cells: WeekCell[] = [];
    let totalEligible = 0;
    let totalDone = 0;

    for (let w = 0; w < weekCount; w++) {
      const weekStart = firstMonday + w * 7;
      let cellDone = 0;
      let cellEligible = 0;
      for (let d = weekStart; d < weekStart + 7; d++) {
        // The future isn't a miss, and neither is time before the habit existed.
        if (d > todayIdx || d < from) continue;
        cellEligible++;
        if (done.has(`${habit.id}:${d}`)) cellDone++;
      }
      cells.push({ done: cellDone, eligible: cellEligible });
      totalEligible += cellEligible;
      totalDone += cellDone;
    }

    return {
      habitId: habit.id,
      name: habit.name,
      cells,
      rate: totalEligible > 0 ? totalDone / totalEligible : 0,
    };
  });

  return { weeks, rows, bucket: "week" };
}

/** Same grid, one column per calendar month. Used once history outgrows weeks. */
function monthlyTimeline(
  habits: Habit[],
  logs: HabitLog[],
  elig: Eligibility,
  startIdx: number,
  todayIdx: number,
): WeeklyTimeline {
  // Bucket boundaries by calendar month, so columns line up with the labels.
  const starts: number[] = [];
  const first = new Date(startIdx * MS_PER_DAY);
  const cursor = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1),
  );
  const endIdx = todayIdx;
  while (true) {
    const idx = Math.floor(cursor.getTime() / MS_PER_DAY);
    if (idx > endIdx) break;
    starts.push(idx);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  if (starts.length === 0) return { weeks: [], rows: [], bucket: "month" };

  const done = new Set<string>();
  for (const log of logs) {
    if (!log.completed) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d) || d > todayIdx || d < starts[0]) continue;
    done.add(`${log.habitId}:${d}`);
  }

  const rows: WeekRow[] = habits.map((habit) => {
    const from = elig.start.get(habit.id) ?? todayIdx;
    const cells: WeekCell[] = [];
    let totalEligible = 0;
    let totalDone = 0;

    starts.forEach((bucketStart, i) => {
      const bucketEnd = i + 1 < starts.length ? starts[i + 1] - 1 : todayIdx;
      let cellDone = 0;
      let cellEligible = 0;
      for (let d = bucketStart; d <= bucketEnd; d++) {
        if (d > todayIdx || d < from) continue;
        cellEligible++;
        if (done.has(`${habit.id}:${d}`)) cellDone++;
      }
      cells.push({ done: cellDone, eligible: cellEligible });
      totalEligible += cellEligible;
      totalDone += cellDone;
    });

    return {
      habitId: habit.id,
      name: habit.name,
      cells,
      rate: totalEligible > 0 ? totalDone / totalEligible : 0,
    };
  });

  return { weeks: starts.map(ymdFromIndex), rows, bucket: "month" };
}

/** The all-time longest streak as a date range, for a single habit. */
export function longestStreakRange(
  logs: HabitLog[],
  habitId: string,
  today: string,
): StreakRange | null {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return null;
  const r = longestRunRange(completedDays(logs, todayIdx, habitId));
  if (!r) return null;
  return {
    startDate: ymdFromIndex(r.startIdx),
    endDate: ymdFromIndex(r.endIdx),
    length: r.length,
  };
}

/** Days the current streak needs to match the record (0 if at/above it). */
export function daysToRecord(currentStreak: number, longestStreak: number): number {
  if (currentStreak <= 0 || currentStreak >= longestStreak) return 0;
  return longestStreak - currentStreak;
}

/** Weekday (0=Sun..6=Sat) with the most completions, or null if none. */
export function bestDayOfWeek(
  logs: HabitLog[],
  today: string,
  scope: StatsScope = {},
): { dow: number; count: number } | null {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return null;
  const elig = buildEligibility(logs, todayIdx, scope.habits);
  const set = daySet(logs, todayIdx, scope.habitId, elig.ids);
  if (set.size === 0) return null;
  const counts = new Array(7).fill(0) as number[];
  for (const idx of set) counts[dowFromIndex(idx)]++;
  let best = 0;
  for (let i = 1; i < 7; i++) if (counts[i] > counts[best]) best = i;
  return { dow: best, count: counts[best] };
}

/**
 * Weekday vs weekend completion rate over the last `rangeDays` ending today.
 * Only eligible days count on either side.
 */
export function weekendComparison(
  logs: HabitLog[],
  today: string,
  rangeDays: number,
  scope: StatsScope = {},
): { weekdayRate: number; weekendRate: number } {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return { weekdayRate: 0, weekendRate: 0 };
  const elig = buildEligibility(logs, todayIdx, scope.habits);
  const from = Math.max(todayIdx - rangeDays + 1, scopeStart(elig, scope.habitId));
  const set = daySet(logs, todayIdx, scope.habitId, elig.ids);
  let wdDone = 0;
  let wdTot = 0;
  let weDone = 0;
  let weTot = 0;
  for (let i = from; i <= todayIdx; i++) {
    const dow = dowFromIndex(i);
    const isWeekend = dow === 0 || dow === 6;
    const done = set.has(i) ? 1 : 0;
    if (isWeekend) {
      weTot++;
      weDone += done;
    } else {
      wdTot++;
      wdDone += done;
    }
  }
  return {
    weekdayRate: wdTot ? wdDone / wdTot : 0,
    weekendRate: weTot ? weDone / weTot : 0,
  };
}

/**
 * True if there was a recent gap followed by a fresh run of >= `minRun` ending
 * today/yesterday — i.e. the user "bounced back" after nearly breaking the chain.
 */
export function hadRecentComeback(
  logs: HabitLog[],
  today: string,
  scope: StatsScope = {},
  minRun = 3,
): boolean {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return false;
  const elig = buildEligibility(logs, todayIdx, scope.habits);
  const set = daySet(logs, todayIdx, scope.habitId, elig.ids);
  const last = set.has(todayIdx)
    ? todayIdx
    : set.has(todayIdx - 1)
      ? todayIdx - 1
      : NaN;
  if (Number.isNaN(last)) return false;
  let runStart = last;
  while (set.has(runStart - 1)) runStart--;
  if (last - runStart + 1 < minRun) return false;
  // a gap exists immediately before the run; require an earlier completion.
  for (let i = runStart - 2; i >= runStart - 60; i--) {
    if (set.has(i)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// FR-G1 — perfect days
// ---------------------------------------------------------------------------

/**
 * Day indices where EVERY habit eligible that day was completed. Eligibility
 * is what makes this fair: on the day you added your third habit, only the two
 * you already had are required. Never counts a future day, and never counts a
 * day with no eligible habits.
 */
export function perfectDayIndices(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): number[] {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx) || habits.length === 0) return [];
  const elig = buildEligibility(logs, todayIdx, habits);
  const byDay = habitsByDay(logs, todayIdx, elig.ids);
  const out: number[] = [];
  for (const [idx, done] of byDay) {
    const need = eligibleOn(habits, elig, idx);
    if (need > 0 && done.size >= need) out.push(idx);
  }
  return out.sort((a, b) => a - b);
}

/** Perfect days as day keys, oldest → newest. */
export function perfectDays(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): string[] {
  return perfectDayIndices(habits, logs, today).map(ymdFromIndex);
}

// ---------------------------------------------------------------------------
// FR-AN2 — habit comparison
// ---------------------------------------------------------------------------

/** One habit's standing this month, for the comparison bars. */
export interface HabitComparisonRow {
  habitId: string;
  name: string;
  rate: number; // 0..1 over eligible days this month
  done: number;
  days: number; // eligible days — 0 means "brand new, nothing to score"
  currentStreak: number;
}

/**
 * Every habit ranked by this month's completion rate, best → worst, so the one
 * that's slipping is impossible to miss. Ties break on the longer streak, then
 * name, so the order is stable between renders.
 */
export function habitComparison(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
): HabitComparisonRow[] {
  const t = parseYMD(today);
  if (!t) return [];
  return habits
    .map((h) => {
      const c = completionForMonth(logs, t.year, t.month, today, {
        habitId: h.id,
        habits,
      });
      return {
        habitId: h.id,
        name: h.name,
        rate: c.rate,
        done: c.done,
        days: c.days,
        currentStreak: computeHabitStats(h.id, logs, today).currentStreak,
      };
    })
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        b.currentStreak - a.currentStreak ||
        a.name.localeCompare(b.name),
    );
}

// ---------------------------------------------------------------------------
// FR-AN3 — consistency score
// ---------------------------------------------------------------------------

/** A 0-100 consistency score plus everything needed to explain it in the UI. */
export interface ConsistencyResult {
  score: number; // 0..100
  windowDays: number; // days considered
  newestWeight: number; // weight of today
  oldestWeight: number; // weight of the oldest day in the window
  daysCounted: number; // days with at least one eligible habit
}

/**
 * Consistency over the last `windowDays` days, recency-weighted:
 *
 *     score    = 100 × Σ(weight_d × rate_d) / Σ(weight_d)
 *     rate_d   = habits completed that day / habits ELIGIBLE that day
 *     weight_d = 3 today, falling linearly to 1 at the oldest day
 *
 * Days with no eligible habit are skipped entirely (weight 0) so a new user
 * isn't scored on days before they had any habits. The UI renders this same
 * sentence from the returned numbers — an invented metric has to be legible.
 */
export function consistencyScore(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
  windowDays = 30,
): ConsistencyResult {
  const base: ConsistencyResult = {
    score: 0,
    windowDays,
    newestWeight: 3,
    oldestWeight: 1,
    daysCounted: 0,
  };
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx) || habits.length === 0 || windowDays <= 0) return base;

  const elig = buildEligibility(logs, todayIdx, habits);
  const byDay = habitsByDay(logs, todayIdx, elig.ids);
  const span = Math.max(1, windowDays - 1);
  let num = 0;
  let den = 0;
  let counted = 0;
  for (let age = 0; age < windowDays; age++) {
    const idx = todayIdx - age;
    const need = eligibleOn(habits, elig, idx);
    if (need === 0) continue;
    const rate = Math.min(1, (byDay.get(idx)?.size ?? 0) / need);
    const weight =
      base.oldestWeight +
      (base.newestWeight - base.oldestWeight) * (1 - Math.min(1, age / span));
    num += weight * rate;
    den += weight;
    counted++;
  }
  return {
    ...base,
    score: den > 0 ? Math.round((num / den) * 100) : 0,
    daysCounted: counted,
  };
}

// ---------------------------------------------------------------------------
// FR-AN4 — habit correlation
// ---------------------------------------------------------------------------

/** "You complete `habitId` on `rate` of the days you also do `withHabitId`." */
export interface HabitCorrelation {
  habitId: string;
  withHabitId: string;
  rate: number; // P(habit | withHabit), 0..1
  sample: number; // days `withHabit` was done inside the shared window
  baseline: number; // habit's own rate over the same window
  lift: number; // rate - baseline
}

/** Guard rails so a coincidence never gets presented as a pattern. */
export interface CorrelationOptions {
  /** Minimum days the anchor habit was done before we'll claim anything. */
  minSample?: number;
  /** Minimum conditional rate. */
  minRate?: number;
  /** How far the pair must beat the habit's own baseline. */
  minLift?: number;
  /** Max pairs returned. */
  limit?: number;
}

/**
 * Pairwise correlations over the shared eligible window of each pair (both
 * habits had to exist for a day to mean anything). A pair is only reported
 * when it clears all three guard rails — enough sample, a high enough
 * conditional rate, and a real lift over the habit's own baseline — and at
 * most `limit` pairs come back, because a wall of near-noise "insights" is
 * worse than silence.
 */
export function habitCorrelations(
  habits: Habit[],
  logs: HabitLog[],
  today: string,
  opts: CorrelationOptions = {},
): HabitCorrelation[] {
  const { minSample = 5, minRate = 0.6, minLift = 0.15, limit = 3 } = opts;
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx) || habits.length < 2) return [];

  const elig = buildEligibility(logs, todayIdx, habits);
  const sets = new Map<string, Set<number>>();
  for (const h of habits) sets.set(h.id, daySet(logs, todayIdx, h.id, elig.ids));

  const best = new Map<string, HabitCorrelation>();
  for (const a of habits) {
    for (const b of habits) {
      if (a.id === b.id) continue;
      const aSet = sets.get(a.id);
      const bSet = sets.get(b.id);
      if (!aSet || !bSet) continue;
      const from = Math.max(
        elig.start.get(a.id) ?? NO_START,
        elig.start.get(b.id) ?? NO_START,
      );
      if (!Number.isFinite(from)) continue;
      const windowDays = todayIdx - from + 1;
      if (windowDays < minSample) continue;

      let sample = 0;
      let both = 0;
      let aDays = 0;
      for (let i = from; i <= todayIdx; i++) {
        const aDone = aSet.has(i);
        if (aDone) aDays++;
        if (!bSet.has(i)) continue;
        sample++;
        if (aDone) both++;
      }
      if (sample < minSample) continue;
      const rate = both / sample;
      const baseline = aDays / windowDays;
      const lift = rate - baseline;
      if (rate < minRate || lift < minLift) continue;

      // One claim per unordered pair — keep the stronger direction.
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      const found: HabitCorrelation = {
        habitId: a.id,
        withHabitId: b.id,
        rate,
        sample,
        baseline,
        lift,
      };
      const prev = best.get(key);
      if (
        !prev ||
        found.lift > prev.lift ||
        (found.lift === prev.lift && found.sample > prev.sample)
      ) {
        best.set(key, found);
      }
    }
  }

  return [...best.values()]
    .sort((x, y) => y.lift - x.lift || y.sample - x.sample)
    .slice(0, limit);
}

/**
 * Build one warm, honest "your story" line from the computed parts. `angleIndex`
 * rotates through the applicable angles so the insight feels fresh each visit.
 * Never shaming — frames misses as comebacks, not failures.
 */
export function buildInsight(parts: InsightParts, angleIndex = 0): string {
  const lines: string[] = [];
  if (parts.bestDow !== null) {
    lines.push(`You're most consistent on ${WEEKDAYS[parts.bestDow]}s.`);
  }
  if (parts.weekendDrop) {
    lines.push(`Weekends are where your streaks slip — worth a gentle nudge.`);
  }
  if (parts.currentStreak > 0 && parts.longestStreak > parts.currentStreak) {
    const d = parts.longestStreak - parts.currentStreak;
    lines.push(`You're ${d} day${d === 1 ? "" : "s"} from beating your record.`);
  }
  if (parts.currentStreak > 0 && parts.currentStreak === parts.longestStreak) {
    lines.push(`This is the steadiest you've ever been. Keep going.`);
  }
  if (parts.trendDelta >= 5) {
    lines.push(`You're up ${Math.round(parts.trendDelta)}% on last month — your best stretch yet.`);
  }
  if (parts.hadComeback) {
    lines.push(`You almost broke the chain recently, then bounced right back.`);
  }
  if (lines.length === 0) {
    return `Every day you log is one day closer to who you're becoming.`;
  }
  return lines[((angleIndex % lines.length) + lines.length) % lines.length];
}
