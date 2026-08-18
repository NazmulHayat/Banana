import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import type { DailyEntry, Habit, HabitLog } from "@/lib/db";
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

function pretty(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
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

  useEffect(() => {
    if (!visible || !date) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const [y, m] = date.split("-").map(Number);
      let month: DailyEntry[] = [];
      try {
        // Use the returned array (already current) rather than a store getter.
        month = await refreshEntries(y, m);
      } catch {
        // Read degrades to whatever's cached — never block the sheet.
      }
      if (cancelled) return;
      setEntries(month.filter((e) => e.date === date));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [visible, date, refreshEntries]);

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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{date ? pretty(date) : ""}</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.6} hitSlop={8}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
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
            <Text style={styles.muted}>Loading…</Text>
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
  habitRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  habitText: { fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwritingMedium },
  entry: {
    borderTopWidth: 1,
    borderTopColor: "rgba(26,26,26,0.08)",
    paddingTop: 12,
    marginTop: 4,
  },
  entryText: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwriting, lineHeight: 22 },
  muted: { fontSize: 14, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  mutedSmall: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwriting, marginTop: 6 },
});
