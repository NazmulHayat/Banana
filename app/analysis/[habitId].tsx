import { AnalysisContent } from "@/components/analysis-content";
import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useDataStore } from "@/lib/data-store";
import { useRecentHabitLogs } from "@/lib/use-recent-logs";
import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Per-habit deep-dive — the Tight 4 scoped to one habit. */
export default function HabitAnalysisScreen() {
  const insets = useSafeAreaInsets();
  const { habitId } = useLocalSearchParams<{ habitId: string }>();
  const { habits, habitsReady } = useDataStore();
  const { logs, loading, failed, reload } = useRecentHabitLogs(12);

  const habit = habits.find((h) => h.id === habitId);
  // Until the habit list has actually resolved, "not found" is a guess. Once
  // it has, say so plainly instead of heading the page "Habit" above an error.
  const title = habit?.name ?? (habitsReady ? "Habit removed" : "Habit");

  return (
    <PaperBackground>
      <ScreenHeader title={title} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        <AnalysisContent
          habits={habits}
          logs={logs}
          habitId={habitId}
          loading={loading || !habitsReady}
          failedMonths={failed}
          onRetry={reload}
        />
      </ScrollView>
    </PaperBackground>
  );
}
