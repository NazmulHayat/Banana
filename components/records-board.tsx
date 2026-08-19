import { Colors, Fonts, Hairline } from "@/constants/theme";
import type { PersonalRecord, RecordKey, RecordUnit } from "@/lib/gamification";
import { StyleSheet, Text, View } from "react-native";

interface RecordsBoardProps {
  /** Rows from `lib/gamification.computeRecords`. */
  records: PersonalRecord[];
  /**
   * What to say when there is nothing to board yet. The caller normally hides
   * the whole section instead (progressive disclosure), but a board with no
   * rows must still say something — never a blank frame.
   */
  emptyLabel?: string;
}

const TITLES: Record<RecordKey, string> = {
  longestStreak: "Longest streak",
  bestMonth: "Best month",
  mostHabitsInADay: "Most habits in one day",
  longestJournalRun: "Longest writing run",
  mostPhotosInAMonth: "Most photos in a month",
  mostPerfectDaysInAMonth: "Most perfect days in a month",
};

/** The number alone — the unit is spelled out once, in the column label. */
function figure(value: number, unit: RecordUnit): string {
  return unit === "percent" ? `${value}%` : `${value}`;
}

/** The unit, as a column caption. Agrees with the value it sits under. */
function unitLabel(value: number, unit: RecordUnit): string {
  if (unit === "percent") return "of days";
  if (unit === "days") return value === 1 ? "day" : "days";
  if (unit === "photos") return value === 1 ? "photo" : "photos";
  if (unit === "entries") return value === 1 ? "entry" : "entries";
  return "";
}

function spoken(r: PersonalRecord): string {
  const u = (v: number) => `${figure(v, r.unit)} ${unitLabel(v, r.unit)}`.trim();
  if (r.record === 0) return `${TITLES[r.key]}, no record yet`;
  if (r.atRecord) return `${TITLES[r.key]}, now ${u(r.current)}, at your best ever`;
  return `${TITLES[r.key]}, now ${u(r.current)}, best ${u(r.record)}, ${u(r.distance)} to tie`;
}

/**
 * FR-G2 — every stat as a beatable personal record, shown head-to-head: where
 * you are now, next to your best, and the gap between them stated in words.
 *
 * This used to be a progress bar filling toward the record, which was
 * unreadable: the record is the maximum by definition, so the bar could only
 * ever be full or not-full, "full" ambiguously meant "at your best" (a good
 * thing) while looking like "complete" (a finished thing), and nothing said
 * what the empty end represented. Two labelled figures and a plain sentence
 * say the same thing without a scale to misread.
 *
 * A record can be beaten or tied; it is never lost, so there is no losing
 * state here — only "at your best" and "N to tie".
 */
export function RecordsBoard({
  records,
  emptyLabel = "No records yet — the first day you log sets all of them.",
}: RecordsBoardProps) {
  if (records.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View>
      {records.map((r) => (
        <View key={r.key} style={styles.card} accessible accessibilityLabel={spoken(r)}>
          <View style={styles.head}>
            <Text style={styles.title}>{TITLES[r.key]}</Text>
            {r.atRecord && r.record > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>at your best</Text>
              </View>
            )}
          </View>

          {r.record === 0 ? (
            <Text style={styles.meta}>No record yet — the first one is yours.</Text>
          ) : (
            <>
              <View style={styles.figures}>
                <View style={styles.figure}>
                  <Text style={styles.figureLabel}>now</Text>
                  <Text style={styles.nowValue}>{figure(r.current, r.unit)}</Text>
                  <Text style={styles.figureUnit}>{unitLabel(r.current, r.unit)}</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.figure}>
                  <Text style={styles.figureLabel}>best</Text>
                  <Text style={styles.bestValue}>{figure(r.record, r.unit)}</Text>
                  <Text style={styles.figureUnit}>{unitLabel(r.record, r.unit)}</Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {r.atRecord
                  ? `You're matching your best ever.${r.detail ? ` Set ${r.detail}.` : ""}`
                  : `${figure(r.distance, r.unit)} ${unitLabel(r.distance, r.unit)} to tie it.${
                      r.detail ? ` Set ${r.detail}.` : ""
                    }`}
              </Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Hairline.base,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: {
    flex: 1,
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginRight: 10,
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.accent,
  },
  badgeText: { fontSize: 10.5, color: Colors.paper, fontFamily: Fonts.handwritingMedium },
  figures: { flexDirection: "row", alignItems: "stretch", marginTop: 12 },
  figure: { flex: 1 },
  divider: { width: 1, backgroundColor: Hairline.base, marginHorizontal: 16 },
  figureLabel: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  // Where you are, in the accent — the number that changes.
  nowValue: {
    fontSize: 28,
    color: Colors.accent,
    fontFamily: Fonts.handwritingSemiBold,
    lineHeight: 34,
  },
  // The bar to beat, in ink — steady, never lost.
  bestValue: {
    fontSize: 28,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    lineHeight: 34,
  },
  figureUnit: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  meta: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
  },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
  },
});
