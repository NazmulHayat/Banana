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
 * One column of the stat strip: the figure, then its unit underneath.
 *
 * These were a left-aligned stack beside the hero ("26 done" / "16 active
 * days" / "4 perfect"), which read as a ragged list — different digit counts
 * and different label lengths meant nothing lined up. As centred columns of
 * equal width they read as one tabular set, and they match the KPI tiles on
 * the analysis screen.
 */
function Metric({ value, label }: MetricProps) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
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
          <Skeleton width="50%" height={52} />
          <View style={{ height: 14 }} />
          <Skeleton width="85%" height={13} />
          <View style={{ height: 18 }} />
          <Skeleton width="100%" height={72} borderRadius={12} />
          <View style={{ height: 16 }} />
          <Skeleton width="100%" height={48} borderRadius={12} />
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
        {/* Hero: `bestCurrentStreak` is a LIVE streak — "best" is reserved
            for records, so the label says what the number is: current. */}
        <View style={styles.hero}>
          <InkIcon name="flame" size={30} />
          <Text style={styles.heroValue}>{overall.bestCurrentStreak}</Text>
          <View style={styles.heroCaption}>
            <Text style={styles.heroUnit}>
              {overall.bestCurrentStreak === 1 ? "day" : "days"}
            </Text>
            <Text style={styles.heroLabel}>current streak</Text>
          </View>
        </View>

        <Text style={styles.standing}>{standing}</Text>

        {/* The supporting figures, as one divided strip. */}
        <View style={styles.metrics}>
          <Metric value={overall.totalCompletions} label="done" />
          <View style={styles.metricRule} />
          <Metric
            value={overall.activeDays}
            label={overall.activeDays === 1 ? "active day" : "active days"}
          />
          {overall.perfectDays > 0 ? (
            <>
              <View style={styles.metricRule} />
              <Metric value={overall.perfectDays} label="perfect" />
            </>
          ) : null}
        </View>

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
  // The headline gets its own line now. Sharing a row with the supporting
  // numbers squeezed both: a 44pt figure beside a three-line column left the
  // card lopsided and the metrics cramped into half the width.
  hero: { flexDirection: "row", alignItems: "center", gap: 10 },
  heroValue: {
    fontSize: 52,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: -1,
    lineHeight: 58,
  },
  // Unit and label stack beside the figure so the number owns the baseline.
  heroCaption: { justifyContent: "center", paddingTop: 6 },
  heroUnit: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
  },
  heroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  // The stat strip: equal centred columns divided by hairlines, inset on the
  // paper so it reads as one grouped block rather than three loose numbers.
  metrics: {
    flexDirection: "row",
    alignItems: "stretch",
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Hairline.base,
    backgroundColor: Colors.card,
  },
  metric: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  // A real 1pt rule, inset top and bottom so it separates the columns without
  // touching the strip's own border. At `hairlineWidth` in `Hairline.base` it
  // was there but invisible — 0.33pt of 8%-alpha ink reads as nothing.
  metricRule: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 2,
    backgroundColor: Hairline.divider,
  },
  metricValue: {
    // Accent on the figures only — the numbers are what the eye should catch,
    // the units stay quiet in secondary ink.
    fontSize: 24,
    lineHeight: 30,
    color: Colors.accent,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  metricLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 1,
  },
  standing: {
    fontSize: 14.5,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 22,
    marginTop: 14,
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
