// What the analysis screen says before it has anything to show.
//
// A new account hits every "not enough data" state at once: a heatmap of empty
// squares, a chart with one bar, a trend with nothing to compare against. Left
// alone that reads as failure — the app looking blankly back at someone who has
// done nothing wrong except be new.
//
// So the copy is a function of how far along they actually are. It names the
// day they're on, and says what happens next rather than what's missing. It
// never counts a miss, never says "not enough", and never asks for anything.

/** Past this many days there is enough on screen to speak for itself. */
export const EARLY_DAYS = 28;

/**
 * A line for a page that can't draw itself yet, or `null` once it can.
 *
 * `days` is days since the user started tracking — the whole account for the
 * overview, one habit's life on its own page.
 */
export function earlyLine(days: number): string | null {
  if (days >= EARLY_DAYS) return null;
  if (days <= 0) return "Tick your first habit and this starts filling in.";
  if (days === 1) return "Day one. Everything here grows from this.";
  if (days < 4) {
    return `${days} days in. Tomorrow there's a line worth drawing.`;
  }
  if (days < 7) {
    const left = 7 - days;
    return `${days} days down — the first shapes show up in ${left} more.`;
  }
  if (days < 14) return "A week in. The grid is starting to say something.";
  if (days < 21) return "Two weeks. Give it a month and the trend gets honest.";
  return "Three weeks in. Nearly enough history to read properly.";
}

/**
 * The same idea for the Progress chart, which needs two whole months before a
 * comparison means anything — a longer wait than the grid's, so it gets its
 * own line rather than borrowing one that promises something sooner.
 */
export function earlyProgressLine(days: number): string {
  if (days <= 1) return "Keep going — this starts comparing once you have a month behind you.";
  if (days < 14) return "Keep going. This chart wakes up when you've got a second month to compare.";
  return "Almost — one more month and there's something to compare against.";
}
