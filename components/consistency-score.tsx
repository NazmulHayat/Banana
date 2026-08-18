import { Colors, Fonts } from "@/constants/theme";
import type { ConsistencyResult } from "@/lib/stats";
import { StyleSheet, Text, View } from "react-native";

interface ConsistencyScoreProps {
  /** Result from `lib/stats.consistencyScore`. */
  result: ConsistencyResult;
}

const TRACK = "rgba(26,26,26,0.07)";

/**
 * FR-AN3 — a 0-100 consistency score with its formula spelled out underneath.
 * An invented metric is only honest if the user can see exactly how it was
 * built, so the sentence below is generated from the same numbers the score
 * was: the window, the weights, and how many days actually counted.
 */
export function ConsistencyScore({ result }: ConsistencyScoreProps) {
  const { score, windowDays, newestWeight, oldestWeight, daysCounted } = result;

  if (daysCounted === 0) {
    return (
      <Text style={styles.empty}>
        Your score starts the day your first habit does.
      </Text>
    );
  }

  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.score}>{score}</Text>
        <Text style={styles.outOf}>/ 100</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${score}%` }]} />
      </View>
      <Text style={styles.formula}>
        Each of the last {windowDays} days scores the share of your habits you
        completed, weighted by how recent it is — today counts ×{newestWeight},
        {" "}
        {windowDays} days ago ×{oldestWeight}. Days before a habit existed are
        skipped, so {daysCounted} day{daysCounted === 1 ? "" : "s"} went into
        this.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  score: { fontSize: 40, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  outOf: { fontSize: 15, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  track: {
    height: 10,
    borderRadius: 5,
    backgroundColor: TRACK,
    overflow: "hidden",
    marginTop: 8,
  },
  fill: { height: "100%", backgroundColor: Colors.accent },
  formula: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
    marginTop: 10,
  },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
