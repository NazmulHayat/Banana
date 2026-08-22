// Habit-grid column geometry — pure width math, no React, no network.
//
// The rule these lock in: the columns FILL the available row whenever they can
// be at least `HABIT_COLUMN_WIDTH` wide, and only fall back to fixed columns +
// horizontal scroll when they can't. The previous rule capped filling at three
// habits, which left dead paper at exactly four — visible on every phone, and
// the kind of thing that reappears the moment someone re-adds a count check.

import "./setup";

import {
  computeColumnWidth,
  fitsWithoutScroll,
  HABIT_COLUMN_WIDTH,
} from "../lib/grid-layout";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

// Real grid widths: the row minus 16pt margins each side and the 62pt DAY
// column. iPhone SE (375), 15 (393) and 15 Pro Max (430).
const SE = 375 - 32 - 62; // 281
const STD = 393 - 32 - 62; // 299
const MAX = 430 - 32 - 62; // 336


suite("columns fill the row whenever they fit");

test("1 to 4 habits stretch to fill on a standard phone", () => {
  for (const count of [1, 2, 3, 4]) {
    const w = computeColumnWidth(STD, count);
    assertTrue(
      w > HABIT_COLUMN_WIDTH,
      `${count} habits should stretch past the fixed width, got ${w}`,
    );
    assertTrue(fitsWithoutScroll(STD, count), `${count} habits should not scroll`);
    // Filling means the columns consume the row, give or take the floor().
    assertTrue(
      STD - count * w < count,
      `${count} habits left ${STD - count * w}pt of dead space`,
    );
  }
});

test("four habits fill the row on every iPhone width (the old dead-space bug)", () => {
  for (const width of [SE, STD, MAX]) {
    assertTrue(fitsWithoutScroll(width, 4), `4 habits should fill a ${width}pt row`);
    assertTrue(
      computeColumnWidth(width, 4) > HABIT_COLUMN_WIDTH,
      `4 habits should stretch in a ${width}pt row`,
    );
  }
});

test("a single habit takes the whole row", () => {
  assertEq(computeColumnWidth(STD, 1), STD);
});

suite("columns fall back to scrolling only when they cannot fit");

test("many habits keep the fixed column and scroll", () => {
  for (const count of [8, 12, 20]) {
    assertEq(computeColumnWidth(STD, count), HABIT_COLUMN_WIDTH);
    assertTrue(!fitsWithoutScroll(STD, count), `${count} habits should scroll`);
  }
});

test("the fill/scroll boundary is where the columns stop fitting", () => {
  // Whatever the exact count, the two helpers must never disagree: a grid
  // that fits is stretched, a grid that scrolls is at the fixed width.
  for (let count = 1; count <= 12; count++) {
    const w = computeColumnWidth(STD, count);
    if (fitsWithoutScroll(STD, count)) {
      assertTrue(count * w <= STD + count, `${count}: filled but overflows`);
    } else {
      assertEq(w, HABIT_COLUMN_WIDTH);
      assertTrue(count * w > STD, `${count}: fixed width but would have fitted`);
    }
  }
});

test("never narrower than the fixed column — the 44pt touch floor holds", () => {
  for (let count = 1; count <= 40; count++) {
    assertTrue(
      computeColumnWidth(STD, count) >= HABIT_COLUMN_WIDTH,
      `${count} habits produced a sub-minimum column`,
    );
  }
});

suite("degenerate inputs never break the layout");

test("no habits, or width not yet measured, uses the fixed column", () => {
  assertEq(computeColumnWidth(STD, 0), HABIT_COLUMN_WIDTH);
  assertEq(computeColumnWidth(0, 3), HABIT_COLUMN_WIDTH);
  assertEq(computeColumnWidth(-10, 3), HABIT_COLUMN_WIDTH);
  assertEq(computeColumnWidth(STD, -1), HABIT_COLUMN_WIDTH);
});

test("before the first onLayout the grid does not claim to fit", () => {
  // gridWidth is 0 until measured; claiming a fit would disable scrolling on
  // the pre-measurement frame and strand columns off-screen.
  assertTrue(!fitsWithoutScroll(0, 3));
  assertTrue(!fitsWithoutScroll(STD, 0));
});
run();
