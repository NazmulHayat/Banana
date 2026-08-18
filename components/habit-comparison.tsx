import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import type { HabitComparisonRow } from "@/lib/stats";
import { StyleSheet, Text, View } from "react-native";

interface HabitComparisonProps {
  /** Ranked rows from `lib/stats.habitComparison` (best → worst). */
  rows: HabitComparisonRow[];
  /** Drill into one habit's deep-dive. */
  onSelect?: (habitId: string) => void;
}

/**
 * FR-AN2 — habits ranked by this month's completion rate, drawn as bars so the
 * one that's slipping is visible at a glance. No red, no scolding: the bar is
 * just shorter. A habit with no eligible days yet reads "new", never 0%.
 */
export function HabitComparison({ rows, onSelect }: HabitComparisonProps) {
  if (rows.length === 0) {
    return <Text style={styles.empty}>Add a habit to compare your weeks.</Text>;
  }

  return (
    <View>
      {rows.map((row) => {
        const isNew = row.days === 0;
        const pct = Math.round(row.rate * 100);
        const bar = (
          <View style={styles.row}>
            <View style={styles.head}>
              <Text style={styles.name} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={styles.value}>{isNew ? "new" : `${pct}%`}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${isNew ? 0 : pct}%` }]} />
            </View>
            <Text style={styles.meta}>
              {isNew
                ? "starts counting today"
                : `${row.done} of ${row.days} day${row.days === 1 ? "" : "s"} since you started it`}
            </Text>
          </View>
        );

        return onSelect ? (
          <PressableScale
            key={row.habitId}
            scaleTo={0.99}
            onPress={() => onSelect(row.habitId)}
            // The bar is three separate Texts — say the whole row at once.
            accessibilityLabel={
              isNew
                ? `${row.name}, new, starts counting today`
                : `${row.name}, ${pct} percent, ${row.done} of ${row.days} day${
                    row.days === 1 ? "" : "s"
                  } since you started it`
            }
            accessibilityHint="Opens this habit's analysis"
          >
            {bar}
          </PressableScale>
        ) : (
          <View key={row.habitId}>{bar}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Hairline.strong },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  name: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    marginRight: 12,
  },
  value: { fontSize: 14, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  track: { height: 8, borderRadius: 4, backgroundColor: Hairline.track, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: Colors.accent },
  meta: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
