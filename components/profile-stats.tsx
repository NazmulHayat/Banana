import { InkIcon } from "@/components/ui/ink-icon";
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

interface MetricProps {
  /** The number itself — the thing the eye lands on. */
  value: number;
  /** What it counts, already singular/plural-correct. */
  label: string;
}

/**
 * One supporting number in the momentum card's right-hand column. Value first,
 * then its unit — these used to be a run-on sentence ("2 done · 1 active
 * days"), which read as prose and hid the figures.
 */
function Metric({ value, label }: MetricProps) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

interface CardActionProps {
  /** Button text. */
  label: string;
  /** Draw the bar-chart glyph before the label (the analysis entrance). */
  chart?: boolean;
  onPress: () => void;
  accessibilityHint: string;
}

/**
 * The card's footer action. A real button — filled with the accent wash, with
 * its own press target — not the underlined-looking text link it used to be.
 *
 * It nests inside the card-wide PressableScale on purpose: React Native's
 * responder system hands the touch to the innermost pressable, so a tap on the
 * button runs only this onPress (and scales only this button), while a tap
 * anywhere else on the card still runs the card's.
 */
function CardAction({ label, chart, onPress, accessibilityHint }: CardActionProps) {
  return (
    <PressableScale
      style={styles.action}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
    >
      {chart ? <InkIcon name="chart" size={18} /> : null}
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.arrow}>→</Text>
    </PressableScale>
  );
}

/**
 * The stats peek on the profile hub: a headline streak, a couple of supporting
 * numbers, and one line about where you stand against your own record — the
 * doorway into the full analysis (which is free, and always has been).
 *
 * Since the duplicate "Stats & analysis" row was cut from Manage, this card's
 * button is the single entrance to the analysis surface, so every state keeps
 * one: loading opens the analysis anyway (that screen has its own skeleton),
 * and with no habits it leads where it should — to adding one.
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
          <View style={{ height: 14 }} />
          <Skeleton width="55%" height={40} />
          <View style={{ height: 16 }} />
          <Skeleton width="85%" height={13} />
          <View style={{ height: 16 }} />
          <Skeleton width="100%" height={44} borderRadius={12} />
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
          <CardAction
            label="Add your first habit"
            onPress={() => open("/habits")}
            accessibilityHint="Opens your habits"
          />
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
      accessibilityLabel={`Your momentum. Current streak ${overall.bestCurrentStreak} day${
        overall.bestCurrentStreak === 1 ? "" : "s"
      }. ${standing}`}
      accessibilityHint="Opens your full analysis"
    >
      <PaperCard style={styles.card}>
        <Text style={styles.eyebrow}>your momentum</Text>

        {/* Hero band: the label sits ABOVE its number (same order as the
            analysis screen's hero), so the big figure isn't chased by a
            "day best streak" caption competing with the flame beside it. */}
        <View style={styles.hero}>
          <View>
            {/* `bestCurrentStreak` is a LIVE streak — "best" is reserved for
                records, so the label says what the number is: current. */}
            <Text style={styles.heroLabel}>current streak</Text>
            <View style={styles.heroValueRow}>
              <InkIcon name="flame" size={26} />
              <Text style={styles.heroValue}>{overall.bestCurrentStreak}</Text>
              <Text style={styles.heroUnit}>
                {overall.bestCurrentStreak === 1 ? "day" : "days"}
              </Text>
            </View>
          </View>
          <View style={styles.heroRule} />
          <View style={styles.metrics}>
            <Metric value={overall.totalCompletions} label="done" />
            <Metric
              value={overall.activeDays}
              label={overall.activeDays === 1 ? "active day" : "active days"}
            />
            {overall.perfectDays > 0 ? (
              <Metric value={overall.perfectDays} label="perfect" />
            ) : null}
          </View>
        </View>

        <Text style={styles.standing}>{standing}</Text>

        <CardAction
          label="Stats & analysis"
          chart
          onPress={() => open("/analysis")}
          accessibilityHint="Opens your full analysis"
        />
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
    marginBottom: 10,
  },
  hero: { flexDirection: "row", alignItems: "center" },
  heroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    marginBottom: 2,
  },
  heroValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroValue: {
    fontSize: 44,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: -0.5,
    lineHeight: 50,
  },
  heroUnit: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    alignSelf: "flex-end",
    marginBottom: 10,
  },
  // A drawn rule between the headline and its supporting data — the two
  // groups are different kinds of number and shouldn't share a column.
  heroRule: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: Hairline.strong,
    marginHorizontal: 16,
  },
  metrics: { flex: 1, gap: 2 },
  metric: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  metricValue: {
    // Accent on the figures only — the numbers are what the eye should catch,
    // the units stay quiet in secondary ink.
    fontSize: 16,
    color: Colors.accent,
    fontFamily: Fonts.handwritingSemiBold,
    minWidth: 24,
    textAlign: "right",
  },
  metricLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    flexShrink: 1,
  },
  standing: {
    fontSize: 14.5,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 22,
    marginTop: 16,
  },
  action: {
    // Same surface language as the Manage rows — card fill, ink hairline —
    // so it reads as one of the app's category rows rather than a stray
    // accent-washed button.
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Hairline.base,
    marginTop: 16,
  },
  actionLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  arrow: { fontSize: 17, color: Colors.ink },
});
