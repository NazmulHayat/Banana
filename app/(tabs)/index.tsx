import { HabitGrid } from "@/components/habit-grid";
import { HighlightInput } from "@/components/highlight-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import {
    // Types
    DailyEntry,
    getEntriesForDate,
    Habit,
    HabitLog,
    // Operations
    saveEntry,
    saveHabits,
    toggleHabitLog,
    upsertEntryInCache,
} from "@/lib/db";
import { DateFormats } from "@/lib/db/schema";
import { uploadImage } from "@/lib/media";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    Modal,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [todayEntryCount, setTodayEntryCount] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const habitGridHeaderRef = useRef<View>(null);
  const stickyHeaderScrollRef = useRef<ScrollView>(null);
  const [headerStickyY, setHeaderStickyY] = useState(0);
  const [snackbar, setSnackbar] = useState({ visible: false, message: "" });
  const snackbarAnim = useRef(new Animated.Value(0)).current;
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Progressive day animation refs
  const dayAnimations = useRef<Map<string, Animated.Value>>(new Map());

  // Habit management state
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [habitName, setHabitName] = useState("");

  // Delete-habit confirmation (reusable ConfirmDialog drives the confirm step)
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Entry save state (upload + persist)
  const [savingEntry, setSavingEntry] = useState(false);
  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthKey = DateFormats.formatYearMonth(currentYear, currentMonth);

  // Get logs for current month with progressive rendering
  const logsForMonth = dataStore.getLogsForMonth(currentYear, currentMonth);

  // Build progressively rendered logs from day-by-day cache
  const logs = useMemo(() => {
    // First check if we have month data
    if (logsForMonth.length > 0) {
      return logsForMonth;
    }
    // Otherwise, build from day-by-day progressive data
    const dayLogs: HabitLog[] = [];
    dataStore.habitLogsByDay.forEach((dayLogsForKey, key) => {
      if (key.startsWith(monthKey)) {
        dayLogs.push(...dayLogsForKey);
      }
    });
    return dayLogs;
  }, [logsForMonth, dataStore.habitLogsByDay, monthKey]);

  // Get habits from DataStore, OR derive from logs if habits aren't ready yet
  // This allows logs to render immediately while habit names load in background
  const habits = useMemo(() => {
    const storeHabits = dataStore.habits;
    
    // If we have habits from store, use them
    if (storeHabits.length > 0) {
      return storeHabits;
    }
    
    // No habits yet - extract unique habit IDs from logs and create placeholders
    // This allows the grid to render with logs while waiting for habit names
    if (logs.length > 0) {
      const uniqueHabitIds = new Set<string>();
      logs.forEach((log) => uniqueHabitIds.add(log.habitId));
      
      // Create placeholder habits with loading indicator as name
      return Array.from(uniqueHabitIds).map((id): Habit => ({
        id,
        name: "...", // Placeholder while loading
        createdAt: "",
      }));
    }
    
    return [];
  }, [dataStore.habits, logs]);

  // Animate new days as they stream in (progressive rendering)
  useEffect(() => {
    dataStore.habitLogsByDay.forEach((_, dateKey) => {
      if (!dayAnimations.current.has(dateKey)) {
        const anim = new Animated.Value(0);
        dayAnimations.current.set(dateKey, anim);
        // Light fade animation (<150ms as requested)
        Animated.timing(anim, {
          toValue: 1,
          duration: 120,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [dataStore.habitLogsByDay]);

  // Real habits from store (for editing, not the derived placeholders)
  const realHabits = dataStore.habits;
  
  // Local setters for optimistic updates
  const setHabits = (newHabits: Habit[]) => dataStore.updateHabits(newHabits);
  const setLogs = (newLogs: HabitLog[]) => {
    // For optimistic updates, update each log individually
    newLogs.forEach((log) => dataStore.updateHabitLog(log));
  };

  // Refresh data for current month when month changes
  const loadData = useCallback(async () => {
    if (!session) return;

    // DataStore already handles initial load
    // Only refresh if switching to a different month that's not cached
    const monthLogs = dataStore.getLogsForMonth(currentYear, currentMonth);
    if (monthLogs.length === 0) {
      await dataStore.refreshHabitLogs(currentYear, currentMonth);
    }

    // Get count of entries for today (background)
    const today = new Date().toISOString().split("T")[0];
    void getEntriesForDate(today).then((todayEntries) => {
      setTodayEntryCount(todayEntries.length);
    });
  }, [currentMonth, currentYear, session, dataStore]);

  // Reload data when screen comes into focus or month changes
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const changeMonth = (direction: number) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const today = new Date();
  const isCurrentMonthView =
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getFullYear() === today.getFullYear();
  const jumpToToday = () => {
    if (isCurrentMonthView) return;
    setCurrentDate(new Date());
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        dataStore.refreshHabits({ force: true }),
        dataStore.refreshHabitLogs(currentYear, currentMonth, { force: true }),
        dataStore.refreshEntries(currentYear, currentMonth, { force: true }),
      ]);
      const todayStr = new Date().toISOString().split("T")[0];
      const todayEntries = await getEntriesForDate(todayStr);
      setTodayEntryCount(todayEntries.length);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleHabit = async (habitId: string, date: string) => {
    const existing = logs.find(
      (log) => log.habitId === habitId && log.date === date,
    );
    const currentCompleted = existing?.completed ?? false;
    const newCompleted = !currentCompleted;

    // Optimistic update via DataStore
    dataStore.updateHabitLog({
      habitId,
      date,
      completed: newCompleted,
    });

    // Fire-and-correct network call
    try {
      await toggleHabitLog(habitId, date, currentCompleted);
    } catch (error) {
      console.error("[TrackerScreen] Failed to toggle habit log:", error);
      // On failure, revert and resync from server
      dataStore.updateHabitLog({
        habitId,
        date,
        completed: currentCompleted,
      });
      await dataStore.refreshHabitLogs(currentYear, currentMonth);
    }
  };

  const handleSaveEntry = async (text: string, localUris: string[]) => {
    if (!session) return;
    const userId = session.user.id;
    const today = new Date().toISOString().split("T")[0];
    const entryId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setSavingEntry(true);

    // Upload any picked images first — collect resulting object paths
    const mediaPaths: string[] = [];
    if (localUris.length > 0) {
      try {
        for (const uri of localUris) {
          const path = await uploadImage(uri, entryId, userId);
          mediaPaths.push(path);
        }
      } catch (err) {
        console.error("[TrackerScreen] Image upload failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        Alert.alert(
          "Upload failed",
          msg + ". Your highlight wasn't saved — please try again.",
        );
        setSavingEntry(false);
        return;
      }
    }

    const newEntry: DailyEntry = {
      id: entryId,
      date: today,
      text,
      mediaPaths,
      createdAt: new Date().toISOString(),
    };

    // Optimistic UI update — push into both the disk cache (for restore)
    // and the React data store (so the Feed tab re-renders immediately).
    setTodayEntryCount((count) => count + 1);
    upsertEntryInCache(newEntry, userId);
    dataStore.updateEntry(newEntry);

    try {
      await saveEntry(newEntry);
      showSnackbar("Highlight saved");
    } catch (error) {
      console.error("[TrackerScreen] Failed to save entry:", error);
      Alert.alert("Save failed", "Could not save entry. Please try again.");
      const updatedEntries = await getEntriesForDate(today);
      setTodayEntryCount(updatedEntries.length);
    } finally {
      setSavingEntry(false);
    }
  };

  const showSnackbar = (message: string) => {
    if (snackbarTimer.current) {
      clearTimeout(snackbarTimer.current);
    }
    setSnackbar({ visible: true, message });
    Animated.spring(snackbarAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 120,
    }).start();
    snackbarTimer.current = setTimeout(() => {
      hideSnackbar();
    }, 2400);
  };

  const hideSnackbar = () => {
    // Exit faster than enter so dismissal feels responsive
    Animated.timing(snackbarAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setSnackbar({ visible: false, message: "" });
    });
  };

  useEffect(() => {
    return () => {
      if (snackbarTimer.current) {
        clearTimeout(snackbarTimer.current);
      }
    };
  }, []);

  // Habit management handlers
  const handleOpenHabitModal = (habit?: Habit) => {
    if (habit) {
      setEditingHabit(habit);
      setHabitName(habit.name);
    } else {
      setEditingHabit(null);
      setHabitName("");
    }
    setShowHabitModal(true);
  };

  const handleSaveHabit = async () => {
    const name = habitName.trim();
    if (!name) {
      Alert.alert("Required", "Please enter a habit name.");
      return;
    }
    if (name.length > 20) {
      Alert.alert("Too long", "Habit name must be 20 characters or less.");
      return;
    }

    let updatedHabits: Habit[];
    if (editingHabit) {
      // Update existing habit - use realHabits, not placeholder habits
      updatedHabits = realHabits.map((h) =>
        h.id === editingHabit.id ? { ...h, name } : h,
      );
    } else {
      // Add new habit - use realHabits, not placeholder habits
      const id =
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const newHabit: Habit = {
        id,
        name,
        createdAt: new Date().toISOString(),
      };
      updatedHabits = [...realHabits, newHabit];
    }

    // Optimistic UI update via DataStore
    dataStore.updateHabits(updatedHabits);
    setShowHabitModal(false);
    setHabitName("");
    setEditingHabit(null);

    try {
      // Save to Supabase
      await saveHabits(updatedHabits);

      // Refresh logs in background (habits may affect grid rendering)
      await dataStore.refreshHabitLogs(currentYear, currentMonth);
    } catch (error) {
      console.error("[TrackerScreen] Failed to save habits:", error);
      Alert.alert("Save failed", "Could not save habits. Please try again.");

      // Re-sync state from server on failure
      await dataStore.refreshHabits();
    }
  };

  // Persist a drag-to-reorder result. saveHabits stores the list in array
  // order, so the reordered array IS the new persisted order — same
  // optimistic-then-persist pattern as create/edit/delete above.
  const handleReorderHabits = async (newOrder: Habit[]) => {
    // Optimistic UI update via DataStore
    dataStore.updateHabits(newOrder);

    try {
      await saveHabits(newOrder);
    } catch (error) {
      console.error("[TrackerScreen] Failed to reorder habits:", error);
      Alert.alert("Save failed", "Could not reorder habits. Please try again.");
      // Re-sync state from server on failure
      await dataStore.refreshHabits();
    }
  };

  // Open the reusable confirm dialog for the chosen habit.
  const handleDeleteHabit = (habit: Habit) => {
    setHabitToDelete(habit);
  };

  // Runs the existing delete logic, driven by ConfirmDialog's confirm + loading.
  const handleConfirmDeleteHabit = async () => {
    const habit = habitToDelete;
    if (!habit) return;
    setDeleting(true);

    const updatedHabits = realHabits.filter((h) => h.id !== habit.id);

    // Optimistic update via DataStore
    dataStore.updateHabits(updatedHabits);
    setShowHabitModal(false);

    try {
      await saveHabits(updatedHabits);
      await dataStore.refreshHabitLogs(currentYear, currentMonth);
      setHabitToDelete(null);
    } catch (error) {
      console.error("[TrackerScreen] Failed to delete habit:", error);
      Alert.alert(
        "Delete failed",
        "Could not delete habit. Please try again.",
      );
      await dataStore.refreshHabits();
      setHabitToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleHeaderLayout = (y: number) => {
    // y is relative to HabitGrid container, we need absolute position
    // Use measureLayout to get position relative to ScrollView
    if (habitGridHeaderRef.current && scrollViewRef.current) {
      habitGridHeaderRef.current.measureLayout(
        scrollViewRef.current as any,
        (x, measuredY) => {
          setHeaderStickyY(measuredY);
        },
        () => {
          // Fallback: use y value (approximate)
          setHeaderStickyY(y + 200); // Approximate offset
        },
      );
    } else {
      setHeaderStickyY(y + 200); // Approximate offset
    }
  };

  const handleHorizontalScroll = (offsetX: number) => {
    if (stickyHeaderScrollRef.current) {
      stickyHeaderScrollRef.current.scrollTo({ x: offsetX, animated: false });
    }
  };

  const cellWidth = 62;
  const totalHabitsWidth = habits.length * cellWidth;

  return (
    <PaperBackground>
      <View style={styles.wrapper}>
        <Animated.ScrollView
          ref={scrollViewRef}
          style={styles.container}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false },
          )}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.ink}
            />
          }
        >
          <View
            style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}
          >
            <IconButton onPress={() => changeMonth(-1)}>
              <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
            </IconButton>
            <TouchableOpacity
              onPress={jumpToToday}
              activeOpacity={0.7}
              style={styles.monthTextWrapper}
            >
              <Text style={styles.monthText}>{monthName}</Text>
              {!isCurrentMonthView && (
                <View style={styles.todayPill}>
                  <Text style={styles.todayPillText}>Today</Text>
                </View>
              )}
            </TouchableOpacity>
            <IconButton onPress={() => changeMonth(1)}>
              <IconSymbol name="chevron.right" size={22} color={Colors.ink} />
            </IconButton>
          </View>

          <HighlightInput
            todayEntryCount={todayEntryCount}
            onSave={handleSaveEntry}
            saving={savingEntry}
          />

          <HabitGrid
            habits={habits}
            logs={logs}
            currentMonth={currentMonth}
            currentYear={currentYear}
            onToggle={handleToggleHabit}
            onEdit={() => handleOpenHabitModal()}
            onReorder={handleReorderHabits}
            onHeaderLayout={handleHeaderLayout}
            headerRef={habitGridHeaderRef}
            onHorizontalScroll={handleHorizontalScroll}
            stickyHeaderScrollRef={stickyHeaderScrollRef}
          />
        </Animated.ScrollView>

        {/* Sticky header - shows when scrolled past original header */}
        {headerStickyY > 0 && (
          <Animated.View
            style={[
              styles.stickyHeader,
              {
                paddingTop: insets.top,
                opacity: scrollY.interpolate({
                  inputRange: [headerStickyY - 1, headerStickyY],
                  outputRange: [0, 1],
                  extrapolate: "clamp",
                }),
              },
            ]}
          >
            <View style={styles.stickyHeaderContent}>
              <View style={styles.stickyDayHeader}>
                <View style={styles.stickyDayCell}>
                  <Text style={styles.stickyDayText}>DAY</Text>
                </View>
              </View>
              <ScrollView
                ref={stickyHeaderScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stickyHabitsScroll}
                contentContainerStyle={{ width: totalHabitsWidth }}
              >
                <View style={styles.stickyHeaderRow}>
                  {habits.map((habit) => (
                    <View key={habit.id} style={styles.stickyHabitCell}>
                      <Text
                        style={styles.stickyHabitName}
                        numberOfLines={2}
                        adjustsFontSizeToFit
                        minimumFontScale={0.7}
                      >
                        {habit.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          </Animated.View>
        )}

        {/* Habit Management Modal */}
        <Modal
          visible={showHabitModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowHabitModal(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowHabitModal(false)}>
                <Text style={styles.modalCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingHabit ? "Edit Habit" : "Manage Habits"}
              </Text>
              <TouchableOpacity onPress={() => handleOpenHabitModal()}>
                <IconSymbol name="plus" size={24} color={Colors.accent} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* Current habits list - use realHabits, not placeholder habits */}
              {realHabits.length > 0 && !editingHabit && (
                <View style={styles.habitsList}>
                  <Text style={styles.habitsListTitle}>Your Habits</Text>
                  {realHabits.map((habit) => (
                    <TouchableOpacity
                      key={habit.id}
                      style={styles.habitItem}
                      onPress={() => handleOpenHabitModal(habit)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.habitItemName}>{habit.name}</Text>
                      <IconSymbol
                        name="chevron.right"
                        size={16}
                        color={Colors.textSecondary}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Add/Edit form */}
              {(editingHabit || realHabits.length === 0 || habitName !== "") && (
                <View style={styles.habitForm}>
                  <Text style={styles.formLabel}>
                    {editingHabit ? "Habit Name" : "Add New Habit"}
                  </Text>
                  <TextInput
                    style={styles.habitInput}
                    value={habitName}
                    onChangeText={setHabitName}
                    placeholder="e.g. Exercise, Read, Meditate"
                    placeholderTextColor={Colors.textSecondary}
                    maxLength={20}
                    autoFocus={editingHabit !== null || realHabits.length === 0}
                  />
                  <Text style={styles.charCount}>{habitName.length}/20</Text>

                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveHabit}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.saveButtonText}>
                      {editingHabit ? "Save Changes" : "Add Habit"}
                    </Text>
                  </TouchableOpacity>

                  {editingHabit && (
                    <TouchableOpacity
                      style={styles.deleteButton}
                      onPress={() => handleDeleteHabit(editingHabit)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.deleteButtonText}>Delete Habit</Text>
                    </TouchableOpacity>
                  )}

                  {editingHabit && (
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => {
                        setEditingHabit(null);
                        setHabitName("");
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.backButtonText}>Back to list</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {realHabits.length === 0 && habitName === "" && (
                <View style={styles.emptyHabits}>
                  <Text style={styles.emptyText}>No habits yet</Text>
                  <Text style={styles.emptyHint}>
                    Add your first habit to start tracking
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </Modal>

        {snackbar.visible && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.snackbar,
              {
                opacity: snackbarAnim,
                transform: [
                  {
                    translateY: snackbarAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                  },
                ],
                bottom: Math.max(insets.bottom, 16) + 12,
              },
            ]}
          >
            <IconSymbol
              name="checkmark.circle.fill"
              size={18}
              color={Colors.paper}
            />
            <Text style={styles.snackbarText}>{snackbar.message}</Text>
          </Animated.View>
        )}

        <ConfirmDialog
          visible={habitToDelete !== null}
          title="Delete habit?"
          message={
            habitToDelete
              ? `"${habitToDelete.name}" and all of its logs will be removed. This can't be undone.`
              : undefined
          }
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleConfirmDeleteHabit}
          onCancel={() => setHabitToDelete(null)}
        />
      </View>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  monthTextWrapper: {
    alignItems: "center",
    paddingHorizontal: 4,
  },
  monthText: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  todayPill: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: `${Colors.accent}33`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accent,
  },
  todayPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
  },
  stickyHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: Colors.paper,
  },
  stickyHeaderContent: {
    flexDirection: "row",
    marginHorizontal: 16,
  },
  stickyDayHeader: {
    width: 62,
  },
  stickyDayCell: {
    width: 60,
    height: 60,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: "transparent",
  },
  stickyDayText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.5,
  },
  stickyHabitsScroll: {
    flex: 1,
    height: 60,
  },
  stickyHeaderRow: {
    flexDirection: "row",
  },
  stickyHabitCell: {
    width: 60,
    height: 60,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: "transparent",
  },
  stickyHabitName: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    fontWeight: "700",
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.shadow,
  },
  modalCancel: {
    fontSize: 16,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  habitsList: {
    marginBottom: 24,
  },
  habitsListTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  habitItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.shadow,
    marginBottom: 8,
  },
  habitItemName: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "500",
  },
  habitForm: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  habitInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
  },
  charCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "right",
    marginTop: 4,
    marginBottom: 16,
  },
  saveButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  deleteButton: {
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
  },
  backButton: {
    alignItems: "center",
    marginTop: 16,
  },
  backButtonText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
  emptyHabits: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  snackbar: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: Colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  snackbarText: {
    color: Colors.paper,
    fontSize: 14,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
});
