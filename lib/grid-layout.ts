// Habit-grid geometry — pure width/height math, no React.
//
// Lives in `lib/` rather than inside `components/habit-grid.tsx` for the
// reason the frontend rules give for `lib/layout-algorithm.ts`: layout maths
// is a heavy helper, and keeping it here makes it testable without dragging
// React Native into the test harness (`tests/grid-layout.test.ts`).
//
// `components/habit-grid.tsx` re-exports everything below, so the grid and the
// sticky header in `app/(tabs)/index.tsx` keep importing from one place.

/** One column is the cell plus its 2pt right margin. */
export const CELL_GAP = 2;
/** Every cell is 60pt tall so the habit rows line up with the DAY column. */
export const CELL_HEIGHT = 60;
/**
 * Vertical distance from one day row to the next (cell + its 2pt gap). The
 * screen uses this to scroll today's row into view without re-deriving the
 * grid's geometry.
 */
export const ROW_PITCH = CELL_HEIGHT + CELL_GAP;
/** Height of the header row above the day rows (the DAY / habit-name band). */
export const HEADER_ROW_HEIGHT = CELL_HEIGHT;
/**
 * The narrowest a habit column ever gets (60pt cell + 2pt gap) — this is the
 * 44pt touch-target floor with room to spare, and the width used once there
 * are too many habits to fit the row.
 */
export const HABIT_COLUMN_WIDTH = 62;
/** The pinned DAY column on the left, same width as a fixed habit column. */
export const DAY_COLUMN_WIDTH = 62;

/**
 * Width of one habit column for `habitCount` habits in `availableWidth` points
 * (the space left of the pinned DAY column).
 *
 * The rule is "do they fit?", not a habit count. Whenever the columns can be
 * at least `HABIT_COLUMN_WIDTH` wide they divide the row evenly and fill it;
 * only when they can't does the grid fall back to fixed columns and scroll.
 *
 * A count-based cap (fill at 1–3, fixed at 4+) left dead paper at exactly the
 * counts where the habits would have fitted comfortably — four habits on a
 * 390pt phone stopped short of the right edge for no reason a user could see.
 *
 * Never narrower than a fixed column, so the touch-target floor always holds.
 */
export function computeColumnWidth(availableWidth: number, habitCount: number): number {
  if (habitCount <= 0 || availableWidth <= 0) {
    return HABIT_COLUMN_WIDTH;
  }
  return Math.max(HABIT_COLUMN_WIDTH, Math.floor(availableWidth / habitCount));
}

/**
 * True when `habitCount` columns fit in `availableWidth` without scrolling —
 * i.e. they've been stretched to fill the row. Drives `scrollEnabled`: a grid
 * that already fills the width must not rubber-band sideways.
 *
 * False while `availableWidth` is still 0 (before the first onLayout), which
 * keeps the pre-measurement frame on fixed columns.
 */
export function fitsWithoutScroll(availableWidth: number, habitCount: number): boolean {
  if (habitCount <= 0 || availableWidth <= 0) return false;
  return habitCount * HABIT_COLUMN_WIDTH <= availableWidth;
}
