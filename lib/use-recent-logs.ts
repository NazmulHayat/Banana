// The "recent window" loaders shared by the profile peek and the analysis
// screens: N months of habit logs, and N months of journal entries. Both go
// through the store (screens never touch lib/db), both degrade to whatever
// months resolved, and both are cache-first unless forced.

import { useDataStore } from "@/lib/data-store";
import type { DailyEntry, HabitLog } from "@/lib/db";
import { useEffect, useState } from "react";

// The last `monthsBack` months as {year, month}, newest first.
function recentMonths(monthsBack: number): { year: number; month: number }[] {
  const now = new Date();
  return Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
}

/**
 * Loads the last `monthsBack` months of habit logs from the store (one cached
 * call per month) and returns the merged array. `allSettled` so one bad month
 * never blanks the view: `failed` counts the months that didn't resolve, so a
 * screen can say "showing what's saved on this device" instead of pretending,
 * and `reload` retries them. Bump `refreshToken` to force a reload.
 */
export function useRecentHabitLogs(monthsBack = 12, refreshToken = 0) {
  // Depend on the stable `refreshHabitLogs` callback, NOT the whole store
  // object — the store's identity changes on every state update, and since
  // refreshHabitLogs itself sets state, depending on the store would re-fire
  // this effect forever ("Maximum update depth exceeded").
  const { refreshHabitLogs } = useDataStore();
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const opts = refreshToken > 0 || attempt > 0 ? { force: true } : undefined;
      const settled = await Promise.allSettled(
        recentMonths(monthsBack).map((m) => refreshHabitLogs(m.year, m.month, opts)),
      );
      if (cancelled) return;
      setLogs(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
      setFailed(settled.filter((r) => r.status === "rejected").length);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshHabitLogs, monthsBack, refreshToken, attempt]);

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
  const { refreshEntries } = useDataStore();
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
      const opts = refreshToken > 0 ? { force: true } : undefined;
      const settled = await Promise.allSettled(
        recentMonths(monthsBack).map((m) => refreshEntries(m.year, m.month, opts)),
      );
      if (cancelled) return;
      setEntries(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
      setFailed(settled.filter((r) => r.status === "rejected").length);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshEntries, monthsBack, refreshToken, enabled]);

  return { entries, loading, failed };
}
