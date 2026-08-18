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
 * Three states, never a blank frame: skeleton, empty, loaded.
 */
export function JournalStatsCard({ stats, loading }: JournalStatsCardProps) {
  if (loading || !stats) {
    return (
      <View>
        <Skeleton width="45%" height={26} />
        <View style={{ height: 12 }} />
        <Skeleton width="80%" height={14} />
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
      <View style={styles.grid}>
        <Stat value={stats.totalEntries} label="entries written" />
        <Stat value={stats.longestStreak} label="longest writing run" suffix="d" />
        <Stat value={stats.photos} label="photos kept" />
      </View>
      <Text style={styles.line}>
        {stats.currentStreak > 0
          ? `You've written ${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"} in a row.`
          : `${stats.daysJournaled} day${stats.daysJournaled === 1 ? "" : "s"} of your life are written down.`}
      </Text>
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

interface StatProps {
  value: number;
  label: string;
  suffix?: string;
}

function Stat({ value, label, suffix }: StatProps) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>
        {value}
        {suffix ?? ""}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", justifyContent: "space-between" },
  stat: { flex: 1 },
  statValue: { fontSize: 26, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  statLabel: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
  line: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 23,
    marginTop: 14,
  },
  months: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
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
