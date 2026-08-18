import { StampGrid } from "@/components/stamp-grid";
import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import { todayKey } from "@/lib/dates";
import { computeStamps, earnedStamps, nextStamps } from "@/lib/gamification";
import { useRecentEntries, useRecentHabitLogs } from "@/lib/use-recent-logs";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * FR-G3 — the stamp wall. Everything here is recomputed from the logs and
 * entries already in memory; no stamp is ever stored, and none can be lost.
 */
export default function StampsScreen() {
  const insets = useSafeAreaInsets();
  const { habits } = useDataStore();
  const { logs, loading: logsLoading } = useRecentHabitLogs(12);
  const { entries, loading: entriesLoading } = useRecentEntries(12);
  const loading = logsLoading || entriesLoading;

  const stamps = loading
    ? []
    : computeStamps({ habits, logs, entries, today: todayKey() });
  const earned = earnedStamps(stamps);
  const next = nextStamps(stamps, 6);

  return (
    <PaperBackground>
      <ScreenHeader title="Stamps" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        <View style={styles.wrap}>
          <Text style={styles.intro}>
            Stamps are for having done it. Once one is pressed it stays pressed —
            a broken streak never takes one back.
          </Text>

          {loading ? (
            <View style={styles.loading}>
              <Skeleton width="40%" height={16} />
              <View style={{ height: 16 }} />
              <Skeleton width="100%" height={110} borderRadius={10} />
            </View>
          ) : (
            <>
              <Text style={styles.section}>
                Earned{earned.length > 0 ? ` · ${earned.length}` : ""}
              </Text>
              {earned.length > 0 ? (
                <StampGrid stamps={earned} showProgress={false} />
              ) : (
                <Text style={styles.empty}>
                  None yet. Seven days of one habit is the first one.
                </Text>
              )}

              {next.length > 0 && (
                <>
                  <Text style={[styles.section, styles.sectionSpaced]}>On the way</Text>
                  <StampGrid stamps={next} />
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22 },
  intro: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginBottom: 22,
  },
  section: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.3,
    marginBottom: 14,
  },
  sectionSpaced: { marginTop: 30 },
  loading: { paddingVertical: 8 },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
  },
});
