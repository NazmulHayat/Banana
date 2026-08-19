import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import type { JournalStats } from "@/lib/journal-stats";
import { StyleSheet, Text, View } from "react-native";

interface JournalStatsCardProps {
  /** Result from `lib/journal-stats.computeJournalStats`, or null while loading. */
  stats: JournalStats | null;
  loading: boolean;
}

/**
 * FR-AN1 — the journal half of the analysis: what you wrote, how long you kept
 * writing, how many photos you kept, and the months you had the most to say.
 *
 * Laid out as four KPI tiles rather than a row of bare numbers — boxed, each
 * figure sitting on its own card surface so the section reads as a dashboard
 * at a glance instead of as a sentence. Same card + hairline language as the
 * Manage rows and the momentum card, so it stays inside the paper aesthetic.
 *
 * Three states, never a blank frame: skeleton, empty, loaded.
 */
export function JournalStatsCard({ stats, loading }: JournalStatsCardProps) {
  if (loading || !stats) {
    return (
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.tile}>
            <Skeleton width="55%" height={26} />
            <View style={{ height: 6 }} />
            <Skeleton width="80%" height={11} />
          </View>
        ))}
      </View>
    );
  }

  if (stats.totalEntries === 0) {
    return (
      <Text style={styles.empty}>
        Nothing written yet — your first highlight starts this half of the story.
      </Text>
    );
  }

  return (
    <View>
      <Text style={styles.line}>
        {stats.currentStreak > 0
          ? `You've written ${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"} in a row.`
          : `${stats.daysJournaled} day${stats.daysJournaled === 1 ? "" : "s"} of your life are written down.`}
      </Text>
      <View style={styles.grid}>
        <Kpi value={stats.totalEntries} label="entries" />
        <Kpi value={stats.daysJournaled} label="days written" />
        <Kpi value={stats.longestStreak} label="longest run" suffix="d" />
        <Kpi value={stats.photos} label="photos" />
      </View>
      {stats.mostWrittenMonths.length > 0 && (
        <View style={styles.months}>
          <Text style={styles.monthsLabel}>Most written</Text>
          {stats.mostWrittenMonths.map((m) => (
            <Text key={m.key} style={styles.month}>
              {m.label} · {m.count}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

interface KpiProps {
  value: number;
  label: string;
  suffix?: string;
}

/**
 * One boxed figure, centred. The number carries the accent; the unit stays
 * quiet underneath. Centring matters here because the four tiles are read as a
 * set — left-aligned figures of different digit counts made the row look
 * ragged rather than tabular.
 */
function Kpi({ value, label, suffix }: KpiProps) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>
        {value}
        {suffix ?? ""}
      </Text>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Two per row on every iPhone width — `48%` leaves the gap without needing
  // to measure the container.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    marginTop: 16,
  },
  tile: {
    width: "48%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Hairline.base,
  },
  tileValue: {
    fontSize: 30,
    lineHeight: 36,
    color: Colors.accent,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  tileLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 3,
  },
  line: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 23,
  },
  months: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Hairline.strong,
  },
  monthsLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
  },
  month: { fontSize: 13, color: Colors.ink, fontFamily: Fonts.handwritingMedium },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
  },
});
