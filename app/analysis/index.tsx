import { AnalysisContent } from "@/components/analysis-content";
import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useDataStore } from "@/lib/data-store";
import { useRecentHabitLogs } from "@/lib/use-recent-logs";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Overview analysis — the Tight 4 across all habits, with drill-in per habit. */
export default function AnalysisScreen() {
  const insets = useSafeAreaInsets();
  const { habits } = useDataStore();
  const { logs, loading } = useRecentHabitLogs(12);

  return (
    <PaperBackground>
      <ScreenHeader title="Stats & analysis" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
      >
        <AnalysisContent habits={habits} logs={logs} loading={loading} />
      </ScrollView>
    </PaperBackground>
  );
}
