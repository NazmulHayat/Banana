import {
    ADAPTIVE_MAX_HABITS,
    CELL_GAP,
    computeColumnWidth,
    HabitGrid,
    HEADER_ROW_HEIGHT,
    ROW_PITCH,
} from "@/components/habit-grid";
import { HighlightInput } from "@/components/highlight-input";
import { SyncStatus } from "@/components/sync-status";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import type { DailyEntry, Habit, HabitLog, WriteOutcome } from "@/lib/db";
import {
    fromDayKey,
    isFutureDay,
    monthKeyOfParts,
    parseDayKey,
    todayKey,
} from "@/lib/dates";
import { useReduceMotion } from "@/lib/use-reduce-motion";
// Photo upload has no store action yet, so this is the one data call the screen
// still makes directly. It's a single atomic primitive (upload-all-or-nothing)
// rather than the old inline loop. Lead: ideal end-state is the store owning it,
// e.g. `saveEntry(entry, localUris)`.
import { discardEntryImages, uploadEntryImages } from "@/lib/media";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Animated,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ---------------------------------------------------------------------------
// D15: this screen used to import `saveEntry` / `saveHabits` / `toggleHabitLog`
// / `upsertEntryInCache` / `the store's month cache` straight from `@/lib/db` and run
// them side-by-side with the store, so the two disagreed after any failure.
// Everything now goes Screen → data-store → lib/db, like `feed.tsx` already did.
//
// The store's write actions never throw: they resolve to a `WriteOutcome`.
// `queued` is durable (it replays on reconnect), so only `failed` rolls the
// optimistic UI back or keeps the composer's text.
// ---------------------------------------------------------------------------

/**
 * Day rows left visible above today when the grid auto-scrolls to it — enough
 * of the last few days for context, not so much that today sits off-screen.
 */
const ROWS_OF_CONTEXT_ABOVE = 2;

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();
  const [currentDate, setCurrentDate] = useState(new Date());
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
  // Latched when a write comes back `failed` — drives the sync line's retry.
  const [writeFailed, setWriteFailed] = useState(false);
  // Latched when a READ throws — drives the grid's error card (T2).
  const [loadFailed, setLoadFailed] = useState(false);
  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  // Async loads resolve after a tab switch — never set state into a dead screen.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthKey = monthKeyOfParts(currentYear, currentMonth);

  // Today's highlight count, derived from the store instead of a direct
  // `the store's month cache` call (D15). "Today" is always in the real current
  // month, which is not necessarily the month being browsed.
  const todayDayKey = todayKey();
  const todayParts = parseDayKey(todayDayKey);
  // "Aug 18" — shown by the composer when the grid is browsing another month,
  // so a highlight never lands on a day the user didn't expect.
  const todayLabel = fromDayKey(todayDayKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const todayEntryCount = todayParts
    ? dataStore
        .getEntriesForMonth(todayParts.year, todayParts.month)
        .filter((entry) => entry.date === todayDayKey).length
    : 0;

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

  // T2: the grid used to render its "Start tracking" empty state the instant
  // it had no habits — including the frame before a returning user's habits
  // arrived. Habits are only genuinely absent once the store says `ready`;
  // until then this is a loading screen, not an empty one.
  const habitsPending = !dataStore.habitsReady && habits.length === 0;

  // Animate new days as they stream in (progressive rendering)
  useEffect(() => {
    dataStore.habitLogsByDay.forEach((_, dateKey) => {
      if (!dayAnimations.current.has(dateKey)) {
        const anim = new Animated.Value(0);
        dayAnimations.current.set(dateKey, anim);
        // Light fade animation (<150ms as requested)
        Animated.timing(anim, {
          toValue: 1,
          duration: Motion.quick,
          useNativeDriver: true,
        }).start();
      }
    });
  }, [dataStore.habitLogsByDay]);

  // ---------------------------------------------------------------------
  // T3: this used to depend on the whole `dataStore` object. Every refresh
  // re-created the store value → new `loadData` → the focus effect fired
  // again → refresh → … a fetch loop that ran for as long as the Tracker was
  // focused. Depend on the individual store callbacks instead: they're
  // `useCallback([session])` inside the store, so they're stable across state
  // changes. Nothing here reads `getLogsForMonth` either — the store's own
  // in-memory tier already short-circuits a cached month, so calling refresh
  // unconditionally is both cheaper and loop-free.
  // ---------------------------------------------------------------------
  const { refreshHabitLogs, refreshEntries, refreshHabits } = dataStore;

  const loadData = useCallback(async () => {
    if (!session) return;
    // Today's highlight count is derived from store state, so it just needs
    // the month that contains today to be loaded.
    const parts = parseDayKey(todayKey());
    try {
      await Promise.all([
        refreshHabitLogs(currentYear, currentMonth),
        parts ? refreshEntries(parts.year, parts.month) : Promise.resolve(),
      ]);
      if (mountedRef.current) setLoadFailed(false);
    } catch {
      // Reads degrade to a calm retry card — never a raw error, never a crash.
      if (mountedRef.current) setLoadFailed(true);
    }
  }, [currentMonth, currentYear, session, refreshHabitLogs, refreshEntries]);

  // Reload data when screen comes into focus or month changes
  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData]),
  );

  // Retry from the grid's error card: force both halves of the screen.
  const handleRetryLoad = async () => {
    setLoadFailed(false);
    try {
      await Promise.all([
        refreshHabits({ force: true }),
        refreshHabitLogs(currentYear, currentMonth, { force: true }),
      ]);
    } catch {
      if (mountedRef.current) setLoadFailed(true);
    }
  };

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

  // ---------------------------------------------------------------------
  // T4: today's row sits up to ~1,700pt down a 31-row grid, and nothing ever
  // scrolled to it — on the 28th you had to hunt past the composer for the
  // row you came to tap. Once the grid has been measured, put today's row on
  // screen with a couple of rows of context above it. Once per arrival at the
  // current month (a ref guards it), so it never fights a user who scrolls.
  // ---------------------------------------------------------------------
  const reduceMotion = useReduceMotion();
  const autoScrolledMonthRef = useRef<string | null>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isCurrentMonthView) {
      // Left the current month — re-arm, so coming back scrolls again.
      autoScrolledMonthRef.current = null;
      return;
    }
    if (autoScrolledMonthRef.current === monthKey) return;
    // headerStickyY is the measured top of the grid's header row; 0 means the
    // grid hasn't laid out yet, so there is nothing to scroll to.
    if (headerStickyY <= 0 || habits.length === 0) return;

    const dayOfMonth = todayParts?.day ?? 1;
    const y =
      headerStickyY +
      HEADER_ROW_HEIGHT +
      (dayOfMonth - 1) * ROW_PITCH -
      ROWS_OF_CONTEXT_ABOVE * ROW_PITCH;
    autoScrolledMonthRef.current = monthKey;
    if (y <= 0) return; // early in the month today is already on screen

    // One frame of slack: the rows below the header may still be laying out
    // when its measurement lands.
    const scheduled = setTimeout(() => {
      autoScrollTimer.current = null;
      scrollViewRef.current?.scrollTo({ y, animated: !reduceMotion });
    }, Motion.fast);
    autoScrollTimer.current = scheduled;

    return () => {
      // Cancelled before it ran (a dep changed) — re-arm, or today's row would
      // silently never be scrolled to.
      if (autoScrollTimer.current === scheduled) {
        clearTimeout(scheduled);
        autoScrollTimer.current = null;
        autoScrolledMonthRef.current = null;
      }
    };
  }, [
    isCurrentMonthView,
    monthKey,
    headerStickyY,
    habits.length,
    todayParts?.day,
    reduceMotion,
  ]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const parts = parseDayKey(todayKey());
      await Promise.all([
        dataStore.refreshHabits({ force: true }),
        dataStore.refreshHabitLogs(currentYear, currentMonth, { force: true }),
        dataStore.refreshEntries(currentYear, currentMonth, { force: true }),
        // Browsing a past month must still refresh today's highlight count.
        parts && parts.month !== currentMonth
          ? dataStore.refreshEntries(parts.year, parts.month, { force: true })
          : Promise.resolve(),
      ]);
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

    // Persist through the store (D15).
    const outcome = await dataStore.toggleHabitLog(
      habitId,
      date,
      currentCompleted,
    );

    // `queued` is durable — it replays on reconnect, so the optimistic tick
    // stays. Only a hard failure rolls the UI back.
    if (outcome.status === "failed") {
      dataStore.updateHabitLog({
        habitId,
        date,
        completed: currentCompleted,
      });
      setWriteFailed(true);
      await dataStore.refreshHabitLogs(currentYear, currentMonth);
    }
  };

  const handleSaveEntry = async (
    text: string,
    localUris: string[],
  ): Promise<WriteOutcome> => {
    if (!session) {
      return { status: "failed", reason: "You're signed out. Sign in to save." };
    }
    const userId = session.user.id;
    const entryId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setSavingEntry(true);
    setWriteFailed(false);
    try {
      // Photos first, all-or-nothing (D8). uploadEntryImages rolls back every
      // object it already stored if a later one fails, so a half-finished
      // upload can no longer orphan images in the bucket.
      const upload = await uploadEntryImages(localUris, entryId, userId);
      if (upload.status === "failed") {
        setWriteFailed(true);
        return { status: "failed", reason: upload.reason };
      }

      const newEntry: DailyEntry = {
        id: entryId,
        // Read fresh, not from render scope — the app can be left open past
        // midnight and the entry must land on the day it was written.
        date: todayKey(),
        text,
        mediaPaths: upload.paths,
        createdAt: new Date().toISOString(),
      };

      // The store does the optimistic update AND the persist, so the cache and
      // React state can't drift apart the way they did when this screen wrote
      // to both by hand.
      const outcome = await dataStore.saveEntry(newEntry);

      if (outcome.status === "failed") {
        // The entry never landed, so its photos have nothing pointing at them.
        // (A `queued` write still replays, so those photos must stay.)
        await discardEntryImages(upload.paths);
        setWriteFailed(true);
        return outcome;
      }

      showSnackbar(
        outcome.status === "queued"
          ? "Saved — will sync when you're back online"
          : "Highlight saved",
      );
      return outcome;
    } finally {
      setSavingEntry(false);
    }
  };

  // "Tap to retry" on the sync line: replay the durable queue now.
  const handleRetrySync = async () => {
    setWriteFailed(false);
    await dataStore.flushPendingWrites();
  };

  const showSnackbar = (message: string) => {
    if (snackbarTimer.current) {
      clearTimeout(snackbarTimer.current);
    }
    setSnackbar({ visible: true, message });
    Animated.spring(snackbarAnim, {
      toValue: 1,
      useNativeDriver: true,
      ...Motion.spring,
    }).start();
    snackbarTimer.current = setTimeout(() => {
      hideSnackbar();
    }, Motion.snackbar);
  };

  const hideSnackbar = () => {
    // Exit faster than enter so dismissal feels responsive
    Animated.timing(snackbarAnim, {
      toValue: 0,
      duration: Motion.quick,
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
    const previousOrder = dataStore.habits;
    // Optimistic UI update via DataStore
    dataStore.updateHabits(newOrder);

    const outcome = await dataStore.saveHabits(newOrder);

    if (outcome.status === "failed") {
      // Put the old order back rather than leaving a reorder that never landed.
      dataStore.updateHabits(previousOrder);
      setWriteFailed(true);
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
            <IconButton
              onPress={() => changeMonth(-1)}
              accessibilityLabel="Previous month"
            >
              <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
            </IconButton>
            <TouchableOpacity
              onPress={jumpToToday}
              activeOpacity={0.7}
              style={styles.monthTextWrapper}
              // Vertical only — the chevrons sit right beside it.
              hitSlop={{ top: 10, bottom: 10 }}
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
            <IconButton
              onPress={() => changeMonth(1)}
              accessibilityLabel="Next month"
            >
              <IconSymbol name="chevron.right" size={22} color={Colors.ink} />
            </IconButton>
          </View>

          {/* One quiet line above the composer, right-aligned. Fixed height,
              so switching states never nudges the card below it. */}
          <SyncStatus
            pendingCount={dataStore.pendingWriteCount}
            syncing={savingEntry}
            failed={writeFailed}
            onRetry={() => void handleRetrySync()}
          />

          <HighlightInput
            todayEntryCount={todayEntryCount}
            todayLabel={todayLabel}
            browsingOtherMonth={!isCurrentMonthView}
            onSave={handleSaveEntry}
            saving={savingEntry}
          />

          <HabitGrid
            habits={habits}
            logs={logs}
            currentMonth={currentMonth}
            currentYear={currentYear}
            loading={habitsPending}
            error={loadFailed}
            onRetry={() => void handleRetryLoad()}
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
