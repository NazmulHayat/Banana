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

// ---------------------------------------------------------------------------
// Analytics dashboard math (Tight 4 + upgrades). All pure + deterministic;
// `today` / `asOf` are always passed in. Levels are 0..3 for the crosshatch
// heatmap; rates are 0..1 fractions; trend deltas are percentage points.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

export type HeatLevel = 0 | 1 | 2 | 3;
/** One day in the heatmap. `inLongest` marks the all-time longest run (glow). */
export interface HeatCell {
  date: string; // "YYYY-MM-DD"
  level: HeatLevel;
  inLongest: boolean;
}
/** One point of the monthly completion-rate series (for the sparkline). */
export interface RatePoint {
  label: string; // 3-letter month, e.g. "Jun"
  rate: number; // 0..1
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

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Reverse of dayIndex: UTC day index -> "YYYY-MM-DD".
function ymdFromIndex(idx: number): string {
  const d = new Date(idx * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

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

// Distinct completed day indices. With `habitId`, only that habit; otherwise
// the union across all habits (an "active day" is any habit completed).
function daySet(logs: HabitLog[], habitId?: string): Set<number> {
  const days = new Set<number>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (habitId && log.habitId !== habitId) continue;
    const d = dayIndex(log.date);
    if (!Number.isNaN(d)) days.add(d);
  }
  return days;
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

/**
 * Completion rate for one month, 0..1 — completed days / elapsed days. For the
 * current month it counts only days up to `asOf`; past months count the full
 * month. With `habitId` it's that habit; otherwise share of days with any
 * completion. Future months return 0.
 */
export function completionRateForMonth(
  logs: HabitLog[],
  year: number,
  month: number,
  asOf: string,
  habitId?: string,
): number {
  const start = dayIndex(`${year}-${pad2(month)}-01`);
  const asOfIdx = dayIndex(asOf);
  if (Number.isNaN(start) || Number.isNaN(asOfIdx)) return 0;
  const monthEnd = start + daysInMonth(year, month) - 1;
  const end = Math.min(monthEnd, asOfIdx);
  if (end < start) return 0;
  const set = daySet(logs, habitId);
  let done = 0;
  for (let i = start; i <= end; i++) if (set.has(i)) done++;
  return done / (end - start + 1);
}

/** This-month vs last-month completion rate (delta in percentage points). */
export function monthOverMonthTrend(
  logs: HabitLog[],
  today: string,
  habitId?: string,
): TrendResult {
  const t = parseYMD(today);
  if (!t) return { current: 0, previous: 0, delta: 0 };
  const current = completionRateForMonth(logs, t.year, t.month, today, habitId);
  let py = t.year;
  let pm = t.month - 1;
  if (pm <= 0) {
    pm += 12;
    py -= 1;
  }
  const prevAsOf = ymdFromIndex(
    dayIndex(`${py}-${pad2(pm)}-01`) + daysInMonth(py, pm) - 1,
  );
  const previous = completionRateForMonth(logs, py, pm, prevAsOf, habitId);
  return { current, previous, delta: (current - previous) * 100 };
}

/** Last `n` months of completion rate, oldest → newest (for the sparkline). */
export function monthlyRateSeries(
  logs: HabitLog[],
  today: string,
  n = 6,
  habitId?: string,
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
    out.push({ label: MONTHS[m - 1], rate: completionRateForMonth(logs, y, m, asOf, habitId) });
  }
  return out;
}

/**
 * Heatmap cells for the last `rangeDays` ending today. Per-habit (`habitId`)
 * level reflects streak strength at that day; overall level reflects how many
 * of `totalHabits` were completed that day. `inLongest` marks the per-habit
 * all-time longest run so the UI can glow it.
 */
export function heatmapCells(
  logs: HabitLog[],
  today: string,
  rangeDays: number,
  opts: { habitId?: string; totalHabits?: number } = {},
): HeatCell[] {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return [];
  const { habitId, totalHabits = 1 } = opts;
  const start = todayIdx - rangeDays + 1;

  // dayIdx -> distinct habit ids completed that day
  const counts = new Map<number, Set<string>>();
  for (const log of logs) {
    if (!log.completed) continue;
    if (habitId && log.habitId !== habitId) continue;
    const d = dayIndex(log.date);
    if (Number.isNaN(d) || d < start || d > todayIdx) continue;
    let s = counts.get(d);
    if (!s) {
      s = new Set();
      counts.set(d, s);
    }
    s.add(log.habitId);
  }

  const range = habitId
    ? longestRunRange([...daySet(logs, habitId)].sort((a, b) => a - b))
    : null;

  // Seed the running per-habit streak with completions just before the window.
  let run = 0;
  if (habitId) {
    const set = daySet(logs, habitId);
    let k = start - 1;
    while (set.has(k)) {
      run++;
      k--;
    }
  }

  const cells: HeatCell[] = [];
  for (let i = start; i <= todayIdx; i++) {
    const done = counts.get(i)?.size ?? 0;
    let level: HeatLevel = 0;
    if (habitId) {
      run = done > 0 ? run + 1 : 0;
      level = run === 0 ? 0 : run >= 8 ? 3 : run >= 4 ? 2 : 1;
    } else {
      const ratio = totalHabits > 0 ? done / totalHabits : 0;
      level = done === 0 ? 0 : ratio >= 0.75 ? 3 : ratio >= 0.4 ? 2 : 1;
    }
    cells.push({
      date: ymdFromIndex(i),
      level,
      inLongest: range ? i >= range.startIdx && i <= range.endIdx : false,
    });
  }
  return cells;
}

/** The all-time longest streak as a date range, for a single habit. */
export function longestStreakRange(
  logs: HabitLog[],
  habitId: string,
): StreakRange | null {
  const r = longestRunRange(completedDayIndices(habitId, logs));
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
  habitId?: string,
): { dow: number; count: number } | null {
  const set = daySet(logs, habitId);
  if (set.size === 0) return null;
  const counts = new Array(7).fill(0) as number[];
  for (const idx of set) counts[dowFromIndex(idx)]++;
  let best = 0;
  for (let i = 1; i < 7; i++) if (counts[i] > counts[best]) best = i;
  return { dow: best, count: counts[best] };
}

/** Weekday vs weekend completion rate over the last `rangeDays` ending today. */
export function weekendComparison(
  logs: HabitLog[],
  today: string,
  rangeDays: number,
  habitId?: string,
): { weekdayRate: number; weekendRate: number } {
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return { weekdayRate: 0, weekendRate: 0 };
  const start = todayIdx - rangeDays + 1;
  const set = daySet(logs, habitId);
  let wdDone = 0;
  let wdTot = 0;
  let weDone = 0;
  let weTot = 0;
  for (let i = start; i <= todayIdx; i++) {
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
  habitId?: string,
  minRun = 3,
): boolean {
  const set = daySet(logs, habitId);
  const todayIdx = dayIndex(today);
  if (Number.isNaN(todayIdx)) return false;
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
