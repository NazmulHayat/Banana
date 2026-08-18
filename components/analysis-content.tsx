import { DayHighlightSheet } from "@/components/day-highlight-sheet";
import { HabitHeatmap } from "@/components/habit-heatmap";
import { StatSparkline } from "@/components/stat-sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts } from "@/constants/theme";
import { DateFormats, type Habit, type HabitLog } from "@/lib/db";
import {
  bestDayOfWeek,
  buildInsight,
  completionRateForMonth,
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
  daysToRecord,
  hadRecentComeback,
  heatmapCells,
  monthlyRateSeries,
  monthOverMonthTrend,
  weekendComparison,
} from "@/lib/stats";
import { type Href, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface AnalysisContentProps {
  habits: Habit[];
  logs: HabitLog[];
  /** Present = per-habit deep-dive; absent = overall dashboard. */
  habitId?: string;
  loading: boolean;
}

const RANGES = [
  { label: "Month", days: 30 },
  { label: "6 mo", days: 183 },
  { label: "Year", days: 365 },
] as const;

const pct = (r: number): number => Math.round(r * 100);

/**
 * The Tight 4 + upgrades, shared by the overview and per-habit screens. A free
 * hero band sits above a frosted premium lock (visual only for now). All math
 * comes from the pure `lib/stats` engine; this file only arranges + animates.
 */
export function AnalysisContent({ habits, logs, habitId, loading }: AnalysisContentProps) {
  const [rangeDays, setRangeDays] = useState<number>(183);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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

  // Per-habit view but the habit is gone (deleted) — calm empty state.
  const habit = habitId ? habits.find((h) => h.id === habitId) : undefined;
  if (habitId && !habit) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>This habit is no longer available.</Text>
      </View>
    );
  }
  if (!habitId && habits.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.empty}>Add a habit to start seeing your analysis.</Text>
      </View>
    );
  }

  const today = DateFormats.formatDate(new Date());
  const [ty, tm] = today.split("-").map(Number);

  // Headline streak + record: per-habit stats, or the best across all habits.
  const hs = habitId ? computeHabitStats(habitId, logs, today) : null;
  const overall = habitId
    ? null
    : computeOverallStats(computeAllHabitStats(habits, logs, today), logs);
  const currentStreak = hs ? hs.currentStreak : (overall?.bestCurrentStreak ?? 0);
  const longestStreak = hs ? hs.longestStreak : (overall?.bestLongestStreak ?? 0);

  const monthRate = completionRateForMonth(logs, ty, tm, today, habitId);
  const trend = monthOverMonthTrend(logs, today, habitId);
  const series = monthlyRateSeries(logs, today, 6, habitId).map((p) => p.rate);
  const cells = heatmapCells(logs, today, rangeDays, {
    habitId,
    totalHabits: habits.length || 1,
  });
  const toRecord = daysToRecord(currentStreak, longestStreak);

  const best = bestDayOfWeek(logs, habitId);
  const weekend = weekendComparison(logs, today, 90, habitId);
  const insight = buildInsight(
    {
      bestDow: best?.dow ?? null,
      weekendDrop: weekend.weekdayRate > 0 && weekend.weekendRate < weekend.weekdayRate * 0.6,
      currentStreak,
      longestStreak,
      trendDelta: trend.delta,
      hadComeback: hadRecentComeback(logs, today, habitId),
    },
    ty * 12 + tm, // rotates month to month
  );

  const trendUp = trend.delta >= 0;
  const recordProgress = longestStreak > 0 ? Math.min(1, currentStreak / longestStreak) : 0;

  return (
    <View style={styles.wrap}>
      {/* ---- Free hero band (always visible) ---- */}
      <View style={styles.heroRow}>
        <View>
          <Text style={styles.heroLabel}>{habitId ? "current streak" : "best streak"}</Text>
          <Text style={styles.heroValue}>🔥 {currentStreak}</Text>
        </View>
        <View style={styles.heroRight}>
          <Text style={styles.heroLabel}>this month</Text>
          <Text style={styles.heroValue}>{pct(monthRate)}%</Text>
        </View>
      </View>

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
          </Text>
        </View>

        {/* 2 — Progress trend */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Progress</Text>
          <View style={styles.trendRow}>
            <Text style={styles.bigNum}>{pct(monthRate)}%</Text>
            <Text style={[styles.delta, { color: trendUp ? Colors.success : Colors.danger }]}>
              {trendUp ? "↑" : "↓"} {Math.abs(Math.round(trend.delta))}% vs last month
            </Text>
          </View>
          <View style={{ marginTop: 8 }}>
            <StatSparkline values={series} />
          </View>
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

        {/* 4 — Written "your story" insight */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your story</Text>
          <Text style={styles.insight}>{insight}</Text>
        </View>

        {/* By habit — overview only */}
        {!habitId && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>By habit</Text>
            {habits.map((h) => {
              const s = computeHabitStats(h.id, logs, today);
              const r = completionRateForMonth(logs, ty, tm, today, h.id);
              return (
                <TouchableOpacity
                  key={h.id}
                  style={styles.habitRow}
                  activeOpacity={0.6}
                  onPress={() => router.push(`/analysis/${h.id}` as Href)}
                >
                  <Text style={styles.habitName} numberOfLines={1}>
                    {h.name}
                  </Text>
                  <View style={styles.habitMeta}>
                    <Text style={styles.habitStreak}>🔥 {s.currentStreak}</Text>
                    <Text style={styles.habitRate}>{pct(r)}%</Text>
                    <Text style={styles.chev}>›</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
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
  // by-habit list
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
  },
  habitName: { flex: 1, fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwritingMedium, marginRight: 12 },
  habitMeta: { flexDirection: "row", alignItems: "center", gap: 14 },
  habitStreak: { fontSize: 14, color: Colors.ink, fontFamily: Fonts.handwritingMedium },
  habitRate: { fontSize: 14, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold, minWidth: 38, textAlign: "right" },
  chev: { fontSize: 18, color: Colors.textSecondary },
});
