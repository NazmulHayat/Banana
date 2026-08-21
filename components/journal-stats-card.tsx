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
      // Same four rows as the loaded state, so nothing shifts when it lands.
      <View style={styles.ledger}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.row}>
            <Skeleton width="45%" height={18} />
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
      {/* The index page of a notebook: label, dot leader, figure.
          Four columns across a phone doesn't work — 30pt numbers plus
          two-word labels overflow, and the last two collapse to nothing. Rows
          have no width pressure at all, and this is the most paper-journal
          shape available: it's how a real ledger reads. */}
      <View style={styles.ledger}>
        <Kpi value={stats.totalEntries} label="Entries" />
        <Kpi value={stats.daysJournaled} label="Days written" />
        <Kpi value={stats.longestStreak} label="Longest run" suffix="d" />
        <Kpi value={stats.photos} label="Photos" />
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
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {/* The leader is a bordered view, not a string of dots: a text leader
          can't stretch to fill, so it never lines the figures up. */}
      <View style={styles.leader} />
      <Text style={styles.rowValue}>
        {value}
        {suffix ?? ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ledger: { paddingTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingVertical: 9,
  },
  rowLabel: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  leader: {
    flex: 1,
    // Sits on the text baseline rather than the row centre, so the dots run
    // along the bottom of the words the way a printed index does.
    marginBottom: 4,
    marginHorizontal: 10,
    borderBottomWidth: 1,
    borderStyle: "dotted",
    borderBottomColor: Hairline.raised,
  },
  rowValue: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: -0.3,
  },
  months: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
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
