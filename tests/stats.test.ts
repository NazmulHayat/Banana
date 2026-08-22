// Pure stats engine tests. No network, no crypto.

import "./setup";

import { test, assertEq, assertTrue, run } from "./helpers";
import type { Habit, HabitLog } from "../lib/db/types";
import {
  completionForMonth,
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
  completionRateForMonth,
  consistencyScore,
  dailyRateSeries,
  habitComparison,
  habitCorrelations,
  perfectDays,
  monthOverMonthTrend,
  monthlyRateSeries,
  habitWeeklyTimeline,
  MIN_PROGRESS_MONTHS,
  progressSeries,
  streakIntensity,
  heatmapCells,
  longestStreakRange,
  daysToRecord,
  bestDayOfWeek,
  weekendComparison,
  hadRecentComeback,
  buildInsight,
} from "../lib/stats";

const TODAY = "2026-06-16";

function log(habitId: string, date: string, completed = true): HabitLog {
  return { habitId, date, completed };
}

function habit(id: string, name = id): Habit {
  return { id, name, createdAt: "2026-01-01" };
}

const p2 = (n: number): string => String(n).padStart(2, "0");

// Completed logs for a habit over an inclusive day range within one month.
function range(
  habitId: string,
  year: number,
  month: number,
  d1: number,
  d2: number,
): HabitLog[] {
  const out: HabitLog[] = [];
  for (let d = d1; d <= d2; d++) {
    out.push(log(habitId, `${year}-${p2(month)}-${p2(d)}`));
  }
  return out;
}

test("empty logs -> all zeros", () => {
  const s = computeHabitStats("h1", [], TODAY);
  assertEq(s, {
    habitId: "h1",
    totalCompletions: 0,
    currentStreak: 0,
    longestStreak: 0,
  });
});

test("single completion today", () => {
  const s = computeHabitStats("h1", [log("h1", TODAY)], TODAY);
  assertEq(s.totalCompletions, 1);
  assertEq(s.currentStreak, 1);
  assertEq(s.longestStreak, 1);
});

test("3-day streak ending today", () => {
  const logs = [
    log("h1", "2026-06-14"),
    log("h1", "2026-06-15"),
    log("h1", "2026-06-16"),
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.currentStreak, 3);
  assertEq(s.longestStreak, 3);
  assertEq(s.totalCompletions, 3);
});

test("streak ending yesterday still counts as current", () => {
  const logs = [log("h1", "2026-06-14"), log("h1", "2026-06-15")];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.currentStreak, 2);
});

test("streak broken 2 days ago -> current 0, longest preserved", () => {
  const logs = [
    log("h1", "2026-06-10"),
    log("h1", "2026-06-11"),
    log("h1", "2026-06-12"),
    log("h1", "2026-06-13"),
    // gap on 14, 15, 16 -> last completed is 2 days before today
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.currentStreak, 0);
  assertEq(s.longestStreak, 4);
});

test("unsorted input is handled", () => {
  const logs = [
    log("h1", "2026-06-16"),
    log("h1", "2026-06-14"),
    log("h1", "2026-06-15"),
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.currentStreak, 3);
  assertEq(s.longestStreak, 3);
});

test("duplicate-date logs are de-duplicated", () => {
  const logs = [
    log("h1", "2026-06-16"),
    log("h1", "2026-06-16"),
    log("h1", "2026-06-15"),
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.totalCompletions, 2);
  assertEq(s.currentStreak, 2);
  assertEq(s.longestStreak, 2);
});

test("completed === false is ignored", () => {
  const logs = [log("h1", "2026-06-16", false), log("h1", "2026-06-15", true)];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.totalCompletions, 1);
  // last completed is yesterday -> still current
  assertEq(s.currentStreak, 1);
});

test("logs for other habits are ignored", () => {
  const logs = [log("h2", "2026-06-16"), log("h1", "2026-06-15")];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.totalCompletions, 1);
  assertEq(s.currentStreak, 1);
});

test("computeAllHabitStats over multiple habits", () => {
  const habits = [habit("h1"), habit("h2")];
  const logs = [
    log("h1", "2026-06-15"),
    log("h1", "2026-06-16"),
    log("h2", "2026-06-16"),
  ];
  const all = computeAllHabitStats(habits, logs, TODAY);
  assertEq(all.length, 2);
  assertEq(all[0].habitId, "h1");
  assertEq(all[0].currentStreak, 2);
  assertEq(all[1].habitId, "h2");
  assertEq(all[1].currentStreak, 1);
});

test("computeOverallStats aggregation", () => {
  const habits = [habit("h1"), habit("h2")];
  const logs = [
    log("h1", "2026-06-14"),
    log("h1", "2026-06-15"),
    log("h1", "2026-06-16"),
    log("h2", "2026-06-16"),
  ];
  const all = computeAllHabitStats(habits, logs, TODAY);
  const overall = computeOverallStats(all, logs, TODAY, habits);
  assertEq(overall.totalCompletions, 4);
  assertEq(overall.bestCurrentStreak, 3); // h1
  assertEq(overall.bestLongestStreak, 3); // h1
  // distinct dates with >=1 completion: 14, 15, 16 -> 3
  assertEq(overall.activeDays, 3);
});

test("computeOverallStats empty -> all zeros", () => {
  const overall = computeOverallStats([], [], TODAY);
  assertEq(overall, {
    totalCompletions: 0,
    bestCurrentStreak: 0,
    bestLongestStreak: 0,
    activeDays: 0,
    perfectDays: 0,
  });
});

test("activeDays counts distinct dates, ignores incomplete", () => {
  const logs = [
    log("h1", "2026-06-16"),
    log("h2", "2026-06-16"), // same day, two habits -> one active day
    log("h1", "2026-06-15", false), // incomplete -> not active
  ];
  const overall = computeOverallStats([], logs, TODAY);
  assertEq(overall.activeDays, 1);
  assertTrue(overall.activeDays === 1);
});

test("malformed/overflow dates are excluded everywhere", () => {
  const logs = [
    log("h1", TODAY), // valid -> counts
    log("h1", "2026-02-30"), // overflow (Feb has 28 days) -> rejected
    log("h1", "2025-02-29"), // non-leap-year Feb 29 -> rejected
    log("h1", "2026-13-01"), // bad month -> rejected
    log("h1", "06/16/2026"), // wrong format -> rejected
    log("h1", "garbage"), // not a date -> rejected
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.totalCompletions, 1);
  assertEq(s.currentStreak, 1);
  assertEq(s.longestStreak, 1);

  const overall = computeOverallStats([s], logs, TODAY);
  assertEq(overall.activeDays, 1);
});

// --- analytics dashboard math ---------------------------------------------

test("completionRateForMonth: elapsed-day rate for current month", () => {
  // June has 30 days; today is the 16th -> 16 elapsed days.
  const logs = range("h1", 2026, 6, 1, 8); // 8 of 16 elapsed days
  assertEq(completionRateForMonth(logs, 2026, 6, TODAY, { habitId: "h1" }), 0.5);
});

test("completionRateForMonth: full past month, future month is 0", () => {
  const may = range("h1", 2026, 5, 1, 31); // every day of May
  assertEq(completionRateForMonth(may, 2026, 5, TODAY, { habitId: "h1" }), 1);
  // December is in the future relative to asOf -> 0
  assertEq(completionRateForMonth(may, 2026, 12, TODAY, { habitId: "h1" }), 0);
});

test("monthOverMonthTrend: current vs previous month", () => {
  const logs = range("h1", 2026, 6, 1, 16); // June fully done -> current 1.0
  const t = monthOverMonthTrend(logs, TODAY, { habitId: "h1" });
  assertEq(t.current, 1);
  assertEq(t.previous, 0); // nothing in May
  assertEq(t.delta, 100);
});

test("monthlyRateSeries: n points oldest->newest, ends on current month", () => {
  const logs = range("h1", 2026, 6, 1, 16);
  const series = monthlyRateSeries(logs, TODAY, 6, { habitId: "h1" });
  assertEq(series.length, 6);
  assertEq(series[5].label, "Jun");
  assertEq(series[5].rate, 1);
  assertEq(series[0].label, "Jan");
});

test("heatmapCells: per-habit length + streak-strength level + glow", () => {
  const logs = range("h1", 2026, 6, 1, 16); // 16-day run ending today
  const cells = heatmapCells(logs, TODAY, 30, { habitId: "h1" });
  assertEq(cells.length, 30);
  const last = cells[cells.length - 1];
  assertEq(last.date, "2026-06-16");
  assertEq(last.level, 3); // run >= 8
  assertTrue(last.inLongest);
});

test("heatmapCells: overall level scales with habits completed that day", () => {
  const logs = [log("h1", TODAY), log("h2", TODAY)];
  const cells = heatmapCells(logs, TODAY, 7, { totalHabits: 2 });
  assertEq(cells.length, 7);
  assertEq(cells[cells.length - 1].level, 3); // 2/2 habits -> full
});

test("longestStreakRange: returns the longest run as dates", () => {
  const logs = [
    ...range("h2", 2026, 6, 1, 5), // run of 5
    ...range("h2", 2026, 6, 10, 16), // run of 7 (the longest)
  ];
  const r = longestStreakRange(logs, "h2", TODAY);
  assertTrue(r !== null);
  assertEq(r?.length, 7);
  assertEq(r?.startDate, "2026-06-10");
  assertEq(r?.endDate, "2026-06-16");
});

test("daysToRecord", () => {
  assertEq(daysToRecord(12, 21), 9);
  assertEq(daysToRecord(21, 21), 0); // at the record
  assertEq(daysToRecord(0, 5), 0); // no current streak
});

test("bestDayOfWeek: picks the weekday with most completions", () => {
  // 1st, 8th, 15th are the same weekday (7 days apart); 16th is one other.
  const logs = [
    log("h1", "2026-06-01"),
    log("h1", "2026-06-08"),
    log("h1", "2026-06-15"),
    log("h1", "2026-06-16"),
  ];
  const best = bestDayOfWeek(logs, TODAY, { habitId: "h1" });
  assertEq(best?.count, 3);
  assertEq(best?.dow, new Date(Date.UTC(2026, 5, 1)).getUTCDay());
  assertEq(bestDayOfWeek([], TODAY, { habitId: "h1" }), null);
});

test("weekendComparison: weekday-only logging -> weekendRate 0", () => {
  // Build a 14-day window, complete only the weekdays in it.
  const todayIdx = Math.floor(Date.parse(`${TODAY}T00:00:00Z`) / 86_400_000);
  const logs: HabitLog[] = [];
  for (let i = todayIdx - 13; i <= todayIdx; i++) {
    const dow = new Date(i * 86_400_000).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const d = new Date(i * 86_400_000);
      logs.push(log("h1", `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`));
    }
  }
  const c = weekendComparison(logs, TODAY, 14, { habitId: "h1" });
  assertEq(c.weekdayRate, 1);
  assertEq(c.weekendRate, 0);
});

test("hadRecentComeback: gap then fresh run is a comeback", () => {
  const comeback = [
    ...range("h1", 2026, 6, 1, 3), // earlier completions
    // gap 4-13
    ...range("h1", 2026, 6, 14, 16), // fresh run of 3 ending today
  ];
  assertTrue(hadRecentComeback(comeback, TODAY, { habitId: "h1" }));
  // a clean continuous streak is not a comeback
  assertEq(hadRecentComeback(range("h1", 2026, 6, 1, 16), TODAY, { habitId: "h1" }), false);
});

test("buildInsight: applicable lines, rotation, and fallback", () => {
  const parts = {
    bestDow: 2, // Tuesday
    weekendDrop: true,
    currentStreak: 0,
    longestStreak: 0,
    trendDelta: 0,
    hadComeback: false,
  };
  assertEq(buildInsight(parts, 0), "You're most consistent on Tuesdays.");
  assertTrue(buildInsight(parts, 1) !== buildInsight(parts, 0)); // rotates
  const empty = {
    bestDow: null,
    weekendDrop: false,
    currentStreak: 0,
    longestStreak: 0,
    trendDelta: 0,
    hadComeback: false,
  };
  assertTrue(buildInsight(empty, 0).length > 0); // graceful fallback
});

// --- D13a: eligible habit-days ---------------------------------------------

test("D13a: a habit created mid-month is scored from its creation day", () => {
  // Created on the 11th, done every day since -> 100%, not 6/16.
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-06-11" }];
  const logs = range("h1", 2026, 6, 11, 16);
  const c = completionForMonth(logs, 2026, 6, TODAY, { habitId: "h1", habits });
  assertEq(c, { done: 6, days: 6, rate: 1 });
  // Without the habit set the old (wrong) elapsed-day denominator returns.
  assertEq(completionRateForMonth(logs, 2026, 6, TODAY, { habitId: "h1" }), 6 / 16);
});

test("D13a: partial month since creation uses the shorter denominator", () => {
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-06-11T09:00:00.000Z" }];
  const logs = range("h1", 2026, 6, 11, 13); // 3 of the 6 eligible days
  const c = completionForMonth(logs, 2026, 6, TODAY, { habitId: "h1", habits });
  assertEq(c, { done: 3, days: 6, rate: 0.5 });
});

test("D13a: months entirely before creation report zero eligible days", () => {
  const habits = [habit("h1", "h1")];
  habits[0].createdAt = "2026-06-11";
  const logs = range("h1", 2026, 6, 11, 16);
  const may = completionForMonth(logs, 2026, 5, TODAY, { habitId: "h1", habits });
  assertEq(may, { done: 0, days: 0, rate: 0 });
  const series = monthlyRateSeries(logs, TODAY, 6, { habitId: "h1", habits });
  assertEq(series[4].days, 0); // May — nothing to score
  assertEq(series[5].days, 6); // June — six eligible days
});

test("D13a: a log older than createdAt still opens the window", () => {
  // Clock skew / a UTC createdAt read in a western zone: evidence wins.
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-06-11" }];
  const logs = range("h1", 2026, 6, 9, 16); // starts two days "early"
  const c = completionForMonth(logs, 2026, 6, TODAY, { habitId: "h1", habits });
  assertEq(c, { done: 8, days: 8, rate: 1 });
});

test("D13a: overall rate is eligible from the earliest habit", () => {
  const habits = [
    { id: "h1", name: "h1", createdAt: "2026-06-10" },
    { id: "h2", name: "h2", createdAt: "2026-06-14" },
  ];
  const logs = [...range("h1", 2026, 6, 10, 16), ...range("h2", 2026, 6, 14, 16)];
  // Days 10..16 = 7 eligible days, all with at least one completion.
  assertEq(completionForMonth(logs, 2026, 6, TODAY, { habits }), {
    done: 7,
    days: 7,
    rate: 1,
  });
});

// --- D13b: future logs ------------------------------------------------------

test("D13b: future logs never inflate totals, streaks or active days", () => {
  const habits = [habit("h1")];
  const logs = [
    ...range("h1", 2026, 6, 14, 16), // real: 3-day run ending today
    log("h1", "2026-06-17"), // tomorrow
    log("h1", "2026-06-18"),
    log("h1", "2026-07-01"), // next month
  ];
  const s = computeHabitStats("h1", logs, TODAY);
  assertEq(s.totalCompletions, 3);
  assertEq(s.currentStreak, 3);
  assertEq(s.longestStreak, 3); // NOT 5 — the future days can't extend it
  const overall = computeOverallStats([s], logs, TODAY, habits);
  assertEq(overall.activeDays, 3);
  assertEq(completionForMonth(logs, 2026, 6, TODAY, { habitId: "h1", habits }).done, 3);
});

test("D13b: a future log can't create a heatmap cell or a perfect day", () => {
  const habits = [habit("h1")];
  const logs = [log("h1", "2026-06-20")];
  const cells = heatmapCells(logs, TODAY, 7, { habits });
  assertEq(cells.length, 7);
  assertEq(cells[cells.length - 1].date, TODAY);
  assertEq(cells.filter((c) => c.level > 0).length, 0);
  assertEq(perfectDays(habits, logs, TODAY), []);
});

// --- D13c: deleted habits ---------------------------------------------------

test("D13c: logs from a deleted habit stay out of the aggregates", () => {
  const habits = [habit("h1")]; // "gone" was deleted
  const logs = [log("h1", TODAY), log("gone", "2026-06-15"), log("gone", TODAY)];
  const all = computeAllHabitStats(habits, logs, TODAY);
  const scoped = computeOverallStats(all, logs, TODAY, habits);
  assertEq(scoped.activeDays, 1); // only today, only h1
  // Without the habit set the ghost day is still there — that's the bug.
  assertEq(computeOverallStats(all, logs, TODAY).activeDays, 2);
});

test("D13c: a deleted habit can't break a perfect day", () => {
  const habits = [habit("h1")];
  const logs = [log("h1", TODAY), log("gone", "2026-06-15")];
  assertEq(perfectDays(habits, logs, TODAY), [TODAY]);
});

// --- leap year --------------------------------------------------------------

test("leap year: Feb 2024 has 29 eligible days, Feb 2025 has 28", () => {
  const habits = [{ id: "h1", name: "h1", createdAt: "2024-01-01" }];
  const feb24 = [
    ...range("h1", 2024, 2, 1, 29),
    ...range("h1", 2025, 2, 1, 28),
  ];
  assertEq(completionForMonth(feb24, 2024, 2, "2024-03-31", { habitId: "h1", habits }), {
    done: 29,
    days: 29,
    rate: 1,
  });
  assertEq(completionForMonth(feb24, 2025, 2, "2025-03-31", { habitId: "h1", habits }), {
    done: 28,
    days: 28,
    rate: 1,
  });
  // Feb 29 in a non-leap year isn't a date at all.
  const bogus = [log("h1", "2025-02-29")];
  assertEq(computeHabitStats("h1", bogus, "2025-03-01").totalCompletions, 0);
});

test("leap day is a real completion and extends a streak", () => {
  const logs = range("h1", 2024, 2, 27, 29);
  const s = computeHabitStats("h1", logs, "2024-02-29");
  assertEq(s.currentStreak, 3);
  assertEq(s.longestStreak, 3);
});

// --- FR-G1 perfect days -----------------------------------------------------

test("FR-G1: perfect days respect a habit added mid-month", () => {
  const habits = [
    { id: "h1", name: "h1", createdAt: "2026-06-01" },
    { id: "h2", name: "h2", createdAt: "2026-06-10" },
  ];
  const logs = [
    log("h1", "2026-06-05"), // only h1 existed -> perfect
    log("h1", "2026-06-10"),
    log("h2", "2026-06-10"), // both done -> perfect
    log("h1", "2026-06-11"), // h2 existed and wasn't done -> not perfect
  ];
  assertEq(perfectDays(habits, logs, TODAY), ["2026-06-05", "2026-06-10"]);
});

test("FR-G1: no habits means no perfect days", () => {
  assertEq(perfectDays([], [log("h1", TODAY)], TODAY), []);
});

// --- FR-AN2 comparison ------------------------------------------------------

test("FR-AN2: habits rank by this month's rate, new habits read as 0 days", () => {
  const habits = [
    { id: "slipping", name: "Slipping", createdAt: "2026-06-01" },
    { id: "solid", name: "Solid", createdAt: "2026-06-01" },
    { id: "fresh", name: "Fresh", createdAt: "2026-07-01" }, // not eligible yet
  ];
  const logs = [
    ...range("solid", 2026, 6, 1, 16),
    ...range("slipping", 2026, 6, 1, 4),
  ];
  const rows = habitComparison(habits, logs, TODAY);
  assertEq(rows[0].habitId, "solid");
  assertEq(rows[0].rate, 1);
  assertEq(rows[1].habitId, "slipping");
  assertEq(rows[1].days, 16);
  assertEq(rows[2].habitId, "fresh");
  assertEq(rows[2].days, 0); // "new", never a punitive 0%
});

// --- FR-AN3 consistency score ----------------------------------------------

test("FR-AN3: perfect 30 days scores 100, nothing scores 0", () => {
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-05-01" }];
  const full: HabitLog[] = [];
  for (let d = 18; d <= 31; d++) full.push(log("h1", `2026-05-${p2(d)}`));
  full.push(...range("h1", 2026, 6, 1, 16));
  assertEq(consistencyScore(habits, full, TODAY).score, 100);
  assertEq(consistencyScore(habits, [], TODAY).score, 0);
  assertEq(consistencyScore([], full, TODAY).daysCounted, 0);
});

test("FR-AN3: recent days weigh more than old ones", () => {
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-05-01" }];
  const recent = range("h1", 2026, 6, 2, 16); // last 15 days
  const older: HabitLog[] = [];
  for (let d = 18; d <= 31; d++) older.push(log("h1", `2026-05-${p2(d)}`));
  older.push(log("h1", "2026-06-01"));
  const recentScore = consistencyScore(habits, recent, TODAY).score;
  const olderScore = consistencyScore(habits, older, TODAY).score;
  assertTrue(recentScore > olderScore);
  assertTrue(recentScore <= 100 && olderScore >= 0);
});

test("FR-AN3: days before the habit existed are skipped, not failed", () => {
  const habits = [{ id: "h1", name: "h1", createdAt: "2026-06-14" }];
  const logs = range("h1", 2026, 6, 14, 16);
  const r = consistencyScore(habits, logs, TODAY);
  assertEq(r.daysCounted, 3);
  assertEq(r.score, 100);
});

// --- FR-AN4 correlations ----------------------------------------------------

test("FR-AN4: a strong pair is reported with its sample", () => {
  const habits = [
    { id: "gym", name: "Gym", createdAt: "2026-06-01" },
    { id: "read", name: "Read", createdAt: "2026-06-01" },
  ];
  const logs = [
    ...range("gym", 2026, 6, 1, 10),
    ...range("read", 2026, 6, 1, 9),
  ];
  const found = habitCorrelations(habits, logs, TODAY);
  assertEq(found.length, 1);
  assertTrue(found[0].sample >= 5);
  assertTrue(found[0].rate >= 0.6);
  assertTrue(found[0].lift >= 0.15);
});

test("FR-AN4: too small a sample claims nothing", () => {
  const habits = [
    { id: "gym", name: "Gym", createdAt: "2026-06-01" },
    { id: "read", name: "Read", createdAt: "2026-06-01" },
  ];
  const logs = [...range("gym", 2026, 6, 1, 3), ...range("read", 2026, 6, 1, 3)];
  assertEq(habitCorrelations(habits, logs, TODAY), []);
});

test("FR-AN4: an always-done habit isn't a correlation", () => {
  const habits = [
    { id: "always", name: "Always", createdAt: "2026-06-01" },
    { id: "some", name: "Some", createdAt: "2026-06-01" },
  ];
  const logs = [
    ...range("always", 2026, 6, 1, 16), // baseline 100% -> zero lift
    ...range("some", 2026, 6, 1, 10),
  ];
  assertEq(habitCorrelations(habits, logs, TODAY), []);
});

test("FR-AN4: results are capped so noise can't take over", () => {
  const ids = ["a", "b", "c", "d"];
  const habits = ids.map((id) => ({ id, name: id, createdAt: "2026-06-01" }));
  const logs = ids.flatMap((id) => range(id, 2026, 6, 1, 10)); // 6 perfect pairs
  assertTrue(habitCorrelations(habits, logs, TODAY).length <= 3);
  assertEq(habitCorrelations(habits, logs, TODAY, { limit: 2 }).length, 2);
});

// --- range control ----------------------------------------------------------

test("dailyRateSeries: one point per day, share of eligible habits", () => {
  const habits = [
    { id: "h1", name: "h1", createdAt: "2026-06-01" },
    { id: "h2", name: "h2", createdAt: "2026-06-01" },
  ];
  const logs = [log("h1", TODAY), log("h2", TODAY), log("h1", "2026-06-15")];
  const series = dailyRateSeries(logs, TODAY, 30, { habits });
  assertEq(series.length, 30);
  assertEq(series[29].rate, 1); // both habits today
  assertEq(series[28].rate, 0.5); // one of two yesterday
  assertEq(series[0].days, 0); // before either habit existed
});

// ---------------------------------------------------------------------------
// habitWeeklyTimeline — the Consistency grid (habits x weeks)
// ---------------------------------------------------------------------------
const WH = (id: string, createdAt: string): Habit => ({ id, name: id, createdAt });
const WL = (habitId: string, date: string): HabitLog => ({
  habitId,
  date,
  completed: true,
});

test("weekly: window runs from the week you started to this one", () => {
  // Habit created Mon 2026-08-03; today Thu 2026-08-20 -> 3 weeks.
  const t = habitWeeklyTimeline([WH("a", "2026-08-03T00:00:00.000Z")], [], "2026-08-20");
  assertEq(t.weeks.length, 3);
  assertEq(t.weeks[0], "2026-08-03");
  assertEq(t.weeks[2], "2026-08-17");
});

test("weekly: every column starts on a Monday", () => {
  const t = habitWeeklyTimeline([WH("a", "2026-06-10T00:00:00.000Z")], [], "2026-08-20");
  for (const week of t.weeks) {
    assertEq(new Date(`${week}T00:00:00Z`).getUTCDay(), 1, `${week} must be Monday`);
  }
});

test("weekly: starts at the OLDEST habit, so there's no empty history", () => {
  const t = habitWeeklyTimeline(
    [WH("old", "2026-08-03T00:00:00.000Z"), WH("new", "2026-08-17T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  assertEq(t.weeks[0], "2026-08-03");
});

test("weekly: weeks before a habit existed are not misses", () => {
  const t = habitWeeklyTimeline(
    [WH("old", "2026-08-03T00:00:00.000Z"), WH("new", "2026-08-17T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  const later = t.rows[1];
  assertEq(later.cells[0].eligible, 0);
  assertEq(later.cells[1].eligible, 0);
  assertTrue(later.cells[2].eligible > 0, "its own week counts");
});

test("weekly: the current week counts only up to today, never the future", () => {
  // Week of Mon 2026-08-17, today Thu the 20th -> Mon..Thu = 4 days.
  const t = habitWeeklyTimeline([WH("a", "2026-08-17T00:00:00.000Z")], [], "2026-08-20");
  assertEq(t.rows[0].cells[t.weeks.length - 1].eligible, 4);
});

test("weekly: completions land in the right week", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2026-08-03T00:00:00.000Z")],
    [WL("a", "2026-08-04"), WL("a", "2026-08-06"), WL("a", "2026-08-11")],
    "2026-08-20",
  );
  assertEq(t.rows[0].cells[0].done, 2);
  assertEq(t.rows[0].cells[1].done, 1);
});

test("weekly: rate is scored against eligible days only", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2026-08-17T00:00:00.000Z")],
    [WL("a", "2026-08-17"), WL("a", "2026-08-18")],
    "2026-08-20",
  );
  assertEq(t.rows[0].rate, 0.5);
});

test("weekly: another habit's log never lands in this row", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2026-08-03T00:00:00.000Z"), WH("b", "2026-08-03T00:00:00.000Z")],
    [WL("b", "2026-08-04")],
    "2026-08-20",
  );
  assertEq(t.rows[0].cells[0].done, 0);
  assertEq(t.rows[1].cells[0].done, 1);
});

test("weekly: long history switches to one column per month", () => {
  // Started Jan 2024, today Aug 2026 — far past the week-column ceiling.
  const t = habitWeeklyTimeline(
    [WH("a", "2024-01-15T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  assertEq(t.bucket, "month");
  // Jan 2024 .. Aug 2026 inclusive = 32 months, not ~137 weeks.
  assertEq(t.weeks.length, 32);
  assertEq(t.weeks[0], "2024-01-01");
});

test("weekly: month columns start on the 1st", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2024-01-15T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  for (const col of t.weeks) {
    assertEq(col.slice(-2), "01", `${col} must be a month start`);
  }
});

test("weekly: month mode still counts only up to today", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2024-01-15T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  // August 2026 is the last column; today is the 20th.
  assertEq(t.rows[0].cells[t.weeks.length - 1].eligible, 20);
});

test("weekly: month mode scores completions in the right month", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2024-01-15T00:00:00.000Z")],
    [WL("a", "2024-01-20"), WL("a", "2024-02-03")],
    "2026-08-20",
  );
  assertEq(t.rows[0].cells[0].done, 1, "January");
  assertEq(t.rows[0].cells[1].done, 1, "February");
});

test("weekly: short history stays in week columns", () => {
  const t = habitWeeklyTimeline(
    [WH("a", "2026-08-03T00:00:00.000Z")],
    [],
    "2026-08-20",
  );
  assertEq(t.bucket, "week");
});

test("weekly: no habits yields an empty grid, not a crash", () => {
  const t = habitWeeklyTimeline([], [], "2026-08-20");
  assertEq(t.weeks.length, 0);
  assertEq(t.rows.length, 0);
});

// ---------------------------------------------------------------------------
// progressSeries — monthly (capped at a year) or yearly, nothing else
// ---------------------------------------------------------------------------
const PH = (id: string, createdAt: string): Habit => ({ id, name: id, createdAt });

test("progress: defaults to monthly", () => {
  const r = progressSeries([], "2026-08-20", {
    habits: [PH("a", "2026-06-01T00:00:00.000Z")],
  });
  assertEq(r.mode, "month");
  assertEq(r.points.length, 3, "Jun, Jul, Aug");
});

test("progress: monthly is capped at a rolling year", () => {
  const r = progressSeries([], "2026-08-20", {
    habits: [PH("a", "2020-01-01T00:00:00.000Z")],
  });
  assertEq(r.mode, "month");
  assertEq(r.points.length, 12, "never more than 12 bars");
});

test("progress: yearly is unavailable inside a single calendar year", () => {
  const r = progressSeries([], "2026-08-20", {
    habits: [PH("a", "2026-01-01T00:00:00.000Z")],
  });
  assertEq(r.yearlyAvailable, false);
});

test("progress: yearly unlocks once a second calendar year exists", () => {
  const r = progressSeries([], "2026-08-20", {
    habits: [PH("a", "2025-11-01T00:00:00.000Z")],
  });
  assertTrue(r.yearlyAvailable, "Nov 2025 -> Aug 2026 spans two years");
});

test("progress: asking for yearly before it's available falls back to monthly", () => {
  const r = progressSeries(
    [],
    "2026-08-20",
    { habits: [PH("a", "2026-06-01T00:00:00.000Z")] },
    "year",
  );
  assertEq(r.mode, "month", "must not return an unusable yearly series");
});

test("progress: yearly gives one point per calendar year, in order", () => {
  const r = progressSeries(
    [],
    "2026-08-20",
    { habits: [PH("a", "2024-05-01T00:00:00.000Z")] },
    "year",
  );
  assertEq(r.mode, "year");
  assertEq(r.points.map((p) => p.label).join(","), "2024,2025,2026");
});

test("progress: yearly has no ceiling", () => {
  const r = progressSeries(
    [],
    "2026-08-20",
    { habits: [PH("a", "2010-01-01T00:00:00.000Z")] },
    "year",
  );
  assertEq(r.mode, "year");
  assertTrue(r.points.length > 12, `expected many years, got ${r.points.length}`);
});

test("progress: historyMonths reports how new the account is", () => {
  const r = progressSeries([], "2026-08-20", {
    habits: [PH("a", "2026-08-01T00:00:00.000Z")],
  });
  assertEq(r.historyMonths, 1, "one month in — nothing to compare yet");
  assertTrue(r.historyMonths < MIN_PROGRESS_MONTHS, "drives the early state");
});

test("progress: rates stay inside 0..1 after merging", () => {
  const r = progressSeries(
    [],
    "2026-08-20",
    { habits: [PH("a", "2023-01-01T00:00:00.000Z")] },
    "year",
  );
  for (const p of r.points) {
    assertTrue(p.rate >= 0 && p.rate <= 1, `rate out of range: ${p.rate}`);
  }
});

// ---------------------------------------------------------------------------
// streakIntensity — the shade of a day inside a streak
// ---------------------------------------------------------------------------
test("intensity: a day not done is empty", () => {
  assertEq(streakIntensity(0), 0);
});

test("intensity: day one is already visibly filled", () => {
  // A day you did is never nothing — it must not render as near-blank.
  assertTrue(streakIntensity(1) > 0.28, `got ${streakIntensity(1)}`);
});

test("intensity: never leaves 0..1", () => {
  for (const run of [0, 1, 5, 30, 365, 5000]) {
    const v = streakIntensity(run);
    assertTrue(v >= 0 && v <= 1, `run ${run} gave ${v}`);
  }
});

test("intensity: rises with every extra day, with no plateaus", () => {
  // The bug this replaces: days 4..7 all shared one shade, then day 8 jumped.
  for (let run = 1; run < 40; run++) {
    assertTrue(
      streakIntensity(run + 1) > streakIntensity(run),
      `no increase from ${run} to ${run + 1}`,
    );
  }
});

test("intensity: saturates, so long streaks stay distinguishable from mid ones", () => {
  const week = streakIntensity(7);
  const threeWeeks = streakIntensity(21);
  const year = streakIntensity(365);
  assertTrue(threeWeeks - week > 0.15, "a week to three weeks must be visible");
  assertTrue(year - threeWeeks < 0.12, "past three weeks it should flatten");
});

(async () => {
  await run();
})();
