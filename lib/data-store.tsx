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
import { AppState } from "react-native";
import {
  deleteEntry as dbDeleteEntry,
  getCachedEntriesForMonth,
  getEntriesForMonth,
  loadEntriesForMonthFromStorage,
  saveEntry as dbSaveEntry,
  setCachedEntriesForMonth,
} from "./db/entries";
import {
  deleteHabitLogsForHabit as dbDeleteHabitLogsForHabit,
  getCachedHabitLogsForMonth,
  getHabitLogsForMonthDirect,
  loadHabitLogsFromStorage,
  setCachedHabitLogsForMonth,
  upsertHabitLog as dbUpsertHabitLog,
} from "./db/habit-logs";
import {
  getCachedHabits,
  getHabits,
  loadHabitsFromStorage,
  saveHabits as dbSaveHabits,
  setCachedHabits,
} from "./db/habits";
import {
  clearPendingWrites,
  enqueuePendingWrite,
  flushPendingWrites,
  pendingWriteCount as dbPendingWriteCount,
  type PendingWrite,
  type PendingWriteBody,
} from "./db/pending-writes";
import { DateFormats } from "./db/schema";
import type { DailyEntry, Habit, HabitLog, WriteOutcome } from "./db/types";
import { UnrecoverableWriteError } from "./db/types";
import { supabase } from "./supabase";

// ============================================================================
// Write outcomes (NFR-1)
// ============================================================================
// Store write actions never throw — they report a WriteOutcome. `synced` means
// the server took it, `queued` means it's durably parked for the next flush,
// `failed` means it can't be attempted at all right now.
const SYNCED: WriteOutcome = { status: "synced" };
const QUEUED: WriteOutcome = { status: "queued" };

// User-safe copy for the `failed` outcome. Only errors WE raise
// (UnrecoverableWriteError, thrown by lib/db with an authored message) can land
// here; a server/network Error is queued instead, so no raw Supabase message
// can ever reach the UI through `reason`.
const FAILED_REASONS: Record<string, string> = {
  "Encryption is locked": "Your data is locked. Unlock the app and try again.",
  "Not signed in": "You're signed out. Sign in again to save.",
  "Could not read that day's entries": "That entry couldn't be read, so it can't be changed.",
};
const GENERIC_FAILURE = "Couldn't save that. Please try again.";

function failed(error: unknown): WriteOutcome {
  const message = error instanceof Error ? error.message : "";
  return { status: "failed", reason: FAILED_REASONS[message] ?? GENERIC_FAILURE };
}

/** `failed` beats `queued` beats `synced` when one action does several writes. */
function worstOutcome(outcomes: WriteOutcome[]): WriteOutcome {
  const failure = outcomes.find((o) => o.status === "failed");
  if (failure) return failure;
  return outcomes.some((o) => o.status === "queued") ? QUEUED : SYNCED;
}

// ============================================================================
// Single-flight helper
// ============================================================================
// Shares one in-flight promise per key so concurrent callers (two screens
// mounting the same month, init + an AppState→active flush, …) issue a single
// request instead of duplicate round-trips. The entry is always removed in
// `finally`, so a rejection never poisons the key for the next attempt.
// Module-level (not a hook) so its identity is stable and it stays out of the
// callback dependency arrays below.
function singleFlight<T>(
  inFlight: Map<string, Promise<unknown>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const started = run().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

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

  // Durable pending-writes queue (NFR-1). Count of saves that failed and are
  // queued for retry; refreshed after each flush. A future slice surfaces this
  // as a "will sync" indicator.
  pendingWriteCount: number;
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

  // Local updates (optimistic, no persistence)
  updateHabits: (habits: Habit[]) => void;
  updateHabitLog: (log: HabitLog) => void;
  updateEntry: (entry: DailyEntry) => void;

  // Persisted writes. These update local state optimistically, then write
  // through — and they NEVER throw: the WriteOutcome is the channel (NFR-1).
  saveEntry: (entry: DailyEntry) => Promise<WriteOutcome>;
  deleteEntry: (entry: DailyEntry) => Promise<WriteOutcome>;
  /**
   * Replace the whole habit list (create / rename / delete / reorder — array
   * order is the persisted order). Habits missing from `next` also get their
   * habit logs purged (D12), queued with the same durability as any write.
   */
  saveHabits: (next: Habit[]) => Promise<WriteOutcome>;
  /**
   * Flip one habit-log cell. `currentCompleted` may be passed by callers that
   * already read it from local state; otherwise it's derived from the store.
   */
  toggleHabitLog: (
    habitId: string,
    date: string,
    currentCompleted?: boolean,
  ) => Promise<WriteOutcome>;
  /** Retry the queued writes now (also runs on init and on app-foreground). */
  flushPendingWrites: () => Promise<void>;

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

  const [pendingWriteCount, setPendingWriteCount] = useState(0);

  const prefetchedRef = useRef(false);

  // ==========================================================================
  // Read-path bookkeeping
  // ==========================================================================
  // Keys resolved during this session ("habits:<uid>", "entries:<uid>:YYYY-MM",
  // "logs:<uid>:YYYY-MM"). A key lands here whichever tier answered — memory,
  // AsyncStorage or the network — and an empty result counts as resolved, so a
  // genuinely empty month no longer looks like "never loaded" and re-fetches
  // forever. It also gates the AsyncStorage tier: that tier is for cold start /
  // offline, so once a key has been resolved here we skip it and go to the
  // network (a write that invalidates the in-memory month must not be answered
  // from a stale on-disk copy).
  const loadedKeysRef = useRef<Set<string>>(new Set());
  // In-flight reads, keyed the same way (+ the force flag, so a pull-to-refresh
  // never joins a cache-path request). See `singleFlight` above.
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // Single-flight guard for the pending-writes flush: init and every
  // AppState→active transition can fire it concurrently.
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  // The last habit list we loaded or persisted — the baseline `saveHabits`
  // diffs against to find deleted habits (D12). Deliberately NOT touched by
  // `updateHabits`: screens call that optimistically before saving, and diffing
  // against an already-optimistic list would hide the deletion.
  const lastSyncedHabitsRef = useRef<Habit[]>([]);

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
      const force = opts?.force === true;
      const key = `habits:${userId}`;

      const apply = (list: Habit[]): Habit[] => {
        setHabits(list);
        lastSyncedHabitsRef.current = list;
        loadedKeysRef.current.add(key);
        setHabitsReady(true);
        return list;
      };

      // Tier 1 — in-memory (sync). `null` means "never resolved"; `[]` means
      // "resolved, this user has no habits" and short-circuits just the same.
      if (!force) {
        const cached = getCachedHabits(userId);
        if (cached !== null) return apply(cached);
      }

      return singleFlight(
        inFlightRef.current,
        `${key}:${force ? "force" : "cache"}`,
        async () => {
          setHabitsLoading(true);
          try {
            // Tier 2 — AsyncStorage, so an offline cold start still paints.
            if (!force && !loadedKeysRef.current.has(key)) {
              const stored = await loadHabitsFromStorage(userId);
              if (stored !== null) return apply(stored);
            }
            // Tier 3 — network.
            const fresh = await getHabits({ force });
            setCachedHabits(userId, fresh);
            return apply(fresh);
          } finally {
            setHabitsLoading(false);
          }
        },
      );
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
      const force = opts?.force === true;
      const key = `logs:${userId}:${monthKey}`;

      const apply = (logs: HabitLog[]): HabitLog[] => {
        setHabitLogs((prev) => new Map(prev).set(monthKey, logs));
        const byDay = new Map<string, HabitLog[]>();
        for (const log of logs) {
          const dayLogs = byDay.get(log.date) || [];
          dayLogs.push(log);
          byDay.set(log.date, dayLogs);
        }
        setHabitLogsByDay((prev) => {
          const next = new Map(prev);
          byDay.forEach((dayLogs, dayKey) => next.set(dayKey, dayLogs));
          return next;
        });
        loadedKeysRef.current.add(key);
        setHabitLogsReady(true);
        return logs;
      };

      // Tier 1 — in-memory (sync). `[]` is a real, resolved month (no logs yet)
      // and short-circuits exactly like a non-empty one.
      if (!force) {
        const cached = getCachedHabitLogsForMonth(year, month, userId);
        if (cached !== null) return apply(cached);
      }

      return singleFlight(
        inFlightRef.current,
        `${key}:${force ? "force" : "cache"}`,
        async () => {
          setHabitLogsLoading(true);
          try {
            // Tier 2 — AsyncStorage (offline cold start).
            if (!force && !loadedKeysRef.current.has(key)) {
              const stored = await loadHabitLogsFromStorage(year, month, userId);
              if (stored !== null) return apply(stored);
            }
            // Tier 3 — network.
            const logs = await getHabitLogsForMonthDirect(year, month);
            setCachedHabitLogsForMonth(year, month, userId, logs);
            return apply(logs);
          } finally {
            setHabitLogsLoading(false);
          }
        },
      );
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
      const force = opts?.force === true;
      const key = `entries:${userId}:${monthKey}`;

      const apply = (list: DailyEntry[]): DailyEntry[] => {
        setEntries((prev) => new Map(prev).set(monthKey, list));
        loadedKeysRef.current.add(key);
        setEntriesReady(true);
        return list;
      };

      // Cache short-circuit only when NOT forced. Pull-to-refresh forces
      // through to the network so the user can see fresh server state.
      // Tier 1 — in-memory (sync). `[]` is a month we loaded and that is
      // genuinely empty: short-circuit it like any other resolved month.
      if (!force) {
        const cached = getCachedEntriesForMonth(year, month, userId);
        if (cached !== null) return apply(cached);
      }

      return singleFlight(
        inFlightRef.current,
        `${key}:${force ? "force" : "cache"}`,
        async () => {
          setEntriesLoading(true);
          try {
            // Tier 2 — AsyncStorage (offline cold start).
            if (!force && !loadedKeysRef.current.has(key)) {
              const stored = await loadEntriesForMonthFromStorage(
                year,
                month,
                userId,
              );
              if (stored !== null) return apply(stored);
            }
            // Tier 3 — network.
            const fresh = await getEntriesForMonth(year, month);
            setCachedEntriesForMonth(year, month, userId, fresh);
            return apply(fresh);
          } finally {
            setEntriesLoading(false);
          }
        },
      );
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

  // ==========================================================================
  // Persistence helper — the single place a write becomes an outcome (NFR-1)
  // ==========================================================================
  // Runs a lib/db write. It resolves → `synced`. It throws a plain Error
  // (server/network) → the write is queued ONCE, here, and replayed by the
  // flush driver; lib/db never queues its own retry, which is what makes a
  // failed replay stay queued instead of being rewritten (D5). It throws an
  // UnrecoverableWriteError (locked, signed out) → `failed`, not queued.
  const persist = useCallback(
    async (
      userId: string,
      queued: PendingWriteBody,
      write: () => Promise<unknown>,
    ): Promise<WriteOutcome> => {
      try {
        await write();
        return SYNCED;
      } catch (e) {
        if (e instanceof UnrecoverableWriteError) return failed(e);
        try {
          await enqueuePendingWrite(userId, queued);
          setPendingWriteCount(await dbPendingWriteCount(userId));
          return QUEUED;
        } catch {
          // Even the queue is unavailable (storage full/broken) — say so rather
          // than pretend the write landed.
          return { status: "failed", reason: GENERIC_FAILURE };
        }
      }
    },
    [],
  );

  // Persist an entry edit: optimistic update first, then write through.
  const saveEntry = useCallback(
    async (entry: DailyEntry): Promise<WriteOutcome> => {
      if (!session) return failed(new UnrecoverableWriteError("Not signed in"));
      updateEntry(entry); // optimistic
      return persist(session.user.id, { kind: "entry", payload: entry }, () =>
        dbSaveEntry(entry),
      );
    },
    [session, updateEntry, persist],
  );

  // Delete an entry: drop it locally first (the UI must not wait on the
  // network), then delete on the server or queue the delete for replay (D6).
  const deleteEntry = useCallback(
    async (entry: DailyEntry): Promise<WriteOutcome> => {
      if (!session) return failed(new UnrecoverableWriteError("Not signed in"));

      const userId = session.user.id;
      const monthKey = entry.date.slice(0, 7);
      const [yearStr, monthStr] = monthKey.split("-");
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      setEntries((prev) => {
        const next = new Map(prev);
        const monthEntries = (next.get(monthKey) || []).filter(
          (e) => e.id !== entry.id,
        );
        next.set(monthKey, monthEntries);

        // Keep the offline cache in sync with the removal.
        setCachedEntriesForMonth(year, month, userId, monthEntries);
        return next;
      });

      return persist(
        userId,
        { op: "delete", kind: "entry", payload: { id: entry.id, date: entry.date } },
        () => dbDeleteEntry(entry.id, entry.date),
      );
    },
    [session, persist],
  );

  // Drop every local trace of one habit's logs (D12 optimistic half).
  const purgeHabitLogsLocally = useCallback((habitId: string) => {
    const drop = (logs: HabitLog[]) => logs.filter((l) => l.habitId !== habitId);
    setHabitLogs((prev) => {
      const next = new Map<string, HabitLog[]>();
      prev.forEach((logs, key) => next.set(key, drop(logs)));
      return next;
    });
    setHabitLogsByDay((prev) => {
      const next = new Map<string, HabitLog[]>();
      prev.forEach((logs, key) => next.set(key, drop(logs)));
      return next;
    });
  }, []);

  // Persist the whole habit list (create / rename / delete / reorder). Array
  // order is the stored order (D11). Habits that disappeared from the list also
  // lose their logs (D12) — queued like any other write when offline.
  const saveHabits = useCallback(
    async (next: Habit[]): Promise<WriteOutcome> => {
      if (!session) return failed(new UnrecoverableWriteError("Not signed in"));
      const userId = session.user.id;

      const keptIds = new Set(next.map((h) => h.id));
      const removed = lastSyncedHabitsRef.current.filter(
        (h) => !keptIds.has(h.id),
      );
      lastSyncedHabitsRef.current = next;

      updateHabits(next); // optimistic
      for (const habit of removed) purgeHabitLogsLocally(habit.id);

      const outcomes: WriteOutcome[] = [
        await persist(userId, { kind: "habits", payload: next }, () =>
          dbSaveHabits(next),
        ),
      ];
      for (const habit of removed) {
        outcomes.push(
          await persist(
            userId,
            { op: "delete", kind: "habitLogs", payload: { habitId: habit.id } },
            () => dbDeleteHabitLogsForHabit(habit.id),
          ),
        );
      }
      return worstOutcome(outcomes);
    },
    [session, updateHabits, purgeHabitLogsLocally, persist],
  );

  // Flip one habit-log cell: optimistic first, then the exact resulting state
  // is written (an idempotent upsert, so a replay can't double-toggle).
  const toggleHabitLog = useCallback(
    async (
      habitId: string,
      date: string,
      currentCompleted?: boolean,
    ): Promise<WriteOutcome> => {
      if (!session) return failed(new UnrecoverableWriteError("Not signed in"));

      const current =
        typeof currentCompleted === "boolean"
          ? currentCompleted
          : ((habitLogs.get(date.slice(0, 7)) ?? []).find(
              (l) => l.habitId === habitId && l.date === date,
            )?.completed ?? false);

      const log: HabitLog = { habitId, date, completed: !current };
      updateHabitLog(log); // optimistic

      return persist(session.user.id, { kind: "habitLog", payload: log }, () =>
        dbUpsertHabitLog(log),
      );
    },
    [session, habitLogs, updateHabitLog, persist],
  );

  // ============================================================================
  // Pending-writes flush (NFR-1: no silent data loss)
  // ============================================================================
  // Replays each queued write through its matching lib/db call. Every one is
  // idempotent (upsert, replace-all, or a delete of something already gone), so
  // replaying is safe. A replay that still can't reach the server THROWS out of
  // the executor and the item stays queued, untouched — the executor must never
  // enqueue, or the queue gets rewritten with a fresh id/timestamp on every
  // flush instead of retried (D5). The count is refreshed after the flush.
  const flushQueue = useCallback((): Promise<void> => {
    if (!session) return Promise.resolve();
    const userId = session.user.id;

    // Single-flight: the init effect and every AppState→active transition can
    // call this, and two overlapping flushes would replay the same queued
    // writes twice. Cleared in `finally` so a failed flush can be retried.
    const running = flushInFlightRef.current;
    if (running) return running;

    const executor = async (item: PendingWrite): Promise<void> => {
      switch (item.kind) {
        case "entry":
          if (item.op === "delete") {
            await dbDeleteEntry(item.payload.id, item.payload.date);
          } else {
            await dbSaveEntry(item.payload);
          }
          return;
        case "habits":
          await dbSaveHabits(item.payload);
          return;
        case "habitLog":
          await dbUpsertHabitLog(item.payload);
          return;
        case "habitLogs":
          await dbDeleteHabitLogsForHabit(item.payload.habitId);
          return;
      }
    };

    const started = (async () => {
      await flushPendingWrites(userId, executor);
      setPendingWriteCount(await dbPendingWriteCount(userId));
    })().finally(() => {
      if (flushInFlightRef.current === started) flushInFlightRef.current = null;
    });
    flushInFlightRef.current = started;
    return started;
  }, [session]);

  // ============================================================================
  // Clear on Logout
  // ============================================================================
  const clearAll = useCallback(() => {
    // Drop the queue if we still know who the user is. On a logout that has
    // already nulled the session the queue stays keyed to that userId — it's
    // per-user, harmless, and flushed on their next sign-in.
    if (session) void clearPendingWrites(session.user.id);
    setPendingWriteCount(0);
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
    lastSyncedHabitsRef.current = [];
    // Drop read-path bookkeeping so the next user starts from a cold cache and
    // never joins the previous session's in-flight requests.
    loadedKeysRef.current.clear();
    inFlightRef.current.clear();
    flushInFlightRef.current = null;
  }, [session]);

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

      // NFR-1: replay any writes that were queued in a previous session.
      await flushQueue();
    }

    void load();
  }, [
    session,
    refreshHabits,
    refreshHabitLogs,
    refreshEntries,
    refreshProfile,
    flushQueue,
  ]);

  // ============================================================================
  // Flush the pending-writes queue when the app returns to the foreground
  // (NFR-1) — covers writes that failed while backgrounded/offline.
  // ============================================================================
  useEffect(() => {
    if (!session) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void flushQueue();
    });
    return () => sub.remove();
  }, [session, flushQueue]);

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
      pendingWriteCount,

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
      saveEntry,
      deleteEntry,
      saveHabits,
      toggleHabitLog,
      flushPendingWrites: flushQueue,
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
      pendingWriteCount,
      refreshHabits,
      refreshHabitLogs,
      refreshEntries,
      refreshProfile,
      getLogsForMonth,
      getEntriesForMonthData,
      updateHabits,
      updateHabitLog,
      updateEntry,
      saveEntry,
      deleteEntry,
      saveHabits,
      toggleHabitLog,
      flushQueue,
      clearAll,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
