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
import { toDayKey, todayKey } from "./dates";
import {
  deleteEntry as dbDeleteEntry,
  getCachedEntriesForMonth,
  getEntriesForMonths,
  loadEntriesForMonthFromStorage,
  removeEntryFromCache,
  saveEntry as dbSaveEntry,
  upsertEntryInCache,
} from "./db/entries";
import {
  deleteHabitLogsForHabit as dbDeleteHabitLogsForHabit,
  getCachedHabitLogsForMonth,
  getHabitLogsForMonths,
  type HabitLogPurgeRange,
  loadHabitLogsFromStorage,
  upsertHabitLog as dbUpsertHabitLog,
  upsertHabitLogInCache,
} from "./db/habit-logs";
import {
  getCachedHabits,
  getHabits,
  loadHabitsFromStorage,
  saveHabits as dbSaveHabits,
  setCachedHabits,
} from "./db/habits";
import {
  enqueuePendingWrite,
  flushPendingWrites,
  pendingWriteCount as dbPendingWriteCount,
  type PendingWrite,
  type PendingWriteBody,
} from "./db/pending-writes";
import { DateFormats } from "./db/schema";
import type {
  DailyEntry,
  Habit,
  HabitLog,
  MonthRef,
  WriteOutcome,
} from "./db/types";
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

// How far back a habit-log purge sweeps when we know neither the habit's
// creation date nor the account's (a queued purge from an older build). Days
// are HMAC'd locally, so a wide-but-bounded sweep is cheap; unbounded is not.
const FALLBACK_PURGE_DAYS = 366 * 5;

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
// Value equality — the guard that stops a no-op read from re-rendering the app
// ============================================================================
// A read that returns exactly what we already hold must NOT produce a new state
// identity (D22). Screens derive effect dependencies from store values, so an
// identity change on every refresh is what turned "load this month" into an
// endless load → render → load loop.
function sameList<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => eq(item, b[i]));
}

const sameStrings = (a: string[], b: string[]): boolean =>
  sameList(a, b, (x, y) => x === y);

const sameHabit = (a: Habit, b: Habit): boolean =>
  a.id === b.id && a.name === b.name && a.createdAt === b.createdAt;

const sameLog = (a: HabitLog, b: HabitLog): boolean =>
  a.habitId === b.habitId && a.date === b.date && a.completed === b.completed;

const sameEntry = (a: DailyEntry, b: DailyEntry): boolean =>
  a.id === b.id &&
  a.date === b.date &&
  a.text === b.text &&
  a.createdAt === b.createdAt &&
  sameStrings(a.mediaPaths, b.mediaPaths);

/** Group logs by their day key. */
function groupByDay(logs: HabitLog[]): Map<string, HabitLog[]> {
  const byDay = new Map<string, HabitLog[]>();
  for (const log of logs) {
    const dayLogs = byDay.get(log.date);
    if (dayLogs) dayLogs.push(log);
    else byDay.set(log.date, [log]);
  }
  return byDay;
}

// ============================================================================
// Pending-writes replay executor (NFR-1 / D24)
// ============================================================================
/**
 * What a replayed write has to do to LOCAL state once the server has taken it.
 * Init order is reads-then-flush, so by the time a queued write replays, the
 * server's (pre-replay) answer has already overwritten the optimistic value in
 * state — without re-applying, the UI shows a habit un-ticked for the rest of
 * the session while server, disk and cache all say ticked.
 */
export interface FlushHandlers {
  userId: string;
  onEntrySaved: (entry: DailyEntry) => void;
  onEntryDeleted: (entryId: string, date: string) => void;
  onHabitsSaved: (habits: Habit[]) => void;
  onHabitLogSaved: (log: HabitLog) => void;
  onHabitLogsPurged: (habitId: string) => void;
  /** Range for a purge queued before ranges were recorded (D17 back-compat). */
  fallbackPurgeRange: () => HabitLogPurgeRange;
}

/**
 * Build the executor `flushPendingWrites` drives. Every replay is idempotent
 * (upsert, replace-all, or a delete of something already gone). It must NEVER
 * enqueue on failure — throwing IS how it says "keep this queued" (D5).
 *
 * Module-scope + exported so the replay wiring is testable without mounting the
 * provider.
 */
export function createFlushExecutor(
  handlers: FlushHandlers,
): (item: PendingWrite) => Promise<void> {
  const { userId } = handlers;
  return async (item: PendingWrite): Promise<void> => {
    switch (item.kind) {
      case "entry":
        if (item.op === "delete") {
          await dbDeleteEntry(item.payload.id, item.payload.date, userId);
          handlers.onEntryDeleted(item.payload.id, item.payload.date);
        } else {
          await dbSaveEntry(item.payload, userId);
          handlers.onEntrySaved(item.payload);
        }
        return;
      case "habits":
        await dbSaveHabits(item.payload, userId);
        handlers.onHabitsSaved(item.payload);
        return;
      case "habitLog":
        await dbUpsertHabitLog(item.payload, userId);
        handlers.onHabitLogSaved(item.payload);
        return;
      case "habitLogs": {
        const fallback = handlers.fallbackPurgeRange();
        await dbDeleteHabitLogsForHabit(item.payload.habitId, userId, {
          from: item.payload.from ?? fallback.from,
          to: item.payload.to ?? fallback.to,
        });
        handlers.onHabitLogsPurged(item.payload.habitId);
        return;
      }
    }
  };
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

/** What a windowed read reports back: the rows, and how many months failed. */
interface WindowResult<T> {
  data: T[];
  /**
   * Months whose network read failed outright (D16). Anything already on the
   * device is still in `data` — a screen uses this to say "showing what's saved
   * on this device", not to blank itself.
   */
  failed: number;
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
  /**
   * Load a whole window of months in ONE round trip (D20) — the analysis
   * screens want twelve. Months already cached short-circuit; the rest are
   * fetched together. Reports how many months failed so the caller can say so.
   */
  refreshHabitLogWindow: (
    months: MonthRef[],
    opts?: { force?: boolean },
  ) => Promise<WindowResult<HabitLog>>;
  /** Same window, for journal entries. */
  refreshEntryWindow: (
    months: MonthRef[],
    opts?: { force?: boolean },
  ) => Promise<WindowResult<DailyEntry>>;
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
  // from a stale on-disk copy). A FAILED read never lands here.
  const loadedKeysRef = useRef<Set<string>>(new Set());
  // In-flight reads, keyed the same way (+ the force flag, so a pull-to-refresh
  // never joins a cache-path request). See `singleFlight` above.
  const inFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  // Single-flight guard for the pending-writes flush: init and every
  // AppState→active transition can fire it concurrently.
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  // The last habit list we loaded or persisted — the baseline `saveHabits`
  // diffs against to find deleted habits (D12). Deliberately NOT touched by
  // `updateHabits` (screens call that optimistically before saving, and diffing
  // against an already-optimistic list would hide the deletion) and never by a
  // FAILED read (which used to reset it to `[]`, silently disabling the purge).
  const lastSyncedHabitsRef = useRef<Habit[]>([]);
  // Mirrors of the state maps, for the fallback value a failed read returns
  // without pulling `habitLogs` / `entries` into a callback's dependencies
  // (which would change every refresh callback's identity on every update).
  const habitLogsRef = useRef<Map<string, HabitLog[]>>(new Map());
  const entriesRef = useRef<Map<string, DailyEntry[]>>(new Map());
  // The account's creation day — the floor for a habit-log purge sweep (D17).
  const accountCreatedRef = useRef<string | null>(null);

  useEffect(() => {
    habitLogsRef.current = habitLogs;
  }, [habitLogs]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

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

      // Only ever called with what the network (or a cache tier) actually
      // produced — never with the empty list a failed read used to return.
      const apply = (list: Habit[]): Habit[] => {
        setHabits((prev) => (sameList(prev, list, sameHabit) ? prev : list));
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
            // Tier 3 — network. A failure keeps the device's copy: nothing is
            // applied, nothing is cached, and the caller gets what we hold.
            const fresh = await getHabits(userId);
            if (!fresh.ok) return getCachedHabits(userId) ?? [];
            return apply(fresh.data);
          } finally {
            setHabitsLoading(false);
          }
        },
      );
    },
    [session],
  );

  // ============================================================================
  // Fetch Habit Logs (one month or a whole window — same path)
  // ============================================================================
  // Applies a batch of months in ONE state update, and only for the months that
  // actually changed (D22).
  const applyLogMonths = useCallback(
    (userId: string, byMonth: Map<string, HabitLog[]>) => {
      if (byMonth.size === 0) return;

      setHabitLogs((prev) => {
        let next: Map<string, HabitLog[]> | null = null;
        byMonth.forEach((logs, ym) => {
          const current = prev.get(ym);
          if (current && sameList(current, logs, sameLog)) return;
          next = next ?? new Map(prev);
          next.set(ym, logs);
        });
        return next ?? prev;
      });

      setHabitLogsByDay((prev) => {
        const next = new Map(prev);
        let changed = false;
        byMonth.forEach((logs, ym) => {
          const days = groupByDay(logs);
          // Days that lost every log this month must disappear, or a deleted
          // habit's ticks linger in the day map forever.
          for (const day of [...next.keys()]) {
            if (day.slice(0, 7) !== ym || days.has(day)) continue;
            next.delete(day);
            changed = true;
          }
          days.forEach((dayLogs, day) => {
            const current = next.get(day);
            if (current && sameList(current, dayLogs, sameLog)) return;
            next.set(day, dayLogs);
            changed = true;
          });
        });
        return changed ? next : prev;
      });

      byMonth.forEach((_logs, ym) =>
        loadedKeysRef.current.add(`logs:${userId}:${ym}`),
      );
      setHabitLogsReady(true);
    },
    [],
  );

  const refreshHabitLogWindow = useCallback(
    async (
      months: MonthRef[],
      opts?: { force?: boolean },
    ): Promise<WindowResult<HabitLog>> => {
      if (!session || months.length === 0) return { data: [], failed: 0 };

      const userId = session.user.id;
      const force = opts?.force === true;
      const resolved = new Map<string, HabitLog[]>();
      const fromNetwork = new Map<string, HabitLog[]>();

      // Tier 1 — in-memory (sync). `[]` is a real, resolved month (no logs yet)
      // and short-circuits exactly like a non-empty one.
      const uncached: MonthRef[] = [];
      for (const m of months) {
        const ym = getMonthKey(m.year, m.month);
        if (!force) {
          const cached = getCachedHabitLogsForMonth(m.year, m.month, userId);
          if (cached !== null) {
            resolved.set(ym, cached);
            continue;
          }
        }
        uncached.push(m);
      }

      let failedMonths = 0;
      if (uncached.length > 0) {
        setHabitLogsLoading(true);
        try {
          // Tier 2 — AsyncStorage (offline cold start).
          const missing: MonthRef[] = [];
          for (const m of uncached) {
            const ym = getMonthKey(m.year, m.month);
            if (!force && !loadedKeysRef.current.has(`logs:${userId}:${ym}`)) {
              const stored = await loadHabitLogsFromStorage(
                m.year,
                m.month,
                userId,
              );
              if (stored !== null) {
                resolved.set(ym, stored);
                continue;
              }
            }
            missing.push(m);
          }

          // Tier 3 — network: every remaining month in ONE query (D20).
          if (missing.length > 0) {
            const ids = missing
              .map((m) => getMonthKey(m.year, m.month))
              .sort()
              .join(",");
            const result = await singleFlight(
              inFlightRef.current,
              `logs:${userId}:${ids}:${force ? "force" : "cache"}`,
              () => getHabitLogsForMonths(missing, userId),
            );
            if (result.ok) {
              result.data.forEach((logs, ym) => {
                resolved.set(ym, logs);
                fromNetwork.set(ym, logs);
              });
            } else {
              // D16: the read never happened. Cache nothing, apply nothing —
              // the device keeps whatever it already had.
              failedMonths = missing.length;
            }
          }
        } finally {
          setHabitLogsLoading(false);
        }
      }

      applyLogMonths(userId, resolved);

      const data: HabitLog[] = [];
      for (const m of months) {
        const ym = getMonthKey(m.year, m.month);
        const logs =
          resolved.get(ym) ??
          getCachedHabitLogsForMonth(m.year, m.month, userId) ??
          habitLogsRef.current.get(ym) ??
          [];
        data.push(...logs);
      }
      return { data, failed: failedMonths };
    },
    [session, applyLogMonths],
  );

  const refreshHabitLogs = useCallback(
    async (
      year: number,
      month: number,
      opts?: { force?: boolean },
    ): Promise<HabitLog[]> => {
      const { data } = await refreshHabitLogWindow([{ year, month }], opts);
      return data;
    },
    [refreshHabitLogWindow],
  );

  // ============================================================================
  // Fetch Entries (same shape as habit logs)
  // ============================================================================
  const applyEntryMonths = useCallback(
    (userId: string, byMonth: Map<string, DailyEntry[]>) => {
      if (byMonth.size === 0) return;

      setEntries((prev) => {
        let next: Map<string, DailyEntry[]> | null = null;
        byMonth.forEach((list, ym) => {
          const current = prev.get(ym);
          if (current && sameList(current, list, sameEntry)) return;
          next = next ?? new Map(prev);
          next.set(ym, list);
        });
        return next ?? prev;
      });

      byMonth.forEach((_list, ym) =>
        loadedKeysRef.current.add(`entries:${userId}:${ym}`),
      );
      setEntriesReady(true);
    },
    [],
  );

  const refreshEntryWindow = useCallback(
    async (
      months: MonthRef[],
      opts?: { force?: boolean },
    ): Promise<WindowResult<DailyEntry>> => {
      if (!session || months.length === 0) return { data: [], failed: 0 };

      const userId = session.user.id;
      const force = opts?.force === true;
      const resolved = new Map<string, DailyEntry[]>();

      // Tier 1 — in-memory. Pull-to-refresh (`force`) skips it so the user can
      // see fresh server state.
      const uncached: MonthRef[] = [];
      for (const m of months) {
        const ym = getMonthKey(m.year, m.month);
        if (!force) {
          const cached = getCachedEntriesForMonth(m.year, m.month, userId);
          if (cached !== null) {
            resolved.set(ym, cached);
            continue;
          }
        }
        uncached.push(m);
      }

      let failedMonths = 0;
      if (uncached.length > 0) {
        setEntriesLoading(true);
        try {
          // Tier 2 — AsyncStorage (offline cold start).
          const missing: MonthRef[] = [];
          for (const m of uncached) {
            const ym = getMonthKey(m.year, m.month);
            if (!force && !loadedKeysRef.current.has(`entries:${userId}:${ym}`)) {
              const stored = await loadEntriesForMonthFromStorage(
                m.year,
                m.month,
                userId,
              );
              if (stored !== null) {
                resolved.set(ym, stored);
                continue;
              }
            }
            missing.push(m);
          }

          // Tier 3 — network, one query for the whole window (D20).
          if (missing.length > 0) {
            const ids = missing
              .map((m) => getMonthKey(m.year, m.month))
              .sort()
              .join(",");
            const result = await singleFlight(
              inFlightRef.current,
              `entries:${userId}:${ids}:${force ? "force" : "cache"}`,
              () => getEntriesForMonths(missing, userId),
            );
            if (result.ok) {
              result.data.forEach((list, ym) => resolved.set(ym, list));
            } else {
              failedMonths = missing.length;
            }
          }
        } finally {
          setEntriesLoading(false);
        }
      }

      applyEntryMonths(userId, resolved);

      const data: DailyEntry[] = [];
      for (const m of months) {
        const ym = getMonthKey(m.year, m.month);
        const list =
          resolved.get(ym) ??
          getCachedEntriesForMonth(m.year, m.month, userId) ??
          entriesRef.current.get(ym) ??
          [];
        data.push(...list);
      }
      return { data, failed: failedMonths };
    },
    [session, applyEntryMonths],
  );

  const refreshEntries = useCallback(
    async (
      year: number,
      month: number,
      opts?: { force?: boolean },
    ): Promise<DailyEntry[]> => {
      const { data } = await refreshEntryWindow([{ year, month }], opts);
      return data;
    },
    [refreshEntryWindow],
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
        if (__DEV__) console.warn("[DataStore] Profile fetch error:", error.message);
        return;
      }

      if (data) {
        setProfile({
          id: data.id,
          username: data.username,
          created_at: data.created_at,
        });
        // The account's first day floors every habit-log purge sweep (D17).
        const created = new Date(data.created_at as string);
        if (!Number.isNaN(created.getTime())) {
          accountCreatedRef.current = toDayKey(created);
        }
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
  // The lib/db cache is written HERE, outside the setState updater (D23):
  // updaters must be pure (StrictMode double-invokes them), and the db helpers
  // only touch a month they already hold, so an optimistic edit can never
  // replace an unloaded month with a one-item array.
  const updateHabits = useCallback(
    (newHabits: Habit[]) => {
      if (session) setCachedHabits(session.user.id, newHabits);
      setHabits((prev) => (sameList(prev, newHabits, sameHabit) ? prev : newHabits));
    },
    [session],
  );

  const updateHabitLog = useCallback(
    (log: HabitLog) => {
      if (!session) return;
      upsertHabitLogInCache(session.user.id, log);

      const monthKey = log.date.slice(0, 7);
      setHabitLogs((prev) => {
        const monthLogs = prev.get(monthKey) ?? [];
        const i = monthLogs.findIndex(
          (l) => l.habitId === log.habitId && l.date === log.date,
        );
        if (i >= 0 && sameLog(monthLogs[i], log)) return prev;
        const nextLogs = [...monthLogs];
        if (i >= 0) nextLogs[i] = log;
        else nextLogs.push(log);
        return new Map(prev).set(monthKey, nextLogs);
      });

      setHabitLogsByDay((prev) => {
        const dayLogs = prev.get(log.date) ?? [];
        const i = dayLogs.findIndex((l) => l.habitId === log.habitId);
        if (i >= 0 && sameLog(dayLogs[i], log)) return prev;
        const nextDay = [...dayLogs];
        if (i >= 0) nextDay[i] = log;
        else nextDay.push(log);
        return new Map(prev).set(log.date, nextDay);
      });
    },
    [session],
  );

  const updateEntry = useCallback(
    (entry: DailyEntry) => {
      if (!session) return;
      upsertEntryInCache(entry, session.user.id);

      const monthKey = entry.date.slice(0, 7);
      setEntries((prev) => {
        const monthEntries = prev.get(monthKey) ?? [];
        const i = monthEntries.findIndex((e) => e.id === entry.id);
        if (i >= 0 && sameEntry(monthEntries[i], entry)) return prev;
        const next = [...monthEntries];
        if (i >= 0) next[i] = entry;
        else next.push(entry);
        return new Map(prev).set(monthKey, next);
      });
    },
    [session],
  );

  /** Drop one entry from state + the db cache (optimistic delete, and replay). */
  const removeEntryLocally = useCallback(
    (entryId: string, date: string) => {
      if (!session) return;
      removeEntryFromCache(entryId, date, session.user.id);

      const monthKey = date.slice(0, 7);
      setEntries((prev) => {
        const monthEntries = prev.get(monthKey);
        if (!monthEntries) return prev;
        const next = monthEntries.filter((e) => e.id !== entryId);
        if (next.length === monthEntries.length) return prev;
        return new Map(prev).set(monthKey, next);
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
      const userId = session.user.id;
      updateEntry(entry); // optimistic
      return persist(userId, { kind: "entry", payload: entry }, () =>
        dbSaveEntry(entry, userId),
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

      removeEntryLocally(entry.id, entry.date);

      return persist(
        userId,
        { op: "delete", kind: "entry", payload: { id: entry.id, date: entry.date } },
        () => dbDeleteEntry(entry.id, entry.date, userId),
      );
    },
    [session, removeEntryLocally, persist],
  );

  // Drop every local trace of one habit's logs (D12 optimistic half).
  const purgeHabitLogsLocally = useCallback((habitId: string) => {
    const drop = (
      prev: Map<string, HabitLog[]>,
    ): Map<string, HabitLog[]> => {
      let next: Map<string, HabitLog[]> | null = null;
      prev.forEach((logs, key) => {
        const kept = logs.filter((l) => l.habitId !== habitId);
        if (kept.length === logs.length) return;
        next = next ?? new Map(prev);
        next.set(key, kept);
      });
      return next ?? prev;
    };
    setHabitLogs(drop);
    setHabitLogsByDay(drop);
  }, []);

  /**
   * The day range a habit-log purge has to sweep (D17). `day_bucket` is
   * forward-computable, so the purge enumerates days instead of downloading
   * every log row: start at the habit's creation day, floored by the account's
   * (a habit can be ticked on days before it was created, and the account's
   * first day is the earliest anything can exist).
   */
  const purgeRangeFor = useCallback((habit?: Habit): HabitLogPurgeRange => {
    const to = todayKey();
    const candidates: string[] = [];
    const accountDay = accountCreatedRef.current;
    if (accountDay) candidates.push(accountDay);
    if (habit) {
      const created = new Date(habit.createdAt);
      if (!Number.isNaN(created.getTime())) candidates.push(toDayKey(created));
    }
    if (candidates.length === 0) {
      // Neither date is known — sweep a wide but bounded window.
      const fallback = new Date();
      fallback.setDate(fallback.getDate() - FALLBACK_PURGE_DAYS);
      return { from: toDayKey(fallback), to };
    }
    // Day keys are fixed-width, so lexicographic order is calendar order.
    return { from: candidates.sort()[0], to };
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
          dbSaveHabits(next, userId),
        ),
      ];
      for (const habit of removed) {
        const range = purgeRangeFor(habit);
        outcomes.push(
          await persist(
            userId,
            {
              op: "delete",
              kind: "habitLogs",
              payload: { habitId: habit.id, from: range.from, to: range.to },
            },
            () => dbDeleteHabitLogsForHabit(habit.id, userId, range),
          ),
        );
      }
      return worstOutcome(outcomes);
    },
    [session, updateHabits, purgeHabitLogsLocally, purgeRangeFor, persist],
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
      const userId = session.user.id;

      // Read the current value off the state MIRROR, not off `habitLogs`:
      // depending on the state itself would give this action a new identity on
      // every log update, and screens hang effects off these callbacks.
      const current =
        typeof currentCompleted === "boolean"
          ? currentCompleted
          : ((habitLogsRef.current.get(date.slice(0, 7)) ?? []).find(
              (l) => l.habitId === habitId && l.date === date,
            )?.completed ?? false);

      const log: HabitLog = { habitId, date, completed: !current };
      updateHabitLog(log); // optimistic

      return persist(userId, { kind: "habitLog", payload: log }, () =>
        dbUpsertHabitLog(log, userId),
      );
    },
    [session, updateHabitLog, persist],
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
  //
  // A SUCCESSFUL replay is also re-applied to store state (D24). Init order is
  // reads-then-flush, so the server's answer (which predates the replay) has
  // already overwritten the optimistic value: without this the UI showed a
  // habit un-ticked for the rest of the session while the server, the disk and
  // the db cache all said ticked.
  const flushQueue = useCallback((): Promise<void> => {
    if (!session) return Promise.resolve();
    const userId = session.user.id;

    // Single-flight: the init effect and every AppState→active transition can
    // call this, and two overlapping flushes would replay the same queued
    // writes twice. Cleared in `finally` so a failed flush can be retried.
    const running = flushInFlightRef.current;
    if (running) return running;

    const executor = createFlushExecutor({
      userId,
      onEntrySaved: updateEntry,
      onEntryDeleted: removeEntryLocally,
      onHabitsSaved: (list) => {
        updateHabits(list);
        lastSyncedHabitsRef.current = list;
      },
      onHabitLogSaved: updateHabitLog,
      onHabitLogsPurged: purgeHabitLogsLocally,
      fallbackPurgeRange: () => purgeRangeFor(),
    });

    const started = (async () => {
      await flushPendingWrites(userId, executor);
      setPendingWriteCount(await dbPendingWriteCount(userId));
    })().finally(() => {
      if (flushInFlightRef.current === started) flushInFlightRef.current = null;
    });
    flushInFlightRef.current = started;
    return started;
  }, [
    session,
    updateEntry,
    updateHabitLog,
    updateHabits,
    removeEntryLocally,
    purgeHabitLogsLocally,
    purgeRangeFor,
  ]);

  // ============================================================================
  // Clear on Logout
  // ============================================================================
  const clearAll = useCallback(() => {
    // The pending-writes queue is NOT cleared here (D25). Logging out leaves
    // the AsyncStorage month caches on the device by design, so dropping the
    // queue would destroy the unsynced write while keeping its optimistic value
    // in the cache — the two would diverge permanently on the next sign-in.
    // Only account deletion clears it (lib/auth/local-purge.ts).
    setPendingWriteCount(0);
    setHabits([]);
    setHabitsLoading(false);
    setHabitsReady(false);
    setHabitLogs(new Map());
    setHabitLogsByDay(new Map());
    setHabitLogsLoading(false);
    setHabitLogsReady(false);
    setEntries(new Map());
    setEntriesLoading(false);
    setEntriesReady(false);
    setProfile(null);
    setProfileLoading(false);
    setProfileReady(false);
    setInitialLoadComplete(false);
    prefetchedRef.current = false;
    lastSyncedHabitsRef.current = [];
    accountCreatedRef.current = null;
    habitLogsRef.current = new Map();
    entriesRef.current = new Map();
    // Drop read-path bookkeeping so the next user starts from a cold cache and
    // never joins the previous session's in-flight requests.
    loadedKeysRef.current.clear();
    inFlightRef.current.clear();
    flushInFlightRef.current = null;
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

      // NFR-1: replay any writes that were queued in a previous session. The
      // executor re-applies each replayed write to state, so a toggle the
      // server hadn't seen when the reads above ran isn't lost (D24).
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
      refreshHabitLogWindow,
      refreshEntryWindow,
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
      refreshHabitLogWindow,
      refreshEntryWindow,
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
