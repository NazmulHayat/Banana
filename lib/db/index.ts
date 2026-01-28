export type {
  Habit,
  DailyEntry,
  HabitLog,
  AccountRow,
  ProfileRow,
  EntryRow,
  EntryMediaRow,
  HabitRow,
  HabitLogRow,
  EntryPayload,
  LegacyEntryPayload,
  HabitPayload,
  HabitLogPayload,
  KdfParams,
  EncryptedData,
} from './types';

export {
  Tables,
  AccountColumns,
  ProfileColumns,
  EntryColumns,
  EntryMediaColumns,
  HabitColumns,
  HabitLogColumns,
  UsernameRules,
  HabitLimits,
  DateFormats,
  SCHEMA_VERSION,
} from './schema';

export {
  saveEntry,
  getEntriesForDate,
  getEntriesForMonth,
  deleteEntry,
} from './entries';

export {
  saveHabits,
  getHabits,
  addHabit,
  updateHabit,
  deleteHabit,
  deleteAllHabits,
} from './habits';

export {
  toggleHabitLog,
  setHabitLog,
  getHabitLogsForMonth,
  getHabitLog,
  deleteLogsForHabit,
  deleteAllHabitLogs,
} from './habit-logs';

export { clearKeyCache } from './crypto';

export async function isDatabaseReady(): Promise<boolean> {
  const { isSupabaseConfigured, supabase } = await import('../supabase');
  if (!isSupabaseConfigured()) return false;
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

/**
 * Wait for authentication to be ready before proceeding.
 * Returns true if authenticated, false if timeout or not authenticated.
 */
export async function waitForAuth(maxWaitMs: number = 5000): Promise<boolean> {
  const { isSupabaseConfigured, supabase } = await import('../supabase');
  if (!isSupabaseConfigured()) return false;
  
  const startTime = Date.now();
  const checkInterval = 100; // Check every 100ms
  
  while (Date.now() - startTime < maxWaitMs) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      console.log('[DB] Auth ready after', Date.now() - startTime, 'ms');
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  console.warn('[DB] Auth not ready after', maxWaitMs, 'ms');
  return false;
}
