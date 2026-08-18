import { ConsistencyScore } from "@/components/consistency-score";
import { DayHighlightSheet } from "@/components/day-highlight-sheet";
import { HabitComparison } from "@/components/habit-comparison";
import { HabitCorrelations } from "@/components/habit-correlations";
import { HabitHeatmap } from "@/components/habit-heatmap";
import { JournalStatsCard } from "@/components/journal-stats-card";
import { RecordsBoard } from "@/components/records-board";
import { StatSparkline } from "@/components/stat-sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts } from "@/constants/theme";
import { todayKey } from "@/lib/dates";
import { type DailyEntry, type Habit, type HabitLog } from "@/lib/db";
import { computeRecords } from "@/lib/gamification";
import { computeJournalStats } from "@/lib/journal-stats";
import {
  bestDayOfWeek,
  buildInsight,
  completionForMonth,
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
  consistencyScore,
  dailyRateSeries,
  daysToRecord,
  habitComparison,
  habitCorrelations,
  hadRecentComeback,
  heatmapCells,
  monthlyRateSeries,
  monthOverMonthTrend,
  type RatePoint,
  type StatsScope,
  weekendComparison,
} from "@/lib/stats";
import { type Href, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface AnalysisContentProps {
  habits: Habit[];
  logs: HabitLog[];
  /** Journal entries for FR-AN1. Omit on the per-habit deep-dive. */
  entries?: DailyEntry[];
  /** Entries are loaded separately, so they get their own flag. */
  entriesLoading?: boolean;
  /** Present = per-habit deep-dive; absent = overall dashboard. */
  habitId?: string;
  loading: boolean;
  /** Months that couldn't be refreshed — drives the offline/error notice. */
  failedMonths?: number;
  /** Retry the months that failed. */
  onRetry?: () => void;
}

// Each range drives BOTH the heatmap window and the trend series. Short range
// = a daily series (a month of monthly points would be a single dot); longer
// ranges = monthly points, which is what the eye can actually read.
const RANGES = [
  { label: "Month", days: 30, months: 0 },
  { label: "6 mo", days: 183, months: 6 },
  { label: "Year", days: 365, months: 12 },
] as const;

const pct = (r: number): number => Math.round(r * 100);

// Drop the leading points from before anything was trackable, so the line
// starts where the user's history does instead of at a fake 0%.
function trimToHistory(points: RatePoint[]): RatePoint[] {
  const first = points.findIndex((p) => p.days > 0);
  return first <= 0 ? points : points.slice(first);
}

/**
 * The analysis surface, shared by the overview and per-habit screens: the
 * Tight 4, the four analysis modules (journal, comparison, consistency score,
 * correlations) and the calm gamification band (records + stamps). All math
 * comes from the pure `lib/stats` / `lib/gamification` engines; this file only
 * arranges it and picks the right state to render.
 */
export function AnalysisContent({
  habits,
  logs,
  entries = [],
  entriesLoading = false,
  habitId,
  loading,
  failedMonths = 0,
  onRetry,
}: AnalysisContentProps) {
  const [rangeDays, setRangeDays] = useState<number>(183);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // 1 — loading.
  if (loading) {
    return (
      <View style={styles.wrap}>
        <Skeleton width="55%" height={26} />
        <View style={{ height: 18 }} />
        <Skeleton width="100%" height={120} borderRadius={10} />
        <View style={{ height: 16 }} />
        <Skeleton width="90%" height={16} />
      </View>
    );
  }

  // 2 — per-habit view but the habit is gone (deleted).
  const habit = habitId ? habits.find((h) => h.id === habitId) : undefined;
  if (habitId && !habit) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>This habit is no longer available.</Text>
      </View>
    );
  }

  // 3 — nothing to analyse yet.
  if (!habitId && habits.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>Add a habit to start seeing your analysis.</Text>
      </View>
    );
  }

  const today = todayKey();
  const [ty, tm] = today.split("-").map(Number);
  const scope: StatsScope = { habitId, habits };

  // Headline streak + record: per-habit stats, or the best across all habits.
  const hs = habitId ? computeHabitStats(habitId, logs, today) : null;
  const overall = habitId
    ? null
    : computeOverallStats(computeAllHabitStats(habits, logs, today), logs, today, habits);
  const currentStreak = hs ? hs.currentStreak : (overall?.bestCurrentStreak ?? 0);
  const longestStreak = hs ? hs.longestStreak : (overall?.bestLongestStreak ?? 0);
  const totalCompletions = hs
    ? hs.totalCompletions
    : (overall?.totalCompletions ?? 0);

  const month = completionForMonth(logs, ty, tm, today, scope);
  const trend = monthOverMonthTrend(logs, today, scope);
  const range = RANGES.find((r) => r.days === rangeDays) ?? RANGES[1];
  const series = trimToHistory(
    range.months > 0
      ? monthlyRateSeries(logs, today, range.months, scope)
      : dailyRateSeries(logs, today, range.days, scope),
  );
  const cells = heatmapCells(logs, today, rangeDays, {
    habitId,
    habits,
    totalHabits: habits.length || 1,
  });
  const toRecord = daysToRecord(currentStreak, longestStreak);
  const consistency = consistencyScore(
    habit ? [habit] : habits,
    logs,
    today,
    30,
  );

  const best = bestDayOfWeek(logs, today, scope);
  const weekend = weekendComparison(logs, today, 90, scope);
  const insight = buildInsight(
    {
      bestDow: best?.dow ?? null,
      weekendDrop: weekend.weekdayRate > 0 && weekend.weekendRate < weekend.weekdayRate * 0.6,
      currentStreak,
      longestStreak,
      trendDelta: trend.delta,
      hadComeback: hadRecentComeback(logs, today, scope),
    },
    ty * 12 + tm, // rotates month to month
  );

  const journal = habitId ? null : computeJournalStats(entries, today);
  const comparison = habitId ? [] : habitComparison(habits, logs, today);
  const correlations = habitId ? [] : habitCorrelations(habits, logs, today);
  const records = habitId ? [] : computeRecords({ habits, logs, entries, today });

  const trendUp = trend.delta >= 0;
  const recordProgress = longestStreak > 0 ? Math.min(1, currentStreak / longestStreak) : 0;
  const activeDays = overall?.activeDays ?? hs?.totalCompletions ?? 0;

  return (
    <View style={styles.wrap}>
      {/* Offline / partial-load notice — honest, calm, retryable. */}
      {failedMonths > 0 && (
        <TouchableOpacity
          onPress={onRetry}
          activeOpacity={0.85}
          disabled={!onRetry}
          style={styles.notice}
        >
          <Text style={styles.noticeText}>
            {totalCompletions > 0
              ? "Some months couldn't be refreshed — showing what's saved on this device."
              : "Couldn't reach your history just now."}
            {onRetry ? " Tap to try again." : ""}
          </Text>
        </TouchableOpacity>
      )}

      {/* ---- Free hero band (always visible) ---- */}
      <View style={styles.heroRow}>
        <View>
          <Text style={styles.heroLabel}>{habitId ? "current streak" : "best streak"}</Text>
          <Text style={styles.heroValue}>🔥 {currentStreak}</Text>
        </View>
        <View style={styles.heroRight}>
          <Text style={styles.heroLabel}>this month</Text>
          <Text style={styles.heroValue}>{month.days > 0 ? `${pct(month.rate)}%` : "—"}</Text>
        </View>
      </View>

      {/* 4 — habits, but nothing logged yet. 5 — exactly one day in. */}
      {totalCompletions === 0 ? (
        <Text style={styles.firstRun}>
          Nothing logged yet. Tick a habit today and this page starts filling in.
        </Text>
      ) : activeDays === 1 ? (
        <Text style={styles.firstRun}>
          One day in. The shapes below get more honest with every day you add.
        </Text>
      ) : null}

      {/* ---- The Tight 4 ---- */}
      {/* 1 — Consistency heatmap */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Consistency</Text>
          <View style={styles.segment}>
            {RANGES.map((r) => {
              const on = r.days === rangeDays;
              return (
                <TouchableOpacity
                  key={r.days}
                  onPress={() => setRangeDays(r.days)}
                  activeOpacity={0.7}
                  style={[styles.segItem, on && styles.segItemOn]}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>{r.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <HabitHeatmap cells={cells} onDayPress={(c) => setSelectedDay(c.date)} />
        <Text style={styles.caption}>
          Each square is a day · darker is stronger · tap to look back
          {!habitId && overall && overall.perfectDays > 0
            ? ` · ${overall.perfectDays} perfect day${overall.perfectDays === 1 ? "" : "s"} filled in solid`
            : ""}
        </Text>
      </View>

      {/* 2 — Progress trend (same range as the heatmap) */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Progress</Text>
        <View style={styles.trendRow}>
          <Text style={styles.bigNum}>{month.days > 0 ? `${pct(month.rate)}%` : "—"}</Text>
          <Text style={[styles.delta, { color: trendUp ? Colors.success : Colors.danger }]}>
            {trendUp ? "↑" : "↓"} {Math.abs(Math.round(trend.delta))}% vs last month
          </Text>
        </View>
        <Text style={styles.caption2}>
          {month.days > 0
            ? `${month.done} of ${month.days} day${month.days === 1 ? "" : "s"} counted so far this month`
            : "This month starts counting from the day you added it"}
        </Text>
        <View style={{ marginTop: 8 }}>
          {series.length > 1 ? (
            <StatSparkline values={series.map((p) => p.rate)} />
          ) : (
            <Text style={styles.muted}>Not enough history for a line yet.</Text>
          )}
        </View>
        <Text style={styles.caption}>
          {range.months > 0 ? `Last ${range.months} months` : `Last ${range.days} days`}
        </Text>
      </View>

      {/* 3 — Streak vs record */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Your record</Text>
        <Text style={styles.recordLine}>
          🔥 {currentStreak} now · longest <Text style={styles.bold}>{longestStreak}</Text>
          {toRecord > 0 ? ` · ${toRecord} to your record` : longestStreak > 0 ? " · at your best ever 🎉" : ""}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${recordProgress * 100}%` }]} />
        </View>
        <View style={styles.milestones}>
          {[7, 30, 100].map((m) => {
            const hit = longestStreak >= m;
            return (
              <Text key={m} style={[styles.milestone, hit && styles.milestoneHit]}>
                {hit ? "✓" : "○"} {m}
              </Text>
            );
          })}
        </View>
      </View>

      {/* FR-AN3 — consistency score, formula included */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Consistency score</Text>
        <ConsistencyScore result={consistency} />
      </View>

      {/* 4 — Written "your story" insight */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Your story</Text>
        <Text style={styles.insight}>{insight}</Text>
      </View>

      {/* FR-AN2 — habit comparison (overview only) */}
      {!habitId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>By habit</Text>
          <HabitComparison
            rows={comparison}
            onSelect={(id) => router.push(`/analysis/${id}` as Href)}
          />
        </View>
      )}

      {/* FR-AN4 — correlations (overview only) */}
      {!habitId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>What goes together</Text>
          <HabitCorrelations correlations={correlations} habits={habits} />
        </View>
      )}

      {/* FR-AN1 — journal stats (overview only) */}
      {!habitId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your journal</Text>
          <JournalStatsCard stats={journal} loading={entriesLoading} />
        </View>
      )}

      {/* FR-G2 — records board (overview only) */}
      {!habitId && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Records</Text>
          <Text style={styles.caption2}>
            Beaten or tied — never lost. Every one of these is you against you.
          </Text>
          <View style={{ height: 6 }} />
          <RecordsBoard records={records} />
        </View>
      )}

      {/* FR-G3 — stamps (overview only) */}
      {!habitId && (
        <TouchableOpacity
          style={styles.section}
          activeOpacity={0.85}
          onPress={() => router.push("/analysis/stamps" as Href)}
        >
          <View style={styles.stampsRow}>
            <View style={styles.stampsText}>
              <Text style={styles.sectionLabel}>Stamps</Text>
              <Text style={styles.insight}>
                Everything you&apos;ve already done, kept permanently.
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </View>
        </TouchableOpacity>
      )}

      <DayHighlightSheet
        visible={selectedDay !== null}
        date={selectedDay}
        habits={habits}
        logs={logs}
        onClose={() => setSelectedDay(null)}
      />
    </View>
  );
}

const HAIRLINE = "rgba(26,26,26,0.09)";

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22 },
  empty: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 40,
  },
  muted: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  // offline / partial-load notice
  notice: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  noticeText: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
  },
  // hero band
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingBottom: 18,
  },
  heroRight: { alignItems: "flex-end" },
  heroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  heroValue: {
    fontSize: 30,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginTop: 2,
  },
  firstRun: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginBottom: 4,
  },
  // sections
  section: { paddingVertical: 18, borderTopWidth: 1, borderTopColor: HAIRLINE },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  caption: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
    textAlign: "center",
  },
  caption2: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  // segmented range
  segment: { flexDirection: "row", gap: 4, marginBottom: 10 },
  segItem: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  segItemOn: { backgroundColor: Colors.ink },
  segText: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwritingMedium },
  segTextOn: { color: Colors.paper },
  // progress
  trendRow: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  bigNum: { fontSize: 34, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  delta: { fontSize: 14, fontFamily: Fonts.handwritingMedium },
  // record
  recordLine: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwriting, marginBottom: 10 },
  bold: { fontFamily: Fonts.handwritingSemiBold },
  bar: { height: 10, borderRadius: 5, backgroundColor: "rgba(26,26,26,0.07)", overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: Colors.accent },
  milestones: { flexDirection: "row", gap: 16, marginTop: 10 },
  milestone: { fontSize: 13, color: Colors.textSecondary, fontFamily: Fonts.handwritingMedium },
  milestoneHit: { color: Colors.ink },
  insight: { fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwriting, lineHeight: 24 },
  // stamps row
  stampsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stampsText: { flex: 1, marginRight: 12 },
  chev: { fontSize: 18, color: Colors.textSecondary },
});
