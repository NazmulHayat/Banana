// Pure stats engine tests. No network, no crypto.

import "./setup";

import { test, assertEq, assertTrue, run } from "./helpers";
import type { Habit, HabitLog } from "../lib/db/types";
import {
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
} from "../lib/stats";

const TODAY = "2026-06-16";

function log(habitId: string, date: string, completed = true): HabitLog {
  return { habitId, date, completed };
}

function habit(id: string, name = id): Habit {
  return { id, name, createdAt: "2026-01-01" };
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

(async () => {
  await run();
})();
