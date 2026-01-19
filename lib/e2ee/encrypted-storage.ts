/**
 * Encrypted storage layer
 * Syncs encrypted data to/from Supabase while maintaining local cache
 */

import { supabase } from '../supabase';
import { storage, Habit, DailyEntry, HabitLog } from '../storage';
import {
  encryptJson,
  decryptJson,
  generateDayBucket,
  generateMonthBucket,
} from './crypto';
import { getMasterKey, getBucketKey, isKeyringUnlocked } from './keyring';

/**
 * Check if E2EE is available (keyring unlocked)
 */
export function isEncryptionReady(): boolean {
  return isKeyringUnlocked();
}

/**
 * Encrypted entry payload (what gets encrypted)
 * Now stores an array of entries to support multiple entries per day
 */
interface EntryPayload {
  entries: Array<{
    id: string;
    text: string;
    createdAt: string;
    localMediaUrls?: string[];
  }>;
  date: string;
}

/**
 * Encrypted habit payload
 */
interface HabitPayload {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Encrypted habit log payload
 */
interface HabitLogPayload {
  habitId: string;
  date: string;
  completed: boolean;
}

// ==================== ENTRIES ====================

/**
 * Save a daily entry (encrypted to Supabase + local cache)
 * Aggregates all entries for the day into a single encrypted record
 */
export async function saveEncryptedEntry(entry: DailyEntry): Promise<void> {
  // Always save to local storage first
  await storage.saveDailyEntry(entry);

  // If not unlocked, skip remote sync
  if (!isKeyringUnlocked()) {
    console.log('Keyring locked, entry saved locally only');
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const masterKey = getMasterKey();
  const bucketKey = getBucketKey();

  // Get ALL entries for this date from local storage (to aggregate them)
  const allEntriesForDate = await storage.getDailyEntriesForDate(entry.date);

  // Generate buckets
  const dayBucket = generateDayBucket(bucketKey, entry.date);
  const monthBucket = generateMonthBucket(bucketKey, entry.date.slice(0, 7));

  // Encrypt payload with ALL entries for this day
  const payload: EntryPayload = {
    date: entry.date,
    entries: allEntriesForDate.map(e => ({
      id: e.id,
      text: e.text,
      createdAt: e.createdAt,
      localMediaUrls: e.mediaUrls,
    })),
  };
  const { ciphertext, nonce } = encryptJson(payload, masterKey);

  // Upsert to Supabase (use day_bucket for uniqueness)
  const { error } = await supabase
    .from('entries')
    .upsert({
      owner_id: user.id,
      day_bucket: dayBucket,
      month_bucket: monthBucket,
      ciphertext,
      nonce,
      version: 1,
    }, {
      onConflict: 'owner_id,day_bucket',
    });

  if (error) {
    console.error('Failed to sync entry:', error.message);
  }
}

/**
 * Legacy payload format (for backwards compatibility)
 */
interface LegacyEntryPayload {
  text: string;
  date: string;
  createdAt: string;
  localMediaUrls?: string[];
}

/**
 * Load entries for a month from Supabase
 */
export async function loadEncryptedEntriesForMonth(
  year: number,
  month: number
): Promise<DailyEntry[]> {
  // If keyring locked, return local entries
  if (!isKeyringUnlocked()) {
    return storage.getDailyEntries().then(entries => 
      entries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      })
    );
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return storage.getDailyEntries();
  }

  const masterKey = getMasterKey();
  const bucketKey = getBucketKey();

  // Generate month bucket
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const monthBucket = generateMonthBucket(bucketKey, yearMonth);

  // Fetch encrypted entries
  const { data: rows, error } = await supabase
    .from('entries')
    .select('id, ciphertext, nonce, created_at')
    .eq('owner_id', user.id)
    .eq('month_bucket', monthBucket);

  if (error) {
    console.error('Failed to load entries:', error.message);
    return storage.getDailyEntries();
  }

  // Decrypt - handle both new format (array) and legacy format (single)
  const entries: DailyEntry[] = [];
  for (const row of rows || []) {
    try {
      const decrypted = decryptJson<EntryPayload | LegacyEntryPayload>(row.ciphertext, masterKey, row.nonce);
      
      // Check if it's the new format (has 'entries' array)
      if ('entries' in decrypted && Array.isArray(decrypted.entries)) {
        // New format: multiple entries per day
        for (const e of decrypted.entries) {
          entries.push({
            id: e.id,
            date: decrypted.date,
            text: e.text,
            mediaUrls: e.localMediaUrls || [],
            createdAt: e.createdAt,
          });
        }
      } else {
        // Legacy format: single entry
        const legacy = decrypted as LegacyEntryPayload;
        entries.push({
          id: row.id,
          date: legacy.date,
          text: legacy.text,
          mediaUrls: legacy.localMediaUrls || [],
          createdAt: legacy.createdAt,
        });
      }
    } catch (err) {
      console.error('Failed to decrypt entry:', err);
    }
  }

  return entries;
}

// ==================== HABITS ====================

/**
 * Save habits (encrypted to Supabase + local cache)
 */
export async function saveEncryptedHabits(habits: Habit[]): Promise<void> {
  // Always save locally
  await storage.saveHabits(habits);

  if (!isKeyringUnlocked()) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const masterKey = getMasterKey();

  // Delete existing habits and insert new ones (simple approach for v1)
  const { error: deleteError } = await supabase.from('habits').delete().eq('owner_id', user.id);
  if (deleteError) {
    console.error('Failed to delete existing habits:', deleteError.message);
    return;
  }

  for (const habit of habits) {
    const payload: HabitPayload = {
      id: habit.id,
      name: habit.name,
      createdAt: habit.createdAt,
    };
    const { ciphertext, nonce } = encryptJson(payload, masterKey);

    // Don't pass id - let Supabase generate UUID
    // The local habit.id is stored inside the encrypted payload
    const { error } = await supabase.from('habits').insert({
      owner_id: user.id,
      ciphertext,
      nonce,
      version: 1,
    });
    
    if (error) {
      console.error('Failed to sync habit:', habit.name, error.message);
    }
  }
}

/**
 * Load habits from Supabase
 */
export async function loadEncryptedHabits(): Promise<Habit[]> {
  if (!isKeyringUnlocked()) {
    return storage.getHabits();
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return storage.getHabits();
  }

  const masterKey = getMasterKey();

  const { data: rows, error } = await supabase
    .from('habits')
    .select('id, ciphertext, nonce')
    .eq('owner_id', user.id);

  if (error) {
    console.error('Failed to load habits:', error.message);
    return storage.getHabits();
  }

  const habits: Habit[] = [];
  for (const row of rows || []) {
    try {
      const payload = decryptJson<HabitPayload>(row.ciphertext, masterKey, row.nonce);
      habits.push({
        id: payload.id,
        name: payload.name,
        createdAt: payload.createdAt,
      });
    } catch (err) {
      console.error('Failed to decrypt habit:', err);
    }
  }

  // Update local cache
  if (habits.length > 0) {
    await storage.saveHabits(habits);
  }

  return habits.length > 0 ? habits : storage.getHabits();
}

// ==================== HABIT LOGS ====================

/**
 * Toggle a habit log (encrypted)
 */
export async function toggleEncryptedHabitLog(
  habitId: string,
  date: string
): Promise<void> {
  // Always update locally
  await storage.toggleHabitLog(habitId, date);

  if (!isKeyringUnlocked()) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const masterKey = getMasterKey();
  const bucketKey = getBucketKey();

  // Get current state from local
  const allLogs = await storage.getAllHabitLogs();
  const log = allLogs.find(l => l.habitId === habitId && l.date === date);
  const completed = log?.completed ?? false;

  // Generate buckets - include habitId in day bucket for uniqueness per habit per day
  const dayBucket = generateDayBucket(bucketKey, `${habitId}:${date}`);
  const monthBucket = generateMonthBucket(bucketKey, date.slice(0, 7));

  const payload: HabitLogPayload = {
    habitId,
    date,
    completed,
  };
  const { ciphertext, nonce } = encryptJson(payload, masterKey);

  // First check if a log exists for this day_bucket
  const { data: existing } = await supabase
    .from('habit_logs')
    .select('id')
    .eq('owner_id', user.id)
    .eq('day_bucket', dayBucket)
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('habit_logs')
      .update({
        ciphertext,
        nonce,
        version: 1,
      })
      .eq('id', existing.id);
    
    if (error) {
      console.error('Failed to update habit log:', error.message);
    }
  } else {
    // Insert new (let Supabase generate UUID)
    const { error } = await supabase.from('habit_logs').insert({
      owner_id: user.id,
      day_bucket: dayBucket,
      month_bucket: monthBucket,
      ciphertext,
      nonce,
      version: 1,
    });
    
    if (error) {
      console.error('Failed to insert habit log:', error.message);
    }
  }
}

/**
 * Load habit logs for a month
 */
export async function loadEncryptedHabitLogs(
  month: number,
  year: number
): Promise<HabitLog[]> {
  if (!isKeyringUnlocked()) {
    return storage.getHabitLogs(month, year);
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return storage.getHabitLogs(month, year);
  }

  const masterKey = getMasterKey();
  const bucketKey = getBucketKey();

  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const monthBucket = generateMonthBucket(bucketKey, yearMonth);

  const { data: rows, error } = await supabase
    .from('habit_logs')
    .select('ciphertext, nonce')
    .eq('owner_id', user.id)
    .eq('month_bucket', monthBucket);

  if (error) {
    console.error('Failed to load habit logs:', error.message);
    return storage.getHabitLogs(month, year);
  }

  const logs: HabitLog[] = [];
  for (const row of rows || []) {
    try {
      const payload = decryptJson<HabitLogPayload>(row.ciphertext, masterKey, row.nonce);
      logs.push({
        habitId: payload.habitId,
        date: payload.date,
        completed: payload.completed,
      });
    } catch (err) {
      console.error('Failed to decrypt habit log:', err);
    }
  }

  return logs.length > 0 ? logs : storage.getHabitLogs(month, year);
}

// ==================== SYNC HELPERS ====================

/**
 * Sync all local data to Supabase (initial upload after setting password)
 */
export async function syncLocalDataToCloud(): Promise<void> {
  if (!isKeyringUnlocked()) {
    throw new Error('Keyring must be unlocked to sync');
  }

  // Sync habits
  const habits = await storage.getHabits();
  if (habits.length > 0) {
    await saveEncryptedHabits(habits);
  }

  // Sync entries - group by date first to avoid duplicating work
  const entries = await storage.getDailyEntries();
  const datesSynced = new Set<string>();
  for (const entry of entries) {
    // Only sync once per date (saveEncryptedEntry aggregates all entries for a day)
    if (!datesSynced.has(entry.date)) {
      await saveEncryptedEntry(entry);
      datesSynced.add(entry.date);
    }
  }

  // Sync habit logs
  const logs = await storage.getAllHabitLogs();
  for (const log of logs) {
    if (log.completed) {
      await toggleEncryptedHabitLog(log.habitId, log.date);
    }
  }

  console.log('Local data synced to cloud');
}
