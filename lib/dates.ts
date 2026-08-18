// Calendar day keys — the single sanctioned source of user-facing dates.
//
// WHY THIS FILE EXISTS (bug D1): day keys used to be built two different ways —
// `date.toISOString().split("T")[0]` (UTC) in the entry/stat paths, and a
// hand-rolled `${year}-${month}-${day}` from a local `Date` in the habit grid.
// Those two disagree for part of every day (any zone offset from UTC), so a
// user west of UTC tapping a habit cell after ~16:00 local marked a DIFFERENT
// day than the highlight they saved minutes later. That is silent data
// corruption, not a cosmetic glitch.
//
// The rule: a user-facing calendar key is ALWAYS the user's LOCAL calendar
// date. A day key is what the human saw on the wall calendar when they tapped.
// Every construction and parse of a "YYYY-MM-DD" / "YYYY-MM" string goes
// through the helpers below — never `toISOString()`, never an ad-hoc template
// literal. `toISOString()` stays legal for true instants (createdAt, queuedAt).
//
// NOT in scope: the integer day-index math in `lib/stats.ts` (`dayIndex` /
// `ymdFromIndex`) deliberately round-trips through UTC to get a stable,
// DST-proof index. That is correct and intentionally left alone — this module
// governs key CONSTRUCTION only, never the indexing math.
//
// Zero dependencies by design: these helpers run in the app, in tests, and in
// any Node script without pulling React Native or Supabase in behind them.

/** Matches a strict "YYYY-MM-DD" calendar key. */
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local "YYYY-MM-DD" for a Date. */
export function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local "YYYY-MM-DD" for right now. The only way to ask "what day is it?". */
export function todayKey(): string {
  return toDayKey(new Date());
}

/**
 * Local midnight for a "YYYY-MM-DD" key — the inverse of `toDayKey`.
 * An unparseable key yields an Invalid Date (callers degrade, never crash).
 * On a DST spring-forward date where local midnight doesn't exist the runtime
 * shifts forward an hour; the key still round-trips.
 */
export function fromDayKey(key: string): Date {
  const m = DAY_KEY_PATTERN.exec(key);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Numeric parts of a day key, or null if it isn't one. Month is 1-12. */
export function parseDayKey(
  key: string,
): { year: number; month: number; day: number } | null {
  const m = DAY_KEY_PATTERN.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Local "YYYY-MM" for a Date (cache/month-bucket keys). */
export function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** "YYYY-MM" from explicit parts. Month is 1-12. */
export function monthKeyOfParts(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/**
 * Is `key` after `today` (defaults to the local today)? Day keys are
 * zero-padded and fixed-width, so lexicographic order is calendar order.
 */
export function isFutureDay(key: string, today: string = todayKey()): boolean {
  return key > today;
}

/** Number of days in a local calendar month. Month is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
