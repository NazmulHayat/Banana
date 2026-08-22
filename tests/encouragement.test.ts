// The copy shown before the analytics can draw themselves.
//
// This is the first thing a new user reads on that screen, so the bar is:
// never blames them, never counts a miss, and never claims the day is wrong.

import "./setup";

import { EARLY_DAYS, earlyLine, earlyProgressLine } from "../lib/encouragement";
import { assertEq, assertTrue, run, test } from "./helpers";

const BLAMING = [
  "not enough",
  "no data",
  "missing",
  "failed",
  "you haven't",
  "nothing to show",
  "empty",
];

test("early: says something for every day before the threshold", () => {
  for (let d = 0; d < EARLY_DAYS; d++) {
    const line = earlyLine(d);
    assertTrue(line !== null, `day ${d} said nothing`);
    assertTrue((line ?? "").length > 10, `day ${d} too terse: ${line}`);
  }
});

test("early: goes quiet once there's enough history", () => {
  assertEq(earlyLine(EARLY_DAYS), null);
  assertEq(earlyLine(365), null);
});

test("early: never blames the user for being new", () => {
  for (let d = 0; d <= EARLY_DAYS; d++) {
    const line = (earlyLine(d) ?? "").toLowerCase();
    for (const bad of BLAMING) {
      assertTrue(!line.includes(bad), `day ${d} says "${bad}": ${line}`);
    }
  }
});

test("early: day one is named, not counted as a shortfall", () => {
  assertTrue((earlyLine(1) ?? "").includes("Day one"), earlyLine(1) ?? "");
});

test("early: the countdown to the first week is accurate", () => {
  // Day 5 has two days left to seven, not three.
  assertTrue((earlyLine(5) ?? "").includes("2 more"), earlyLine(5) ?? "");
  assertTrue((earlyLine(6) ?? "").includes("1 more"), earlyLine(6) ?? "");
});

test("early: never promises something has already happened", () => {
  // Day 2 must not claim a week's worth of shape.
  assertTrue(!(earlyLine(2) ?? "").includes("week"), earlyLine(2) ?? "");
});

test("progress: always returns a line — the chart has nothing else to show", () => {
  for (const d of [0, 1, 5, 13, 20, 40]) {
    assertTrue(earlyProgressLine(d).length > 10, `day ${d}`);
  }
});

test("progress: never blames either", () => {
  for (const d of [0, 1, 5, 13, 20, 40]) {
    const line = earlyProgressLine(d).toLowerCase();
    for (const bad of BLAMING) {
      assertTrue(!line.includes(bad), `day ${d} says "${bad}"`);
    }
  }
});

(async () => {
  await run();
})();
