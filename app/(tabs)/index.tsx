import {
    ADAPTIVE_MAX_HABITS,
    CELL_GAP,
    computeColumnWidth,
    HabitGrid,
} from "@/components/habit-grid";
import { HighlightInput } from "@/components/highlight-input";
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
import { isFutureDay, monthKeyOfParts, todayKey } from "@/lib/dates";
import { uploadImage } from "@/lib/media";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Animated,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
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
  const monthKey = monthKeyOfParts(currentYear, currentMonth);

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
    const today = todayKey();
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
      const todayStr = todayKey();
      const todayEntries = await getEntriesForDate(todayStr);
      setTodayEntryCount(todayEntries.length);
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggleHabit = async (habitId: string, date: string) => {
    // You can't tick a day you haven't lived yet (D14). The grid also renders
    // future cells disabled — this is the belt to that braces. Past days stay
    // editable on purpose: back-filling is a core journal use.
    if (isFutureDay(date)) return;

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
    const today = todayKey();
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

  // The sticky header mirrors the grid's columns, so it repeats the grid's
  // width math on its own measured width (same 16pt margins + 62pt DAY column,
  // so the two always agree). 1-3 habits fill the row and don't scroll.
  const [stickyGridWidth, setStickyGridWidth] = useState(0);
  const stickyColumnWidth = computeColumnWidth(stickyGridWidth, habits.length);
  const totalHabitsWidth = habits.length * stickyColumnWidth;
  const stickyScrollable = habits.length > ADAPTIVE_MAX_HABITS;

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
            {/* The a11y label lives on a grouping View because IconButton /
                PressableScale don't forward accessibility props yet. */}
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <IconButton onPress={() => changeMonth(-1)}>
                <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
              </IconButton>
            </View>
            <TouchableOpacity
              onPress={jumpToToday}
              activeOpacity={0.7}
              style={styles.monthTextWrapper}
              accessibilityRole="button"
              accessibilityLabel={
                isCurrentMonthView ? monthName : `${monthName}, jump to today`
              }
              accessibilityState={{ disabled: isCurrentMonthView }}
            >
              <Text style={styles.monthText}>{monthName}</Text>
              {!isCurrentMonthView && (
                <View style={styles.todayPill}>
                  <Text style={styles.todayPillText}>Today</Text>
                </View>
              )}
            </TouchableOpacity>
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <IconButton onPress={() => changeMonth(1)}>
                <IconSymbol name="chevron.right" size={22} color={Colors.ink} />
              </IconButton>
            </View>
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
            onEdit={() => router.push("/habits")}
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
                scrollEnabled={stickyScrollable}
                onLayout={(event) =>
                  setStickyGridWidth(event.nativeEvent.layout.width)
                }
                style={styles.stickyHabitsScroll}
                contentContainerStyle={{ width: totalHabitsWidth }}
              >
                <View style={styles.stickyHeaderRow}>
                  {habits.map((habit) => (
                    <View
                      key={habit.id}
                      style={[
                        styles.stickyHabitCell,
                        { width: stickyColumnWidth - CELL_GAP },
                      ]}
                      accessibilityLabel={habit.name}
                    >
                      <Text
                        style={styles.stickyHabitName}
                        numberOfLines={2}
                        ellipsizeMode="tail"
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
