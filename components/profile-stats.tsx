import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts } from "@/constants/theme";
import { DateFormats, type Habit } from "@/lib/db";
import {
  bestDayOfWeek,
  buildInsight,
  computeAllHabitStats,
  computeOverallStats,
  hadRecentComeback,
  monthOverMonthTrend,
  weekendComparison,
} from "@/lib/stats";
import { useRecentHabitLogs } from "@/lib/use-recent-logs";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

interface ProfileStatsProps {
  /** All habits to summarise. */
  habits: Habit[];
  /** Bump to force-reload the stats window (e.g. pull-to-refresh). */
  refreshToken?: number;
}

/**
 * The free "stats peek" on the profile hub: a headline streak, a couple of
 * supporting numbers, and a one-line insight — a tease that taps into the full
 * (paid) analysis. Loads the last 12 months of logs; renders loading + empty
 * states so it never shows a blank frame.
 */
export function ProfileStats({ habits, refreshToken = 0 }: ProfileStatsProps) {
  const { logs, loading } = useRecentHabitLogs(12, refreshToken);

  if (loading) {
    return (
      <PaperCard style={styles.card}>
        <Skeleton width="40%" height={12} />
        <View style={{ height: 12 }} />
        <Skeleton width="55%" height={34} />
        <View style={{ height: 14 }} />
        <Skeleton width="85%" height={13} />
      </PaperCard>
    );
  }

  if (habits.length === 0) {
    return (
      <PaperCard style={styles.card}>
        <Text style={styles.emptyText}>Add a habit to start tracking streaks.</Text>
      </PaperCard>
    );
  }

  const today = DateFormats.formatDate(new Date());
  const [ty, tm] = today.split("-").map(Number);
  const perHabit = computeAllHabitStats(habits, logs, today);
  const overall = computeOverallStats(perHabit, logs);

  const best = bestDayOfWeek(logs);
  const weekend = weekendComparison(logs, today, 90);
  const trend = monthOverMonthTrend(logs, today);
  const insight = buildInsight(
    {
      bestDow: best?.dow ?? null,
      weekendDrop: weekend.weekdayRate > 0 && weekend.weekendRate < weekend.weekdayRate * 0.6,
      currentStreak: overall.bestCurrentStreak,
      longestStreak: overall.bestLongestStreak,
      trendDelta: trend.delta,
      hadComeback: hadRecentComeback(logs, today),
    },
    ty * 12 + tm,
  );

  return (
    <PressableScale scaleTo={0.98} onPress={() => router.push("/analysis")}>
      <PaperCard style={styles.card}>
        <Text style={styles.eyebrow}>your momentum</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <Text style={styles.hero}>🔥 {overall.bestCurrentStreak}</Text>
            <Text style={styles.heroSub}>day best streak</Text>
          </View>
          <Text style={styles.supporting}>
            {overall.totalCompletions} done · {overall.activeDays} active days
          </Text>
        </View>
        <Text style={styles.insight}>{insight}</Text>
        <View style={styles.ctaRow}>
          <Text style={styles.cta}>See full analysis</Text>
          <Text style={styles.arrow}>→</Text>
        </View>
      </PaperCard>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 18 },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
  eyebrow: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  heroRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  heroLeft: { flexDirection: "column" },
  hero: {
    fontSize: 38,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: -0.5,
  },
  heroSub: { fontSize: 13, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  supporting: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    textAlign: "right",
    flexShrink: 1,
    marginLeft: 12,
    marginBottom: 4,
  },
  insight: {
    fontSize: 14.5,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginTop: 14,
  },
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(26,26,26,0.09)",
  },
  cta: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  arrow: { fontSize: 17, color: Colors.ink },
});
