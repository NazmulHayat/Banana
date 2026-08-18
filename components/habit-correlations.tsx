import { Colors, Fonts } from "@/constants/theme";
import type { Habit } from "@/lib/db";
import type { HabitCorrelation } from "@/lib/stats";
import { StyleSheet, Text, View } from "react-native";

interface HabitCorrelationsProps {
  /** Top pairs from `lib/stats.habitCorrelations` (already guard-railed). */
  correlations: HabitCorrelation[];
  /** Current habits, for names. */
  habits: Habit[];
}

/**
 * FR-AN4 — "you do X on 80% of the days you also do Y". The engine already
 * enforces the guard rails (minimum shared days, minimum rate, and a real lift
 * over the habit's own baseline) and caps the list, so this component only has
 * to say it plainly — including the sample size, so the claim can be judged.
 */
export function HabitCorrelations({ correlations, habits }: HabitCorrelationsProps) {
  const nameById = new Map(habits.map((h) => [h.id, h.name] as const));

  if (correlations.length === 0) {
    return (
      <Text style={styles.empty}>
        No pattern worth calling one yet — a few more weeks and pairs start to
        show up here.
      </Text>
    );
  }

  return (
    <View>
      {correlations.map((c) => {
        const a = nameById.get(c.habitId);
        const b = nameById.get(c.withHabitId);
        if (!a || !b) return null;
        return (
          <View key={`${c.habitId}:${c.withHabitId}`} style={styles.row}>
            <Text style={styles.line}>
              You complete <Text style={styles.bold}>{a}</Text> on{" "}
              <Text style={styles.bold}>{Math.round(c.rate * 100)}%</Text> of the
              days you also do <Text style={styles.bold}>{b}</Text>.
            </Text>
            <Text style={styles.meta}>
              {c.sample} day{c.sample === 1 ? "" : "s"} of overlap ·{" "}
              {Math.round(c.lift * 100)} points above its usual{" "}
              {Math.round(c.baseline * 100)}%
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  line: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 23,
  },
  bold: { fontFamily: Fonts.handwritingSemiBold },
  meta: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
  },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
  },
});
