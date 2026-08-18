import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { todayKey } from "@/lib/dates";
import { type Habit } from "@/lib/db";
import {
  computeAllHabitStats,
  computeOverallStats,
  daysToRecord,
} from "@/lib/stats";
import { useRecentHabitLogs } from "@/lib/use-recent-logs";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

interface ProfileStatsProps {
  /** All habits to summarise. */
  habits: Habit[];
  /** Bump to force-reload the stats window (e.g. pull-to-refresh). */
  refreshToken?: number;
}

/**
 * The stats peek on the profile hub: a headline streak, a couple of supporting
 * numbers, and one line about where you stand against your own record — the
 * doorway into the full analysis (which is free, and always has been).
 *
 * Every state is tappable. Loading and no-habits used to render a bare card
 * OUTSIDE the pressable, which left the only entrance to the whole analysis
 * surface dead exactly when a new user first arrives. Loading still opens the
 * analysis (that screen has its own skeleton); with no habits the card leads
 * where it should — to adding one.
 *
 * The rotating "your story" sentence deliberately lives on the analysis screen
 * only. It used to render here AND there, one tap apart.
 */
export function ProfileStats({ habits, refreshToken = 0 }: ProfileStatsProps) {
  const { logs, loading } = useRecentHabitLogs(12, refreshToken);

  const open = (where: "/analysis" | "/habits") => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(where);
  };

  if (loading) {
    return (
      <PressableScale
        scaleTo={0.98}
        onPress={() => open("/analysis")}
        accessibilityLabel="Your momentum, still loading"
        accessibilityHint="Opens your full analysis"
      >
        <PaperCard style={styles.card}>
          <Skeleton width="40%" height={12} />
          <View style={{ height: 12 }} />
          <Skeleton width="55%" height={34} />
          <View style={{ height: 14 }} />
          <Skeleton width="85%" height={13} />
        </PaperCard>
      </PressableScale>
    );
  }

  if (habits.length === 0) {
    return (
      <PressableScale
        scaleTo={0.98}
        onPress={() => open("/habits")}
        accessibilityLabel="No habits yet. Add your first habit"
        accessibilityHint="Opens your habits"
      >
        <PaperCard style={styles.card}>
          <Text style={styles.eyebrow}>your momentum</Text>
          <Text style={styles.emptyText}>
            Nothing to measure yet. Add a habit and your streaks, records and
            story start filling in from day one.
          </Text>
          <View style={styles.ctaRow}>
            <Text style={styles.cta}>Add your first habit</Text>
            <Text style={styles.arrow}>→</Text>
          </View>
        </PaperCard>
      </PressableScale>
    );
  }

  const today = todayKey();
  // Passing `habits` is what turns on eligibility windows, future-day clamping
  // and orphan filtering in the engine (bug D13) — never omit it here.
  const perHabit = computeAllHabitStats(habits, logs, today);
  const overall = computeOverallStats(perHabit, logs, today, habits);

  const toRecord = daysToRecord(
    overall.bestCurrentStreak,
    overall.bestLongestStreak,
  );
  const standing =
    overall.totalCompletions === 0
      ? "Nothing ticked yet — today can be day one."
      : overall.bestLongestStreak === 0
        ? "Your first streak starts with two days in a row."
        : toRecord > 0
          ? `${toRecord} day${toRecord === 1 ? "" : "s"} from your best ever run of ${overall.bestLongestStreak}.`
          : "You're at your best streak ever right now.";

  return (
    <PressableScale
      scaleTo={0.98}
      onPress={() => open("/analysis")}
      accessibilityLabel={`Your momentum. Best streak ${overall.bestCurrentStreak} day${
        overall.bestCurrentStreak === 1 ? "" : "s"
      }. ${standing}`}
      accessibilityHint="Opens your full analysis"
    >
      <PaperCard style={styles.card}>
        <Text style={styles.eyebrow}>your momentum</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroLeft}>
            <Text style={styles.hero}>🔥 {overall.bestCurrentStreak}</Text>
            <Text style={styles.heroSub}>day best streak</Text>
          </View>
          <Text style={styles.supporting}>
            {overall.totalCompletions} done · {overall.activeDays} active days
            {overall.perfectDays > 0 ? ` · ${overall.perfectDays} perfect` : ""}
          </Text>
        </View>
        <Text style={styles.standing}>{standing}</Text>
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
    fontSize: 14.5,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginTop: 4,
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
  standing: {
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
    borderTopColor: Hairline.strong,
  },
  cta: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  arrow: { fontSize: 17, color: Colors.ink },
});
