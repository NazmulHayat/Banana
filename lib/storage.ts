import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  HABITS: '@habits',
  ENTRIES: '@entries',
  LOGS: '@habit_logs',
  INITIALIZED: '@initialized',
};

export interface Habit {
  id: string;
  name: string;
  createdAt: string;
}

export interface DailyEntry {
  id: string;
  date: string;
  text: string;
  mediaUrls: string[];
  createdAt: string;
}

export interface HabitLog {
  habitId: string;
  date: string;
  completed: boolean;
}

export const storage = {
  async getHabits(): Promise<Habit[]> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.HABITS);
    return data ? JSON.parse(data) : [];
  },

  async saveHabits(habits: Habit[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.HABITS, JSON.stringify(habits));
  },

  async getDailyEntry(date: string): Promise<DailyEntry | null> {
    const entries = await storage.getDailyEntries();
    return entries.find((e) => e.date === date) || null;
  },

  async getDailyEntriesForDate(date: string): Promise<DailyEntry[]> {
    const entries = await storage.getDailyEntries();
    return entries.filter((e) => e.date === date);
  },

  async getDailyEntries(): Promise<DailyEntry[]> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.ENTRIES);
    return data ? JSON.parse(data) : [];
  },

  async canAddEntryForDate(date: string): Promise<boolean> {
    const entriesForDate = await storage.getDailyEntriesForDate(date);
    return entriesForDate.length < 2; // Max 2 entries per day
  },

  async saveDailyEntry(entry: DailyEntry): Promise<void> {
    const entries = await storage.getDailyEntries();
    
    // Check if this is an update to existing entry (same id)
    const existingIndex = entries.findIndex((e) => e.id === entry.id);
    if (existingIndex >= 0) {
      // Update existing entry
      entries[existingIndex] = entry;
    } else {
      // Adding new entry - check limit (max 2 per day)
      const entriesForDate = entries.filter((e) => e.date === entry.date);
      if (entriesForDate.length >= 2) {
        console.warn('Cannot add more than 2 entries per day');
        return;
      }
      entries.push(entry);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.ENTRIES, JSON.stringify(entries));
  },

  async getHabitLogs(month: number, year: number): Promise<HabitLog[]> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.LOGS);
    const allLogs: HabitLog[] = data ? JSON.parse(data) : [];
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    return allLogs.filter((log) => log.date.startsWith(monthStr));
  },

  async toggleHabitLog(habitId: string, date: string): Promise<void> {
    const allLogs = await storage.getAllHabitLogs();
    const index = allLogs.findIndex((log) => log.habitId === habitId && log.date === date);
    
    if (index >= 0) {
      allLogs[index].completed = !allLogs[index].completed;
    } else {
      allLogs.push({ habitId, date, completed: true });
    }
    
    await AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(allLogs));
  },

  async getAllHabitLogs(): Promise<HabitLog[]> {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.LOGS);
    return data ? JSON.parse(data) : [];
  },

  async isInitialized(): Promise<boolean> {
    const value = await AsyncStorage.getItem(STORAGE_KEYS.INITIALIZED);
    return value === 'true';
  },

  async setInitialized(): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.HABITS,
      STORAGE_KEYS.ENTRIES,
      STORAGE_KEYS.LOGS,
      STORAGE_KEYS.INITIALIZED,
    ]);
  },
};