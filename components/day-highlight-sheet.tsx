import { IconSymbol } from "@/components/ui/icon-symbol";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import { fromDayKey, parseDayKey, todayKey } from "@/lib/dates";
import type { DailyEntry, Habit, HabitLog } from "@/lib/db";
import { perfectDays } from "@/lib/stats";
import { useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface DayHighlightSheetProps {
  visible: boolean;
  /** The tapped day "YYYY-MM-DD", or null when closed. */
  date: string | null;
  habits: Habit[];
  /** The already-loaded logs (to derive which habits were done that day). */
  logs: HabitLog[];
  onClose: () => void;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Day keys are local-time (lib/dates.ts) — parse them there, never inline.
function pretty(date: string): string {
  const parts = parseDayKey(date);
  if (!parts) return "";
  const dow = fromDayKey(date).getDay();
  return `${WEEKDAYS[dow]}, ${MONTHS[parts.month - 1]} ${parts.day}`;
}

/**
 * Bottom sheet shown when a heatmap day is tapped: which habits were completed
 * and the journal entry logged that day. Loads entries from the store's cache
 * (filter by date) — no new round-trip if the month is already loaded.
 */
export function DayHighlightSheet({ visible, date, habits, logs, onClose }: DayHighlightSheetProps) {
  // Depend on the stable `refreshEntries` callback only — depending on the
  // whole store would re-fire this effect forever (it sets state internally).
  const { refreshEntries } = useDataStore();
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  // The month couldn't be read at all. Distinct from "nothing journaled" —
  // an empty catch used to render the two identically.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!visible || !date) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFailed(false);
      const parts = parseDayKey(date);
      let month: DailyEntry[] = [];
      let broke = false;
      try {
        // Use the returned array (already current) rather than a store getter.
        if (parts) month = await refreshEntries(parts.year, parts.month);
      } catch {
        // Reads degrade — but the user is told, and can ask again.
        broke = true;
      }
      if (cancelled) return;
      setEntries(month.filter((e) => e.date === date));
      setFailed(broke);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [visible, date, refreshEntries, attempt]);

  // FR-G1 — was every habit that existed on this day completed? Eligibility
  // lives in the engine, so a habit added later never spoils an older day.
  const isPerfect =
    date !== null && perfectDays(habits, logs, todayKey()).includes(date);

  const nameById = new Map(habits.map((h) => [h.id, h.name] as const));
  const completed = date
    ? [
        ...new Set(
          logs
            .filter((l) => l.date === date && l.completed)
            .map((l) => nameById.get(l.habitId))
            .filter((n): n is string => Boolean(n)),
        ),
      ]
    : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {date ? pretty(date) : ""}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.6}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Done, close this day"
          >
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {isPerfect && <Text style={styles.perfect}>A perfect day — everything you&apos;d taken on.</Text>}
          <Text style={styles.section}>Completed</Text>
          {completed.length > 0 ? (
            completed.map((n) => (
              <View key={n} style={styles.habitRow}>
                <IconSymbol name="checkmark.circle.fill" size={16} color={Colors.accent} />
                <Text style={styles.habitText}>{n}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No habits completed this day.</Text>
          )}

          <Text style={[styles.section, { marginTop: 24 }]}>Journal</Text>
          {loading ? (
            <View accessibilityLabel="Loading this day's journal">
              <Skeleton width="85%" height={14} />
              <View style={{ height: 8 }} />
              <Skeleton width="60%" height={14} />
            </View>
          ) : failed ? (
            <TouchableOpacity
              onPress={() => setAttempt((a) => a + 1)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Couldn't load this day. Tap to try again."
            >
              <Text style={styles.retry}>
                Couldn&apos;t load this day · tap to try again
              </Text>
            </TouchableOpacity>
          ) : entries.length > 0 ? (
            entries.map((e) => (
              <View key={e.id} style={styles.entry}>
                {e.text ? (
                  <Text style={styles.entryText}>{e.text}</Text>
                ) : (
                  <Text style={styles.muted}>(no text)</Text>
                )}
                {e.mediaPaths.length > 0 ? (
                  <Text style={styles.mutedSmall}>
                    {e.mediaPaths.length} photo{e.mediaPaths.length > 1 ? "s" : ""}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <Text style={styles.muted}>Nothing journaled this day.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  title: { fontSize: 22, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  close: { fontSize: 16, color: Colors.textSecondary, fontFamily: Fonts.handwritingMedium },
  body: { paddingHorizontal: 20, paddingBottom: 40 },
  section: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.3,
    marginBottom: 10,
  },
  perfect: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 14,
  },
  habitRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  habitText: { fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwritingMedium },
  entry: {
    borderTopWidth: 1,
    borderTopColor: Hairline.base,
    paddingTop: 12,
    marginTop: 4,
  },
  entryText: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwriting, lineHeight: 22 },
  muted: { fontSize: 14, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  retry: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    lineHeight: 21,
  },
  mutedSmall: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwriting, marginTop: 6 },
});
