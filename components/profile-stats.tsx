import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperCard } from "@/components/ui/paper-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts } from "@/constants/theme";
import { DateFormats, type Habit, type HabitLog } from "@/lib/db";
import {
  computeAllHabitStats,
  computeOverallStats,
  type HabitStats,
} from "@/lib/stats";
import type { ComponentProps } from "react";
import { StyleSheet, Text, View } from "react-native";

type IconName = ComponentProps<typeof IconSymbol>["name"];

interface ProfileStatsProps {
  /** All habits to break down. */
  habits: Habit[];
  /**
   * Accumulated habit logs across the loaded window (last 12 months). The
   * stats engine derives streaks/totals from these.
   */
  logs: HabitLog[];
  /** True while the 12-month log window is still resolving. */
  loading: boolean;
}

/** Small label + big value tile used in the overall summary row. */
function SummaryTile({
  icon,
  value,
  label,
}: {
  icon: IconName;
  value: string | number;
  label: string;
}) {
  return (
    <PaperCard style={styles.summaryTile}>
      <View style={styles.summaryIconRow}>
        <IconSymbol name={icon} size={16} color={Colors.accent} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </PaperCard>
  );
}

/**
 * Real habit statistics for the profile screen. Computes per-habit streaks and
 * totals plus an overall summary from the merged stats engine. Renders loading
 * skeletons, an empty state, and the loaded breakdown — never a blank frame.
 */
export function ProfileStats({ habits, logs, loading }: ProfileStatsProps) {
  // Loading: mirror the existing three-tile skeleton rhythm.
  if (loading) {
    return (
      <View style={styles.summaryRow}>
        {[0, 1, 2].map((i) => (
          <PaperCard key={i} style={styles.summaryTile}>
            <Skeleton width={24} height={24} borderRadius={12} />
            <View style={{ height: 10 }} />
            <Skeleton width={40} height={28} borderRadius={6} />
            <View style={{ height: 6 }} />
            <Skeleton width={50} height={11} borderRadius={4} />
          </PaperCard>
        ))}
      </View>
    );
  }

  // Empty: no habits yet — calm, on-brand message (the Habits section below
  // owns the "add your first habit" CTA, so this stays minimal).
  if (habits.length === 0) {
    return (
      <PaperCard style={styles.emptyCard}>
        <Text style={styles.emptyText}>
          Add a habit to start tracking streaks.
        </Text>
      </PaperCard>
    );
  }

  const today = DateFormats.formatDate(new Date());
  const perHabit: HabitStats[] = computeAllHabitStats(habits, logs, today);
  const overall = computeOverallStats(perHabit, logs);

  // Look up each habit's computed stats by id for the breakdown rows.
  const statsById = new Map<string, HabitStats>(
    perHabit.map((s) => [s.habitId, s] as const),
  );

  return (
    <View>
      {/* Overall summary */}
      <View style={styles.summaryRow}>
        <SummaryTile
          icon="flame.fill"
          value={overall.bestCurrentStreak}
          label="Best streak"
        />
        <SummaryTile
          icon="checkmark.circle.fill"
          value={overall.totalCompletions}
          label="Completions"
        />
        <SummaryTile
          icon="calendar"
          value={overall.activeDays}
          label="Active days"
        />
      </View>

      {/* Per-habit breakdown */}
      <View style={styles.breakdown}>
        {habits.map((habit) => {
          const s = statsById.get(habit.id);
          const currentStreak = s?.currentStreak ?? 0;
          const total = s?.totalCompletions ?? 0;
          return (
            <View key={habit.id} style={styles.habitRow}>
              <Text style={styles.habitName} numberOfLines={1}>
                {habit.name}
              </Text>
              <View style={styles.habitStatsGroup}>
                <View style={styles.habitStat}>
                  <IconSymbol
                    name="flame.fill"
                    size={12}
                    color={Colors.accent}
                  />
                  <Text style={styles.habitStatText}>{currentStreak}</Text>
                </View>
                <View style={styles.habitStat}>
                  <IconSymbol
                    name="checkmark.circle.fill"
                    size={12}
                    color={Colors.textSecondary}
                  />
                  <Text style={styles.habitStatText}>{total}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryTile: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  summaryIconRow: { marginBottom: 6, opacity: 0.9 },
  summaryValue: {
    fontSize: 28,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  summaryLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    textAlign: "center",
  },
  emptyCard: { paddingVertical: 20, alignItems: "center" },
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
  breakdown: { marginTop: 12, gap: 2 },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  habitName: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    marginRight: 12,
  },
  habitStatsGroup: { flexDirection: "row", gap: 16 },
  habitStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  habitStatText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
});
