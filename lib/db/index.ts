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
  WriteOutcome,
} from "./types";

export { UnrecoverableWriteError } from "./types";

export {
  AccountColumns,
  DateFormats,
  EntryColumns,
  EntryMediaColumns,
  HabitColumns,
  HabitLimits,
  HabitLogColumns,
  ProfileColumns,
  SCHEMA_VERSION,
  Tables,
  UsernameRules,
} from "./schema";

export {
  clearEntriesCache,
  deleteEntry,
  getCachedEntriesForMonth,
  getEntriesForDate,
  getEntriesForMonth,
  loadEntriesForMonthFromStorage,
  prefetchEntriesForMonth,
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
  getCachedHabitLogsForMonth,
  getHabitLogsForMonth,
  getHabitLogsForMonthDirect,
  loadHabitLogsFromStorage,
  setCachedHabitLogsForMonth,
  toggleHabitLog,
  upsertHabitLog,
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
