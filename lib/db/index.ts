// Local-time calendar keys (bug D1) — re-exported so `@/lib/db` consumers get
// the sanctioned constructors alongside the types they already import.
export {
  daysInMonth,
  fromDayKey,
  isFutureDay,
  monthKeyOf,
  monthKeyOfParts,
  parseDayKey,
  toDayKey,
  todayKey,
} from "../dates";

export type {
  AccountRow,
  DailyEntry,
  EntryPayload,
  EntryRef,
  Habit,
  HabitLog,
  HabitLogPayload,
  HabitPayload,
  HabitRef,
  MonthRef,
  ReadResult,
  WriteOutcome,
} from "./types";

export { UnrecoverableWriteError } from "./types";

export { DateFormats, HabitLimits, UsernameRules } from "./schema";

export {
  clearEntriesCache,
  deleteEntry,
  getCachedEntriesForMonth,
  getEntriesForMonths,
  loadEntriesForMonthFromStorage,
  removeEntryFromCache,
  saveEntry,
  setCachedEntriesForMonth,
  upsertEntryInCache,
} from "./entries";

export {
  clearHabitsCache,
  getCachedHabits,
  getHabits,
  loadHabitsFromStorage,
  saveHabits,
  setCachedHabits,
} from "./habits";

export {
  clearHabitLogsCache,
  deleteHabitLogsForHabit,
  enumeratePurgeDays,
  getCachedHabitLogsForMonth,
  getHabitLogsForMonths,
  type HabitLogPurgeRange,
  loadHabitLogsFromStorage,
  setCachedHabitLogsForMonth,
  upsertHabitLog,
  upsertHabitLogInCache,
} from "./habit-logs";

export {
  clearPendingWrites,
  enqueuePendingWrite,
  flushPendingWrites,
  getPendingWrites,
  type PendingWrite,
  type PendingWriteBody,
  pendingWriteCount,
  pendingWriteKey,
  removePendingWrite,
} from "./pending-writes";
