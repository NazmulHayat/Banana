import { Colors, Fonts, Hairline } from "@/constants/theme";
import type { PersonalRecord, RecordKey, RecordUnit } from "@/lib/gamification";
import { StyleSheet, Text, View } from "react-native";

interface RecordsBoardProps {
  /** Rows from `lib/gamification.computeRecords`. */
  records: PersonalRecord[];
}

const TITLES: Record<RecordKey, string> = {
  longestStreak: "Longest streak",
  bestMonth: "Best month",
  mostHabitsInADay: "Most habits in one day",
  longestJournalRun: "Longest writing run",
  mostPhotosInAMonth: "Most photos in a month",
  mostPerfectDaysInAMonth: "Most perfect days in a month",
};

function format(value: number, unit: RecordUnit): string {
  if (unit === "percent") return `${value}%`;
  if (unit === "days") return `${value} day${value === 1 ? "" : "s"}`;
  if (unit === "photos") return `${value} photo${value === 1 ? "" : "s"}`;
  if (unit === "entries") return `${value} entr${value === 1 ? "y" : "ies"}`;
  return `${value}`;
}

/**
 * FR-G2 — every stat as a beatable personal record, with a distance marker
 * showing where you are against your own best. A record can be beaten or
 * tied; it is never lost, so there is no losing state in this component —
 * only "at your best" and "N to tie".
 */
export function RecordsBoard({ records }: RecordsBoardProps) {
  return (
    <View>
      {records.map((r) => {
        const progress = r.record > 0 ? Math.min(1, r.current / r.record) : 0;
        return (
          <View key={r.key} style={styles.row}>
            <View style={styles.head}>
              <Text style={styles.title}>{TITLES[r.key]}</Text>
              <Text style={styles.record}>{format(r.record, r.unit)}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${progress * 100}%` }]} />
              {r.record > 0 && (
                <View style={[styles.marker, { left: `${progress * 100}%` }]} />
              )}
            </View>
            <Text style={styles.meta}>
              {r.record === 0
                ? "no record yet — the first one is yours"
                : r.atRecord
                  ? `now ${format(r.current, r.unit)} · at your best ever`
                  : `now ${format(r.current, r.unit)} · ${format(r.distance, r.unit)} to tie it${r.detail ? ` · set ${r.detail}` : ""}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Hairline.strong },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    marginRight: 12,
  },
  record: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Hairline.track,
    justifyContent: "center",
  },
  fill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  // The distance marker: where you stand on the way to your own best.
  marker: {
    position: "absolute",
    width: 2,
    height: 16,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: Colors.ink,
  },
  meta: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 8,
  },
});
