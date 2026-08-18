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
  Habit,
  HabitLog,
  HabitLogPayload,
  HabitPayload,
} from "./types";

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
  pendingWriteCount,
  removePendingWrite,
} from "./pending-writes";
