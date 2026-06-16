// Centralized Data Store with Priority-Based, Progressive Loading
// Ensures UI never waits for "all data" before showing something

import type { Session } from "@supabase/supabase-js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getCachedEntriesForMonth,
  getEntriesForMonth,
  setCachedEntriesForMonth,
} from "./db/entries";
import {
  getCachedHabitLogsForMonth,
  getHabitLogsForMonthDirect,
  setCachedHabitLogsForMonth,
} from "./db/habit-logs";
import { getCachedHabits, getHabits, setCachedHabits } from "./db/habits";
import { DateFormats } from "./db/schema";
import type { DailyEntry, Habit, HabitLog } from "./db/types";
import { supabase } from "./supabase";

// Profile data from accounts table (not the encrypted ProfileRow)
interface ProfileData {
  id: string;
  username: string | null;
  created_at: string;
}

// ============================================================================
// Types
// ============================================================================

interface DataState {
  // Habits (loaded once, rarely changes)
  habits: Habit[];
  habitsLoading: boolean;
  habitsReady: boolean;

  // Habit logs per month - progressively loaded
  habitLogs: Map<string, HabitLog[]>; // key: "YYYY-MM"
  habitLogsByDay: Map<string, HabitLog[]>; // key: "YYYY-MM-DD" for progressive render
  habitLogsLoading: boolean;
  habitLogsReady: boolean;
  habitLogsProgress: number; // 0-1 for current month loading progress

  // Entries per month
  entries: Map<string, DailyEntry[]>; // key: "YYYY-MM"
  entriesLoading: boolean;
  entriesReady: boolean;

  // Profile data (username, etc.)
  profile: ProfileData | null;
  profileLoading: boolean;
  profileReady: boolean;

  // Overall state
  initialLoadComplete: boolean;
}

interface DataActions {
  // Refresh specific data. Pass force: true to bypass the in-memory cache
  // and re-fetch from the server (used by pull-to-refresh).
  refreshHabits: (opts?: { force?: boolean }) => Promise<Habit[]>;
  refreshHabitLogs: (
    year: number,
    month: number,
    opts?: { force?: boolean },
  ) => Promise<HabitLog[]>;
  refreshEntries: (
    year: number,
    month: number,
    opts?: { force?: boolean },
  ) => Promise<DailyEntry[]>;
  refreshProfile: () => Promise<void>;

  // Get data for specific month (uses cache or fetches)
  getLogsForMonth: (year: number, month: number) => HabitLog[];
  getEntriesForMonth: (year: number, month: number) => DailyEntry[];

  // Local updates (optimistic)
  updateHabits: (habits: Habit[]) => void;
  updateHabitLog: (log: HabitLog) => void;
  updateEntry: (entry: DailyEntry) => void;

  // Reset on logout
  clearAll: () => void;
}

interface DataContextValue extends DataState, DataActions {}

// ============================================================================
// Context
// ============================================================================

const DataContext = createContext<DataContextValue | null>(null);

export function useDataStore() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useDataStore must be used within DataProvider");
  }
  return ctx;
}

// ============================================================================
// Provider
// ============================================================================

interface DataProviderProps {
  children: React.ReactNode;
  session: Session | null;
}

export function DataProvider({ children, session }: DataProviderProps) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitsLoading, setHabitsLoading] = useState(false);
  const [habitsReady, setHabitsReady] = useState(false);

  const [habitLogs, setHabitLogs] = useState<Map<string, HabitLog[]>>(
    new Map(),
  );
  const [habitLogsByDay, setHabitLogsByDay] = useState<Map<string, HabitLog[]>>(
    new Map(),
  );
  const [habitLogsLoading, setHabitLogsLoading] = useState(false);
  const [habitLogsReady, setHabitLogsReady] = useState(false);
  const [habitLogsProgress, setHabitLogsProgress] = useState(0);

  const [entries, setEntries] = useState<Map<string, DailyEntry[]>>(new Map());
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesReady, setEntriesReady] = useState(false);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  const [initialLoadComplete, setInitialLoadComplete] = useState(false);

  const prefetchedRef = useRef(false);

  // ============================================================================
  // Helper: Format month key
  // ============================================================================
  const getMonthKey = (year: number, month: number) =>
    DateFormats.formatYearMonth(year, month);

  // ============================================================================
  // Fetch Habits
  // ============================================================================
  const refreshHabits = useCallback(
    async (opts?: { force?: boolean }): Promise<Habit[]> => {
      if (!session) return [];

      const userId = session.user.id;

      if (!opts?.force) {
        const cached = getCachedHabits(userId);
        if (cached && cached.length > 0) {
          setHabits(cached);
          setHabitsReady(true);
          return cached;
        }
      }

      setHabitsLoading(true);
      try {
        const fresh = await getHabits();
        setHabits(fresh);
        setCachedHabits(userId, fresh);
        setHabitsReady(true);
        return fresh;
      } finally {
        setHabitsLoading(false);
      }
    },
    [session],
  );

  // ============================================================================
  // Fetch Habit Logs
  // ============================================================================
  const refreshHabitLogs = useCallback(
    async (
      year: number,
      month: number,
      opts?: { force?: boolean },
    ): Promise<HabitLog[]> => {
      if (!session) return [];

      const userId = session.user.id;
      const monthKey = getMonthKey(year, month);

      const cached = opts?.force
        ? null
        : getCachedHabitLogsForMonth(year, month, userId);
      if (cached && cached.length > 0) {
        setHabitLogs((prev) => new Map(prev).set(monthKey, cached));
        const byDay = new Map<string, HabitLog[]>();
        for (const log of cached) {
          const dayLogs = byDay.get(log.date) || [];
          dayLogs.push(log);
          byDay.set(log.date, dayLogs);
        }
        setHabitLogsByDay((prev) => {
          const next = new Map(prev);
          byDay.forEach((dayLogs, key) => next.set(key, dayLogs));
          return next;
        });
        setHabitLogsReady(true);
        return cached;
      }

      // Fetch from network
      setHabitLogsLoading(true);
      try {
        const logs = await getHabitLogsForMonthDirect(year, month);

        setHabitLogs((prev) => new Map(prev).set(monthKey, logs));
        const byDay = new Map<string, HabitLog[]>();
        for (const log of logs) {
          const dayLogs = byDay.get(log.date) || [];
          dayLogs.push(log);
          byDay.set(log.date, dayLogs);
        }
        setHabitLogsByDay((prev) => {
          const next = new Map(prev);
          byDay.forEach((dayLogs, key) => next.set(key, dayLogs));
          return next;
        });
        setHabitLogsReady(true);

        setCachedHabitLogsForMonth(year, month, userId, logs);
        return logs;
      } finally {
        setHabitLogsLoading(false);
      }
    },
    [session],
  );

  // ============================================================================
  // Fetch Entries
  // ============================================================================
  const refreshEntries = useCallback(
    async (
      year: number,
      month: number,
      opts?: { force?: boolean },
    ): Promise<DailyEntry[]> => {
      if (!session) return [];

      const userId = session.user.id;
      const monthKey = getMonthKey(year, month);

      // Cache short-circuit only when NOT forced. Pull-to-refresh forces
      // through to the network so the user can see fresh server state.
      if (!opts?.force) {
        const cached = getCachedEntriesForMonth(year, month, userId);
        if (cached && cached.length > 0) {
          setEntries((prev) => new Map(prev).set(monthKey, cached));
          setEntriesReady(true);
          return cached;
        }
      }

      // Fetch from network
      setEntriesLoading(true);
      try {
        const fresh = await getEntriesForMonth(year, month);
        setEntries((prev) => new Map(prev).set(monthKey, fresh));
        setCachedEntriesForMonth(year, month, userId, fresh);
        setEntriesReady(true);
        return fresh;
      } finally {
        setEntriesLoading(false);
      }
    },
    [session],
  );

  // ============================================================================
  // Fetch Profile (Parallel Block 1)
  // ============================================================================
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (!session) return;

    const userId = session.user.id;

    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, username, created_at")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("[DataStore] Profile fetch error:", error);
        return;
      }

      if (data) {
        setProfile({
          id: data.id,
          username: data.username,
          created_at: data.created_at,
        });
      }
      setProfileReady(true);
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  // ============================================================================
  // Get data for specific month (uses cached state)
  // ============================================================================
  const getLogsForMonth = useCallback(
    (year: number, month: number): HabitLog[] => {
      const monthKey = getMonthKey(year, month);
      return habitLogs.get(monthKey) || [];
    },
    [habitLogs],
  );

  const getEntriesForMonthData = useCallback(
    (year: number, month: number): DailyEntry[] => {
      const monthKey = getMonthKey(year, month);
      return entries.get(monthKey) || [];
    },
    [entries],
  );

  // ============================================================================
  // Local Updates (Optimistic UI)
  // ============================================================================
  const updateHabits = useCallback(
    (newHabits: Habit[]) => {
      setHabits(newHabits);
      if (session) {
        setCachedHabits(session.user.id, newHabits);
      }
    },
    [session],
  );

  const updateHabitLog = useCallback(
    (log: HabitLog) => {
      if (!session) return;

      const userId = session.user.id;
      const monthKey = log.date.slice(0, 7);
      const [yearStr, monthStr] = monthKey.split("-");
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      // Update monthly logs
      setHabitLogs((prev) => {
        const next = new Map(prev);
        const monthLogs = [...(next.get(monthKey) || [])];
        const existingIndex = monthLogs.findIndex(
          (l) => l.habitId === log.habitId && l.date === log.date,
        );
        if (existingIndex >= 0) {
          monthLogs[existingIndex] = log;
        } else {
          monthLogs.push(log);
        }
        next.set(monthKey, monthLogs);

        // Update cache
        setCachedHabitLogsForMonth(year, month, userId, monthLogs);
        return next;
      });

      // Update day-by-day cache
      setHabitLogsByDay((prev) => {
        const next = new Map(prev);
        const dayLogs = [...(next.get(log.date) || [])];
        const existingIndex = dayLogs.findIndex(
          (l) => l.habitId === log.habitId,
        );
        if (existingIndex >= 0) {
          dayLogs[existingIndex] = log;
        } else {
          dayLogs.push(log);
        }
        next.set(log.date, dayLogs);
        return next;
      });
    },
    [session],
  );

  const updateEntry = useCallback(
    (entry: DailyEntry) => {
      if (!session) return;

      const userId = session.user.id;
      const monthKey = entry.date.slice(0, 7);
      const [yearStr, monthStr] = monthKey.split("-");
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      setEntries((prev) => {
        const next = new Map(prev);
        const monthEntries = [...(next.get(monthKey) || [])];
        const existingIndex = monthEntries.findIndex((e) => e.id === entry.id);
        if (existingIndex >= 0) {
          monthEntries[existingIndex] = entry;
        } else {
          monthEntries.push(entry);
        }
        next.set(monthKey, monthEntries);

        // Update cache
        setCachedEntriesForMonth(year, month, userId, monthEntries);
        return next;
      });
    },
    [session],
  );

  // ============================================================================
  // Clear on Logout
  // ============================================================================
  const clearAll = useCallback(() => {
    setHabits([]);
    setHabitsLoading(false);
    setHabitsReady(false);
    setHabitLogs(new Map());
    setHabitLogsByDay(new Map());
    setHabitLogsLoading(false);
    setHabitLogsReady(false);
    setHabitLogsProgress(0);
    setEntries(new Map());
    setEntriesLoading(false);
    setEntriesReady(false);
    setProfile(null);
    setProfileLoading(false);
    setProfileReady(false);
    setInitialLoadComplete(false);
    prefetchedRef.current = false;
  }, []);

  // ============================================================================
  // Priority-Based Initial Load
  // ============================================================================
  useEffect(() => {
    if (!session || prefetchedRef.current) return;
    prefetchedRef.current = true;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    async function load() {
      await Promise.all([
        refreshHabits(),
        refreshHabitLogs(year, month),
        refreshEntries(year, month),
        refreshProfile(),
      ]);

      setInitialLoadComplete(true);
    }

    void load();
  }, [
    session,
    refreshHabits,
    refreshHabitLogs,
    refreshEntries,
    refreshProfile,
  ]);

  // Clear data on logout
  useEffect(() => {
    if (!session) {
      clearAll();
    }
  }, [session, clearAll]);

  // ============================================================================
  // Context Value
  // ============================================================================
  const value = useMemo<DataContextValue>(
    () => ({
      // State
      habits,
      habitsLoading,
      habitsReady,
      habitLogs,
      habitLogsByDay,
      habitLogsLoading,
      habitLogsReady,
      habitLogsProgress,
      entries,
      entriesLoading,
      entriesReady,
      profile,
      profileLoading,
      profileReady,
      initialLoadComplete,

      // Actions
      refreshHabits,
      refreshHabitLogs,
      refreshEntries,
      refreshProfile,
      getLogsForMonth,
      getEntriesForMonth: getEntriesForMonthData,
      updateHabits,
      updateHabitLog,
      updateEntry,
      clearAll,
    }),
    [
      habits,
      habitsLoading,
      habitsReady,
      habitLogs,
      habitLogsByDay,
      habitLogsLoading,
      habitLogsReady,
      habitLogsProgress,
      entries,
      entriesLoading,
      entriesReady,
      profile,
      profileLoading,
      profileReady,
      initialLoadComplete,
      refreshHabits,
      refreshHabitLogs,
      refreshEntries,
      refreshProfile,
      getLogsForMonth,
      getEntriesForMonthData,
      updateHabits,
      updateHabitLog,
      updateEntry,
      clearAll,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
