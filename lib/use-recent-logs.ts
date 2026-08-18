// The "recent window" loaders shared by the profile peek and the analysis
// screens: N months of habit logs, and N months of journal entries. Both go
// through the store (screens never touch lib/db), both degrade to whatever
// months resolved, and both are cache-first unless forced.
//
// One window = ONE round trip. These used to call the store once per
// month — twelve queries and twelve session reads for a single screen mount —
// and their `failed` counter could never leave 0, because a failed read
// resolved with `[]` instead of rejecting. The store now reports the months it
// couldn't reach, so "showing what's saved on this device" is reachable.

import { useDataStore } from "@/lib/data-store";
import type { DailyEntry, HabitLog, MonthRef } from "@/lib/db";
import { useEffect, useState } from "react";

// The last `monthsBack` months, newest first.
function recentMonths(monthsBack: number): MonthRef[] {
  const now = new Date();
  return Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

/**
 * Loads the last `monthsBack` months of habit logs and returns the merged
 * array. `failed` counts the months the server couldn't be reached for, so a
 * screen can say "showing what's saved on this device" instead of pretending;
 * `reload` retries them (months that already resolved come back from the
 * store's memory tier, so a retry costs one request, not twelve). Bump
 * `refreshToken` to force a full reload.
 */
export function useRecentHabitLogs(monthsBack = 12, refreshToken = 0) {
  // Depend on the stable `refreshHabitLogWindow` callback, NOT the whole store
  // object — the store's identity changes on every state update, and since the
  // refresh itself sets state, depending on the store would re-fire this effect
  // forever ("Maximum update depth exceeded").
  const { refreshHabitLogWindow } = useDataStore();
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // Pull-to-refresh means "everything is stale". A retry (`attempt`) is
      // cache-first: the months that resolved are already in memory, so only
      // the broken ones actually hit the network.
      const result = await refreshHabitLogWindow(
        recentMonths(monthsBack),
        refreshToken > 0 ? { force: true } : undefined,
      );
      if (cancelled) return;
      setLogs(result.data);
      setFailed(result.failed);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshHabitLogWindow, monthsBack, refreshToken, attempt]);

  return { logs, loading, failed, reload: () => setAttempt((a) => a + 1) };
}

/**
 * Same window, for journal entries (FR-AN1 journal stats). `enabled` lets a
 * screen that doesn't need entries (the per-habit deep-dive) skip the work
 * without breaking the rules of hooks. Failures degrade to the months that did
 * resolve — a cached-but-offline month still renders.
 */
export function useRecentEntries(monthsBack = 12, refreshToken = 0, enabled = true) {
  // Same reasoning as above: depend on the stable callback, never the store.
  const { refreshEntryWindow } = useDataStore();
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setFailed(0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const result = await refreshEntryWindow(
        recentMonths(monthsBack),
        refreshToken > 0 ? { force: true } : undefined,
      );
      if (cancelled) return;
      setEntries(result.data);
      setFailed(result.failed);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshEntryWindow, monthsBack, refreshToken, enabled]);

  return { entries, loading, failed };
}
