// FR-AN1 — journal stats. The analytics surface used to measure only habits,
// which quietly said "the journal half of this app doesn't count". It does:
// what you wrote is as much a record of showing up as what you ticked.
//
// Pure + deterministic, same contract as lib/stats.ts: `today` is passed in,
// nothing after today is ever counted, no React / network / crypto here.

import type { DailyEntry } from "@/lib/db";
import { dayIndexOf, dayKeyFromIndex } from "./stats";

/** One month's tally, for "most-written months" and the records board. */
export interface MonthTally {
  key: string; // "YYYY-MM"
  label: string; // "Jun 2026"
  count: number;
}

export interface JournalStats {
  /** Entries written (a day can hold several). */
  totalEntries: number;
  /** Distinct days with at least one entry. */
  daysJournaled: number;
  /** Consecutive journaled days ending today or yesterday. */
  currentStreak: number;
  /** Longest run of consecutive journaled days, ever. */
  longestStreak: number;
  /** Photos attached across all entries. */
  photos: number;
  /** Busiest months first, capped by `topMonths`. */
  mostWrittenMonths: MonthTally[];
  /** Every month with entries, newest first (records board input). */
  entriesByMonth: MonthTally[];
  /** Every month with photos, newest first (records board input). */
  photosByMonth: MonthTally[];
  /** Day key of the first entry ever, or null. */
  firstEntryDate: string | null;
  /** Day keys with an entry, oldest → newest (stamp earn dates). */
  journaledDays: string[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTHS[idx] ?? m} ${y}`;
}

// Newest month first; a stable tie-break keeps render order deterministic.
function tallies(counts: Map<string, number>): MonthTally[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, label: monthLabel(key), count }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

function longestRun(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  return longest;
}

function currentRun(sorted: number[], todayIdx: number): number {
  if (sorted.length === 0) return 0;
  const last = sorted[sorted.length - 1];
  if (last !== todayIdx && last !== todayIdx - 1) return 0;
  let streak = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (sorted[i] !== sorted[i + 1] - 1) break;
    streak++;
  }
  return streak;
}

/**
 * Everything the journal half of the analysis needs, in one pass. Entries
 * dated after `today` (clock skew, a device in another zone) are ignored
 * exactly like future habit logs are.
 */
export function computeJournalStats(
  entries: DailyEntry[],
  today: string,
  opts: { topMonths?: number } = {},
): JournalStats {
  const { topMonths = 3 } = opts;
  const empty: JournalStats = {
    totalEntries: 0,
    daysJournaled: 0,
    currentStreak: 0,
    longestStreak: 0,
    photos: 0,
    mostWrittenMonths: [],
    entriesByMonth: [],
    photosByMonth: [],
    firstEntryDate: null,
    journaledDays: [],
  };
  const todayIdx = dayIndexOf(today);
  if (Number.isNaN(todayIdx)) return empty;

  const days = new Set<number>();
  const byMonth = new Map<string, number>();
  const photosByMonth = new Map<string, number>();
  let totalEntries = 0;
  let photos = 0;

  for (const entry of entries) {
    const idx = dayIndexOf(entry.date);
    if (Number.isNaN(idx) || idx > todayIdx) continue;
    totalEntries++;
    days.add(idx);
    const monthKey = entry.date.slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + 1);
    const shots = entry.mediaPaths.length;
    if (shots > 0) {
      photos += shots;
      photosByMonth.set(monthKey, (photosByMonth.get(monthKey) ?? 0) + shots);
    }
  }

  const sorted = [...days].sort((a, b) => a - b);
  const entriesByMonth = tallies(byMonth);

  return {
    totalEntries,
    daysJournaled: sorted.length,
    currentStreak: currentRun(sorted, todayIdx),
    longestStreak: longestRun(sorted),
    photos,
    mostWrittenMonths: [...entriesByMonth]
      .sort((a, b) => b.count - a.count || b.key.localeCompare(a.key))
      .slice(0, topMonths),
    entriesByMonth,
    photosByMonth: tallies(photosByMonth),
    firstEntryDate: sorted.length > 0 ? dayKeyFromIndex(sorted[0]) : null,
    journaledDays: sorted.map(dayKeyFromIndex),
  };
}
