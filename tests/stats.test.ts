// Pure stats engine tests. No network, no crypto.

import "./setup";

import { test, assertEq, assertTrue, run } from "./helpers";
import type { Habit, HabitLog } from "../lib/db/types";
import {
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
  completionRateForMonth,
  monthOverMonthTrend,
  monthlyRateSeries,
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
  const overall = computeOverallStats(all, logs);
  assertEq(overall.totalCompletions, 4);
  assertEq(overall.bestCurrentStreak, 3); // h1
  assertEq(overall.bestLongestStreak, 3); // h1
  // distinct dates with >=1 completion: 14, 15, 16 -> 3
  assertEq(overall.activeDays, 3);
});

test("computeOverallStats empty -> all zeros", () => {
  const overall = computeOverallStats([], []);
  assertEq(overall, {
    totalCompletions: 0,
    bestCurrentStreak: 0,
    bestLongestStreak: 0,
    activeDays: 0,
  });
});

test("activeDays counts distinct dates, ignores incomplete", () => {
  const logs = [
    log("h1", "2026-06-16"),
    log("h2", "2026-06-16"), // same day, two habits -> one active day
    log("h1", "2026-06-15", false), // incomplete -> not active
  ];
  const overall = computeOverallStats([], logs);
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

  const overall = computeOverallStats([s], logs);
  assertEq(overall.activeDays, 1);
});

// --- analytics dashboard math ---------------------------------------------

test("completionRateForMonth: elapsed-day rate for current month", () => {
  // June has 30 days; today is the 16th -> 16 elapsed days.
  const logs = range("h1", 2026, 6, 1, 8); // 8 of 16 elapsed days
  assertEq(completionRateForMonth(logs, 2026, 6, TODAY, "h1"), 0.5);
});

test("completionRateForMonth: full past month, future month is 0", () => {
  const may = range("h1", 2026, 5, 1, 31); // every day of May
  assertEq(completionRateForMonth(may, 2026, 5, TODAY, "h1"), 1);
  // December is in the future relative to asOf -> 0
  assertEq(completionRateForMonth(may, 2026, 12, TODAY, "h1"), 0);
});

test("monthOverMonthTrend: current vs previous month", () => {
  const logs = range("h1", 2026, 6, 1, 16); // June fully done -> current 1.0
  const t = monthOverMonthTrend(logs, TODAY, "h1");
  assertEq(t.current, 1);
  assertEq(t.previous, 0); // nothing in May
  assertEq(t.delta, 100);
});

test("monthlyRateSeries: n points oldest->newest, ends on current month", () => {
  const logs = range("h1", 2026, 6, 1, 16);
  const series = monthlyRateSeries(logs, TODAY, 6, "h1");
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
  const r = longestStreakRange(logs, "h2");
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
  const best = bestDayOfWeek(logs, "h1");
  assertEq(best?.count, 3);
  assertEq(best?.dow, new Date(Date.UTC(2026, 5, 1)).getUTCDay());
  assertEq(bestDayOfWeek([], "h1"), null);
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
  const c = weekendComparison(logs, TODAY, 14, "h1");
  assertEq(c.weekdayRate, 1);
  assertEq(c.weekendRate, 0);
});

test("hadRecentComeback: gap then fresh run is a comeback", () => {
  const comeback = [
    ...range("h1", 2026, 6, 1, 3), // earlier completions
    // gap 4-13
    ...range("h1", 2026, 6, 14, 16), // fresh run of 3 ending today
  ];
  assertTrue(hadRecentComeback(comeback, TODAY, "h1"));
  // a clean continuous streak is not a comeback
  assertEq(hadRecentComeback(range("h1", 2026, 6, 1, 16), TODAY, "h1"), false);
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

(async () => {
  await run();
})();
