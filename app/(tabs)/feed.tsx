import { FeedEntryCard } from "@/components/feed-entry-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import { fromDayKey } from "@/lib/dates";
import type { DailyEntry } from "@/lib/db";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  // +1 = moved to next month (content enters from the right), -1 = previous
  const [monthDirection, setMonthDirection] = useState(1);

  // Edit (FR-E3): the entry being edited + its draft text + save in-flight.
  const [editingEntry, setEditingEntry] = useState<DailyEntry | null>(null);
  const [editText, setEditText] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  // User-safe reason from the last failed edit — null while things are fine.
  const [editError, setEditError] = useState<string | null>(null);

  // Delete (FR-E4): the entry pending confirmation + delete in-flight + error.
  const [deletingEntry, setDeletingEntry] = useState<DailyEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Get entries from DataStore (already prefetched).
  // Sort newest-first: primary key is the day, secondary key is createdAt
  // so multiple highlights on the same day surface the freshest one on top.
  const entries = useMemo(() => {
    const monthEntries = dataStore.getEntriesForMonth(
      currentYear,
      currentMonth,
    );
    return [...monthEntries].sort((a, b) => {
      if (a.date !== b.date) {
        return fromDayKey(b.date).getTime() - fromDayKey(a.date).getTime();
      }
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [dataStore, currentYear, currentMonth]);

  // Bucket entries by day (preserving the sorted order: newest day first,
  // newest entry within a day first).
  const entriesByDay = useMemo(() => {
    const groups: { date: string; entries: typeof entries }[] = [];
    for (const entry of entries) {
      const last = groups[groups.length - 1];
      if (last && last.date === entry.date) {
        last.entries.push(entry);
      } else {
        groups.push({ date: entry.date, entries: [entry] });
      }
    }
    return groups;
  }, [entries]);

  // Only show loading if no entries are ready AND still loading
  const loading = !dataStore.entriesReady && entries.length === 0;

  // Load entries for current month if not already cached
  const loadEntries = useCallback(async () => {
    if (!session) return;

    // Only fetch if we don't have entries for this month
    const monthEntries = dataStore.getEntriesForMonth(
      currentYear,
      currentMonth,
    );
    if (monthEntries.length === 0) {
      await dataStore.refreshEntries(currentYear, currentMonth);
    }

    // Prefetch adjacent months in background
    const shiftMonth = (year: number, month: number, delta: number) => {
      const date = new Date(year, month - 1 + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() + 1 };
    };

    const prev = shiftMonth(currentYear, currentMonth, -1);
    const next = shiftMonth(currentYear, currentMonth, 1);
    void dataStore.refreshEntries(prev.year, prev.month);
    void dataStore.refreshEntries(next.year, next.month);
  }, [currentMonth, currentYear, session, dataStore]);

  // Reload entries when screen comes into focus or month changes
  useFocusEffect(
    useCallback(() => {
      loadEntries();
    }, [loadEntries]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await dataStore.refreshEntries(currentYear, currentMonth, {
        force: true,
      });
    } finally {
      setRefreshing(false);
    }
  };

  const changeMonth = (direction: number) => {
    setMonthDirection(direction);
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatDate = (dateString: string): string => {
    // Day keys are local-time; fromDayKey is the only sanctioned parse.
    const date = fromDayKey(dateString);
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    const md = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${weekday} · ${md}`;
  };

  // --- Edit (FR-E3) ---------------------------------------------------------
  const openEditor = (entry: DailyEntry) => {
    setEditingEntry(entry);
    setEditText(entry.text);
    setEditError(null);
  };

  const closeEditor = () => {
    if (editSaving) return;
    setEditingEntry(null);
    setEditText("");
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editingEntry || editSaving) return;
    const trimmed = editText.trim();
    // Nothing changed — just close.
    if (trimmed === editingEntry.text) {
      closeEditor();
      return;
    }
    // Photos are preserved; only the text changes.
    const updated: DailyEntry = { ...editingEntry, text: trimmed };
    setEditSaving(true);
    setEditError(null);
    // The store action does the optimistic update + persistence, and never
    // throws: `queued` is durable (it replays on reconnect) so it closes just
    // like `synced`; only `failed` keeps the editor open with the user's text.
    const outcome = await dataStore.saveEntry(updated);
    setEditSaving(false);
    if (outcome.status === "failed") {
      // Re-sync from the server so the optimistic edit doesn't stick.
      setEditError(outcome.reason);
      void dataStore.refreshEntries(currentYear, currentMonth, { force: true });
      return;
    }
    setEditingEntry(null);
    setEditText("");
  };

  // --- Delete (FR-E4) -------------------------------------------------------
  const requestDelete = (entry: DailyEntry) => {
    setDeletingEntry(entry);
    setDeleteError(null);
  };

  const cancelDelete = () => {
    if (deleteLoading) return;
    setDeletingEntry(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deletingEntry) return;
    const entry = deletingEntry;
    setDeleteLoading(true);
    setDeleteError(null);
    // `queued` deletes are durable too, so the dialog closes; only `failed`
    // holds it open with the reason swapped into the message.
    const outcome = await dataStore.deleteEntry(entry);
    setDeleteLoading(false);
    if (outcome.status === "failed") {
      setDeleteError(outcome.reason);
      void dataStore.refreshEntries(currentYear, currentMonth, { force: true });
      return;
    }
    setDeletingEntry(null);
  };

  return (
    <PaperBackground>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.ink}
          />
        }
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Feed</Text>
            <View style={styles.titleUnderline} />
          </View>
        </View>

        <View style={styles.monthHeader}>
          <IconButton onPress={() => changeMonth(-1)}>
            <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
          </IconButton>
          <Text style={styles.monthText}>{monthName}</Text>
          <IconButton onPress={() => changeMonth(1)}>
            <IconSymbol name="chevron.right" size={22} color={Colors.ink} />
          </IconButton>
        </View>

        {/* A queued write is saved on this device and replays on reconnect —
            say so once, quietly, instead of interrupting the edit flow. */}
        {dataStore.pendingWriteCount > 0 ? (
          <Text style={styles.syncNote}>
            Saved on this device — will sync when you&apos;re back online.
          </Text>
        ) : null}

        {loading ? (
          <View style={styles.entriesContainer}>
            <SkeletonCard height={140} style={styles.skeletonSpacing} />
            <SkeletonCard height={100} style={styles.skeletonSpacing} />
            <SkeletonCard height={180} style={styles.skeletonSpacing} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <IconSymbol
                name="book.closed.fill"
                size={36}
                color={Colors.ink}
              />
            </View>
            <Text style={styles.emptyText}>Your feed is empty</Text>
            <Text style={styles.emptyHint}>
              Capture a highlight on the Tracker tab to start your journal.
            </Text>
            <PressableScale
              style={styles.emptyCta}
              onPress={() => router.push("/(tabs)" as any)}
            >
              <Text style={styles.emptyCtaText}>Go to Tracker</Text>
            </PressableScale>
          </View>
        ) : (
          <Animated.View
            key={`${currentYear}-${currentMonth}`}
            style={styles.entriesContainer}
            entering={(monthDirection > 0 ? FadeInRight : FadeInLeft).duration(
              Motion.base,
            )}
            exiting={(monthDirection > 0 ? FadeOutLeft : FadeOutRight).duration(
              Motion.fast,
            )}
          >
            {(() => {
              let cardIndex = 0;
              return entriesByDay.map((group) => (
                <View key={group.date} style={styles.dayGroup}>
                  <View style={styles.dateRow}>
                    <View style={styles.dateDot} />
                    <Text style={styles.date}>{formatDate(group.date)}</Text>
                    {group.entries.length > 1 && (
                      <Text style={styles.dateCount}>
                        · {group.entries.length}
                      </Text>
                    )}
                  </View>
                  {group.entries.map((entry) => {
                    const delay =
                      Math.min(cardIndex++, Motion.staggerCap) * Motion.stagger;
                    return (
                      <Animated.View
                        key={entry.id}
                        style={styles.entryRow}
                        entering={FadeInDown.delay(delay)
                          .springify()
                          .damping(16)
                          .stiffness(140)}
                      >
                        <FeedEntryCard
                          entry={entry}
                          timeLabel={
                            entry.createdAt
                              ? formatTime(entry.createdAt)
                              : undefined
                          }
                          onEdit={openEditor}
                          onDelete={requestDelete}
                        />
                      </Animated.View>
                    );
                  })}
                </View>
              ));
            })()}
          </Animated.View>
        )}
      </ScrollView>

      {/* Edit entry (FR-E3) — text only; existing photos are preserved. */}
      <Modal
        visible={editingEntry !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEditor}
      >
        <Pressable style={styles.editBackdrop} onPress={closeEditor}>
          {/* Swallow taps so pressing the card doesn't dismiss the editor. */}
          <Pressable style={styles.editCardWrap} onPress={() => {}}>
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Edit highlight</Text>
              <TextInput
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
                editable={!editSaving}
                placeholder="Tell me something about today..."
                placeholderTextColor={Colors.textSecondary}
              />
              {editError ? (
                <Text style={styles.editErrorText}>{editError}</Text>
              ) : null}
              <View style={styles.editButtonRow}>
                <PressableScale
                  style={[styles.editButton, styles.editCancelButton]}
                  onPress={closeEditor}
                  disabled={editSaving}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </PressableScale>
                <PressableScale
                  style={[
                    styles.editButton,
                    styles.editSaveButton,
                    editSaving && styles.editButtonDisabled,
                  ]}
                  onPress={handleEditSave}
                  disabled={editSaving}
                >
                  <Text style={styles.editSaveText}>
                    {editSaving ? "Saving..." : "Save"}
                  </Text>
                </PressableScale>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete entry (FR-E4). */}
      <ConfirmDialog
        visible={deletingEntry !== null}
        title="Delete entry?"
        message={deleteError ?? "This highlight will be permanently removed."}
        confirmLabel="Delete"
        destructive
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  titleContainer: {
    position: "relative",
    paddingBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 1,
  },
  titleUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 48,
    height: 4,
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  monthHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  monthText: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  entriesContainer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  skeletonSpacing: {
    marginBottom: 28,
  },
  dayGroup: {
    marginBottom: 36,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    marginLeft: 2,
    gap: 8,
  },
  dateDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.accent,
  },
  date: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.2,
  },
  dateCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  entryRow: {
    marginBottom: 18,
  },
  emptyContainer: {
    marginHorizontal: 16,
    marginTop: 32,
    alignItems: "center",
    paddingVertical: 32,
  },
  loadingContainer: {
    marginHorizontal: 16,
    marginTop: 32,
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(26, 26, 26, 0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 6,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 20,
    paddingHorizontal: 32,
  },
  emptyCta: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.ink,
    borderRadius: 12,
  },
  emptyCtaText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  editBackdrop: {
    flex: 1,
    // Established ink-overlay scrim convention (rgba(26,26,26,…)).
    backgroundColor: "rgba(26,26,26,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  editCardWrap: {
    width: "100%",
    maxWidth: 360,
  },
  editCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 20,
  },
  editTitle: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 20,
    color: Colors.ink,
    marginBottom: 12,
  },
  editInput: {
    fontSize: 16,
    color: Colors.ink,
    minHeight: 96,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
    textAlignVertical: "top",
  },
  syncNote: {
    fontFamily: Fonts.handwriting,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    textAlign: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  editErrorText: {
    fontFamily: Fonts.handwriting,
    fontSize: 14,
    color: Colors.danger,
    marginTop: 12,
    lineHeight: 20,
  },
  editButtonRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 12,
  },
  editButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  editButtonDisabled: {
    opacity: 0.5,
  },
  editCancelButton: {
    backgroundColor: Colors.card,
    borderColor: Colors.ink,
  },
  editCancelText: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  editSaveButton: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  editSaveText: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 16,
    color: Colors.card,
  },
});
