import { useDataStore } from "@/lib/data-store";
import type { HabitLog } from "@/lib/db";
import { useEffect, useState } from "react";

/**
 * Loads the last `monthsBack` months of habit logs from the store (one cached
 * call per month) and returns the merged array. `allSettled` so one bad month
 * never blanks the view. Bump `refreshToken` to force a reload. Mirrors the
 * loader in components/profile-stats.tsx — the analysis screens reuse it.
 */
export function useRecentHabitLogs(monthsBack = 12, refreshToken = 0) {
  // Depend on the stable `refreshHabitLogs` callback, NOT the whole store
  // object — the store's identity changes on every state update, and since
  // refreshHabitLogs itself sets state, depending on the store would re-fire
  // this effect forever ("Maximum update depth exceeded").
  const { refreshHabitLogs } = useDataStore();
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const now = new Date();
      const months = Array.from({ length: monthsBack }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
      });
      const opts = refreshToken > 0 ? { force: true } : undefined;
      const settled = await Promise.allSettled(
        months.map((m) => refreshHabitLogs(m.year, m.month, opts)),
      );
      if (cancelled) return;
      setLogs(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshHabitLogs, monthsBack, refreshToken]);

  return { logs, loading };
}
