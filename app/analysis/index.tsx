import { AnalysisContent } from "@/components/analysis-content";
import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useDataStore } from "@/lib/data-store";
import { useRecentEntries, useRecentHabitLogs } from "@/lib/use-recent-logs";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Overview analysis — the Tight 4 across all habits, with drill-in per habit. */
export default function AnalysisScreen() {
  const insets = useSafeAreaInsets();
  const { habits, habitsReady } = useDataStore();
  const { logs, loading, failed, reload } = useRecentHabitLogs(12);
  // Entries power the journal half (FR-AN1); they load on their own clock so
  // the habit charts never wait on them.
  const { entries, loading: entriesLoading, failed: entriesFailed } = useRecentEntries(12);

  return (
    <PaperBackground>
      <ScreenHeader title="Stats & analysis" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        <AnalysisContent
          habits={habits}
          logs={logs}
          entries={entries}
          entriesLoading={entriesLoading}
          // Habits still loading would otherwise read as "you have none".
          loading={loading || !habitsReady}
          failedMonths={failed + entriesFailed}
          onRetry={reload}
        />
      </ScrollView>
    </PaperBackground>
  );
}
