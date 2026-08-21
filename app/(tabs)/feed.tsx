import { EntryPhotoEditor } from "@/components/entry-photo-editor";
import { FeedEntryCard } from "@/components/feed-entry-card";
import { MAX_IMAGES } from "@/components/highlight-input";
import { PlaceEditor } from "@/components/place-editor";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import { fromDayKey } from "@/lib/dates";
import type { DailyEntry, EntryPlace, SavedPlace } from "@/lib/db";
import { matchSavedPlace, resolvePlace } from "@/lib/location";
import {
  deleteImages,
  discardEntryImages,
  uploadEntryImages,
} from "@/lib/media";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SCREEN_WIDTH = Dimensions.get("window").width;

/**
 * Cards rendered before the user scrolls. Enough to fill a tall screen; the
 * rest arrive as they're reached, so opening a month never fires a photo
 * request for an entry twenty rows down that may never be looked at.
 */
const INITIAL_CARDS = 5;
/** How many more to reveal each time the user nears the end. */
const CARDS_PER_REVEAL = 5;
/** How close to the bottom counts as "nearly there", in points. */
const REVEAL_THRESHOLD = 700;

/** Sideways travel before the month swipe takes over from the scroll view. */
const SWIPE_ACTIVATE_X = 24;
/** Vertical drift that hands the gesture back — scrolling always wins. */
const SWIPE_CANCEL_Y = 12;
/** Distance that commits to a month change on release. */
const SWIPE_COMMIT_X = 60;
/** …or this much speed, so a quick flick counts too (pt/s). */
const SWIPE_COMMIT_VELOCITY = 500;
/** Fraction of the drag the page keeps when there's no next month to reach. */
const FUTURE_RESISTANCE = 0.25;
/**
 * How far the page dims as it travels. Barely: a slide already communicates
 * the move, and a heavy fade on top of it is two effects doing one job.
 */
const SWIPE_FADE_FLOOR = 0.75;

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();
  // Pulled out so effects can depend on stable callbacks rather than the
  // store object, whose identity changes on every write.
  const { refreshEntries, getEntriesForMonth } = dataStore;
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  // +1 = moved to next month (content enters from the right), -1 = previous
  const [monthDirection, setMonthDirection] = useState(1);
  // The month couldn't be read from the server. Kept separate from "empty" —
  // a failed refresh used to be indistinguishable from a month with no entries.
  const [loadFailed, setLoadFailed] = useState(false);

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
    const monthEntries = getEntriesForMonth(currentYear, currentMonth);
    return [...monthEntries].sort((a, b) => {
      if (a.date !== b.date) {
        return fromDayKey(b.date).getTime() - fromDayKey(a.date).getTime();
      }
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    // `dataStore.entries` (not the store object) so this recomputes when the
    // month's data changes but not on every unrelated store write. eslint
    // can't see it: `getEntriesForMonth` reads that map internally, so the
    // dependency is real even though it isn't referenced by name here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataStore.entries, getEntriesForMonth, currentYear, currentMonth]);

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

  // Only show loading if no entries are ready AND still loading. A failed read
  // leaves `entriesReady` false forever, so it must break the skeleton too.
  const loading =
    !dataStore.entriesReady && entries.length === 0 && !loadFailed;

  // Load entries for current month if not already cached
  const loadEntries = useCallback(async () => {
    if (!session) return;

    // Only fetch if we don't have entries for this month
    const monthEntries = getEntriesForMonth(currentYear, currentMonth);
    if (monthEntries.length === 0) {
      try {
        await refreshEntries(currentYear, currentMonth);
        setLoadFailed(false);
      } catch {
        // Never a raw error string on screen — the panel below says it calmly.
        setLoadFailed(true);
      }
    } else {
      // Guarded: an unconditional setState here re-renders every pass.
      setLoadFailed((prev) => (prev ? false : prev));
    }

    // Prefetch adjacent months in background
    const shiftMonth = (year: number, month: number, delta: number) => {
      const date = new Date(year, month - 1 + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() + 1 };
    };

    const prev = shiftMonth(currentYear, currentMonth, -1);
    const next = shiftMonth(currentYear, currentMonth, 1);
    // Prefetches are best-effort: a failure here is not the user's problem.
    void refreshEntries(prev.year, prev.month).catch(() => {});
    void refreshEntries(next.year, next.month).catch(() => {});
    // Depend on the individual store callbacks, never the store object:
    // its identity changes on every state write, which re-arms the focus
    // effect and loops until React throws "Maximum update depth exceeded".
  }, [currentMonth, currentYear, session, refreshEntries, getEntriesForMonth]);

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
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setRefreshing(false);
    }
  };

  const retryLoad = async () => {
    void Haptics.selectionAsync();
    setLoadFailed(false);
    try {
      await dataStore.refreshEntries(currentYear, currentMonth, {
        force: true,
      });
    } catch {
      setLoadFailed(true);
    }
  };

  // --- Month navigation -----------------------------------------------------
  // The feed can only look backwards: there are no entries in the future, and
  // paging into it forever is just a way to get lost.
  const today = new Date();
  const isCurrentMonthView =
    currentDate.getMonth() === today.getMonth() &&
    currentDate.getFullYear() === today.getFullYear();
  // The return button names where it lands. A pill reading "Today" sits
  // directly under the month title and parses as a label on it — "July is
  // today" — which is exactly wrong when you're browsing the past.
  const todayMonthName = today.toLocaleDateString("en-US", { month: "long" });

  // Lazy rendering: how many of this month's cards may exist yet.
  const [revealed, setRevealed] = useState(INITIAL_CARDS);

  // A new month starts at the top, so it starts from the first few cards.
  useEffect(() => {
    setRevealed(INITIAL_CARDS);
  }, [currentYear, currentMonth]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const toEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (toEnd > REVEAL_THRESHOLD) return;
    setRevealed((current) =>
      current >= entries.length ? current : current + CARDS_PER_REVEAL,
    );
  };

  // Which entry's place tag is open for editing, if any.
  const [editingPlace, setEditingPlace] = useState<DailyEntry | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);

  // Place names are resolved per card at render time, so the feed needs them
  // in hand — renaming a place then re-labels every entry there at once.
  const { loadPlaces } = dataStore;
  useEffect(() => {
    void loadPlaces();
  }, [loadPlaces]);

  /**
   * Save a corrected place. Two writes, deliberately separate: the entry keeps
   * its own snapshot (history never rewrites itself), and "remember" teaches
   * the app a preferred name for that spot so future entries use it.
   */
  const savePlaceEdit = async (next: EntryPlace, remember: boolean) => {
    const target = editingPlace;
    if (!target) return;
    setSavingPlace(true);
    try {
      await dataStore.saveEntry({ ...target, place: next });

      if (remember) {
        const saved = await dataStore.loadPlaces();
        const existing = matchSavedPlace(next, saved);
        const entry: SavedPlace = {
          id:
            existing?.id ??
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          heading: next.heading,
          address: next.address,
          latitude: next.latitude,
          longitude: next.longitude,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        };
        // Renaming somewhere you've already named replaces it rather than
        // piling up two names for one spot.
        const merged = existing
          ? saved.map((p) => (p.id === existing.id ? entry : p))
          : [...saved, entry];
        await dataStore.savePlaces(merged);
      }
    } finally {
      // Close only once the write has landed — the sheet closing is the
      // confirmation, so it must not happen before the change is real.
      setSavingPlace(false);
      setEditingPlace(null);
    }
  };

  const changeMonth = (direction: number) => {
    if (direction > 0 && isCurrentMonthView) return;
    void Haptics.selectionAsync();
    setMonthDirection(direction);
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  // How far the month page is currently pushed sideways. The pan writes to it
  // live so the page tracks your finger; everything else animates it home.
  const dragX = useSharedValue(0);

  const monthPageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
    // Receding as it leaves reads as depth rather than a card sliding on glass.
    opacity: interpolate(
      Math.abs(dragX.value),
      [0, SCREEN_WIDTH * 0.7],
      [1, SWIPE_FADE_FLOOR],
      Extrapolation.CLAMP,
    ),
  }));

  // Swipe left for the next month, right for the previous — the same two moves
  // as the chevrons. The thresholds matter more than the handler: this sits on
  // top of a vertical ScrollView with pull-to-refresh, so the pan only takes
  // over once the drag is decisively sideways, and gives up if it drifts.
  const monthSwipe = Gesture.Pan()
    .activeOffsetX([-SWIPE_ACTIVATE_X, SWIPE_ACTIVATE_X])
    .failOffsetY([-SWIPE_CANCEL_Y, SWIPE_CANCEL_Y])
    .onUpdate((e) => {
      // Dragging forward from this month has nowhere to go, so let it stretch
      // a quarter of the way and pull back — elastic, not broken.
      const blocked = e.translationX < 0 && isCurrentMonthView;
      dragX.value = e.translationX * (blocked ? FUTURE_RESISTANCE : 1);
    })
    .onEnd((e) => {
      const forward = e.translationX < 0;
      const blocked = forward && isCurrentMonthView;
      // A quick flick counts as much as a long drag, so the month doesn't feel
      // stuck when you swipe fast.
      const committed =
        !blocked &&
        (Math.abs(e.translationX) > SWIPE_COMMIT_X ||
          Math.abs(e.velocityX) > SWIPE_COMMIT_VELOCITY);
      if (!committed) {
        // Not enough — settle back flat. Cancelling shouldn't feel like an event.
        dragX.value = withSpring(0, Motion.springPage);
        return;
      }
      // Carry the page the rest of the way out, then swap the month underneath
      // it. The effect below brings the new one in from the opposite edge.
      dragX.value = withTiming(
        forward ? -SCREEN_WIDTH : SCREEN_WIDTH,
        { duration: Motion.quick },
        (finished) => {
          if (finished) runOnJS(changeMonth)(forward ? 1 : -1);
        },
      );
    });

  // Whenever the month actually changes — swipe, chevron or Today — drop the
  // incoming page just off the edge it should arrive from and let it settle.
  // It lands and stops: a page that bounces on arrival reads as unstable.
  const isFirstRender = useRef(true);
  // Once you've travelled between months, the page transition is the motion —
  // see `travelled` at the card level below.
  const travelled = useRef(false);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    travelled.current = true;
    dragX.value = monthDirection > 0 ? SCREEN_WIDTH : -SCREEN_WIDTH;
    dragX.value = withSpring(0, Motion.springPage);
  }, [currentYear, currentMonth, monthDirection, dragX]);

  const jumpToToday = () => {
    if (isCurrentMonthView) return;
    void Haptics.selectionAsync();
    setMonthDirection(1);
    setCurrentDate(new Date());
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
  // Photo edits are STAGED. `editKeptPaths` is what survives, `editNewUris` is
  // what's been picked but not uploaded. Nothing touches storage until Save.
  const [editKeptPaths, setEditKeptPaths] = useState<string[]>([]);
  const [editNewUris, setEditNewUris] = useState<string[]>([]);

  const openEditor = (entry: DailyEntry) => {
    setEditingEntry(entry);
    setEditText(entry.text);
    setEditKeptPaths(entry.mediaPaths ?? []);
    setEditNewUris([]);
    setEditError(null);
  };

  const closeEditor = () => {
    if (editSaving) return;
    setEditingEntry(null);
    setEditText("");
    setEditKeptPaths([]);
    setEditNewUris([]);
    setEditError(null);
  };

  const pickEditPhotos = async () => {
    const remaining = MAX_IMAGES - (editKeptPaths.length + editNewUris.length);
    if (remaining <= 0) return;
    const allowsMultiple = remaining > 1 && Platform.OS === "ios";
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: allowsMultiple,
      selectionLimit: allowsMultiple ? remaining : 1,
      quality: 0.8,
    });
    if (!result || result.canceled) return;
    const picked = (result.assets ?? [])
      .map((a) => a.uri)
      .filter((uri): uri is string => Boolean(uri));
    // Clamp in code — Android ignores `selectionLimit`.
    setEditNewUris((prev) =>
      [...prev, ...picked].slice(0, MAX_IMAGES - editKeptPaths.length),
    );
  };

  const handleEditSave = async () => {
    if (!editingEntry || editSaving) return;
    const trimmed = editText.trim();
    const original = editingEntry.mediaPaths ?? [];
    const removedPaths = original.filter((p) => !editKeptPaths.includes(p));
    const textChanged = trimmed !== editingEntry.text;
    const photosChanged = removedPaths.length > 0 || editNewUris.length > 0;
    // Nothing changed — just close.
    if (!textChanged && !photosChanged) {
      closeEditor();
      return;
    }
    // An entry with neither text nor photos left is an empty row, not an edit.
    if (
      trimmed.length === 0 &&
      editKeptPaths.length + editNewUris.length === 0
    ) {
      setEditError("Add a few words or a photo — or delete the entry instead.");
      return;
    }

    setEditSaving(true);
    setEditError(null);

    // 1. Upload the new photos first. `uploadEntryImages` is all-or-nothing: a
    //    failure part-way rolls back everything it already stored.
    const upload = await uploadEntryImages(
      editNewUris,
      editingEntry.id,
      session?.user.id ?? "",
    );
    if (upload.status === "failed") {
      setEditSaving(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setEditError(upload.reason);
      return;
    }

    const updated: DailyEntry = {
      ...editingEntry,
      text: trimmed,
      mediaPaths: [...editKeptPaths, ...upload.paths],
      // Keep what we already knew about the surviving photos and add the new
      // ones, so an edit never throws away dimensions and forces a re-measure.
      media: [
        ...(editingEntry.media ?? []).filter((m) =>
          editKeptPaths.includes(m.path),
        ),
        ...upload.images,
      ],
    };

    // 2. Write the row. Never throws: `queued` is durable (it replays on
    //    reconnect) so it closes like `synced`; only `failed` keeps the editor
    //    open with the user's work intact.
    const outcome = await dataStore.saveEntry(updated);
    setEditSaving(false);

    if (outcome.status === "failed") {
      // The row still points at the old photos, so the ones just uploaded have
      // nothing referencing them — bin them rather than orphan the bucket.
      await discardEntryImages(upload.paths);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setEditError(outcome.reason);
      void dataStore
        .refreshEntries(currentYear, currentMonth, { force: true })
        .catch(() => {});
      return;
    }

    // 3. Only NOW delete what the user removed. Deleting before the write
    //    lands would destroy a photo the entry still points at if the save
    //    failed — for a journal, that is the unforgivable bug.
    if (removedPaths.length > 0) {
      void deleteImages(removedPaths).catch(() => {});
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditingEntry(null);
    setEditText("");
    setEditKeptPaths([]);
    setEditNewUris([]);
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
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setDeleteError(outcome.reason);
      void dataStore
        .refreshEntries(currentYear, currentMonth, { force: true })
        .catch(() => {});
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDeletingEntry(null);
  };

  return (
    <PaperBackground>
      {/* The app root doesn't mount a GestureHandlerRootView (see
          habit-grid.tsx), so the swipe needs to scope its own. */}
      <GestureHandlerRootView style={styles.gestureRoot}>
        <GestureDetector gesture={monthSwipe}>
          <ScrollView
            style={styles.container}
            onScroll={handleScroll}
            // Four times a second is plenty to top up a reveal window.
            scrollEventThrottle={250}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Colors.ink}
              />
            }
          >
            {/* No page title: the tab bar already says "Feed", and the Tracker
                has never had one. The month row takes the safe area instead. */}

            {/* Same month control as the Tracker, including its Today shortcut —
                eight taps to reach last spring is not navigation. */}
            <View
              style={[
                styles.monthHeader,
                { paddingTop: Math.max(insets.top, 16) },
              ]}
            >
              <IconButton
                onPress={() => changeMonth(-1)}
                accessibilityLabel="Previous month"
              >
                <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
              </IconButton>
              <TouchableOpacity
                onPress={jumpToToday}
                activeOpacity={0.85}
                style={styles.monthTextWrapper}
                // Vertical only — the chevrons sit right beside it.
                hitSlop={{ top: 10, bottom: 10 }}
                accessibilityRole="button"
                accessibilityLabel={
                  isCurrentMonthView
                    ? monthName
                    : `${monthName}, tap to go to ${todayMonthName}`
                }
                accessibilityState={{ disabled: isCurrentMonthView }}
              >
                <Text style={styles.monthText}>{monthName}</Text>
                {!isCurrentMonthView && (
                  <View style={styles.todayPill}>
                    <Text style={styles.todayPillText}>
                      Go to {todayMonthName}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <IconButton
                onPress={() => changeMonth(1)}
                disabled={isCurrentMonthView}
                accessibilityLabel="Next month"
                accessibilityHint={
                  isCurrentMonthView ? "You're on the current month" : undefined
                }
              >
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

            {/* Stale-but-present: show what we have, admit it may be behind. */}
            {loadFailed && entries.length > 0 ? (
              <TouchableOpacity
                onPress={retryLoad}
                activeOpacity={0.85}
                style={styles.staleNotice}
                accessibilityRole="button"
                accessibilityLabel="Couldn't refresh this month. Tap to try again."
              >
                <Text style={styles.syncNote}>
                  Couldn&apos;t refresh — showing what&apos;s on this device · tap
                  to try again
                </Text>
              </TouchableOpacity>
            ) : null}

            <Animated.View style={monthPageStyle}>
              {loading ? (
                <View style={styles.entriesContainer}>
                  <SkeletonCard height={140} style={styles.skeletonSpacing} />
                  <SkeletonCard height={100} style={styles.skeletonSpacing} />
                  <SkeletonCard height={180} style={styles.skeletonSpacing} />
                </View>
              ) : loadFailed && entries.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <View style={styles.emptyIconWrap}>
                    <IconSymbol
                      name="arrow.clockwise"
                      size={32}
                      color={Colors.ink}
                    />
                  </View>
                  <Text style={styles.emptyText}>Couldn&apos;t load this month</Text>
                  <Text style={styles.emptyHint}>
                    Your entries are safe — we just couldn&apos;t reach them from
                    here. Check your connection and try again.
                  </Text>
                  <PressableScale
                    style={styles.emptyCta}
                    onPress={retryLoad}
                    accessibilityLabel="Try again"
                  >
                    <Text style={styles.emptyCtaText}>Try again</Text>
                  </PressableScale>
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
                  <Text style={styles.emptyText}>
                    {isCurrentMonthView
                      ? "Your feed is empty"
                      : `Nothing written in ${monthName}`}
                  </Text>
                  <Text style={styles.emptyHint}>
                    Capture a highlight on the Tracker tab to start your journal.
                  </Text>
                  <PressableScale
                    style={styles.emptyCta}
                    // navigate, not push: the Tracker is a sibling tab, not a page
                    // to stack on top of this one.
                    onPress={() => router.navigate("/(tabs)")}
                    accessibilityLabel="Go to Tracker"
                  >
                    <Text style={styles.emptyCtaText}>Go to Tracker</Text>
                  </PressableScale>
                </View>
              ) : (
                <Animated.View
                  key={`${currentYear}-${currentMonth}`}
                  style={styles.entriesContainer}
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
                          const position = cardIndex++;
                          const delay =
                            Math.min(position, Motion.staggerCap) * Motion.stagger;
                          // Past the reveal window: hold the row's place with a
                          // plain box so the scrollbar stays honest, but don't
                          // mount a card or fetch its photos yet.
                          if (position >= revealed) {
                            return (
                              <View
                                key={entry.id}
                                style={[styles.entryRow, styles.entryPlaceholder]}
                              />
                            );
                          }
                          return (
                            <Animated.View
                              key={entry.id}
                              style={styles.entryRow}
                              // The staggered entrance is a first-impression
                              // flourish. On a month change the page is already
                              // sliding, and running both stacks two springs on
                              // one movement — which reads as jitter, not life.
                              entering={
                                travelled.current
                                  ? undefined
                                  : FadeInDown.delay(delay)
                                      .springify()
                                      .damping(16)
                                      .stiffness(140)
                              }
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
                                onEditPlace={setEditingPlace}
                                savedPlaces={dataStore.places}
                              />
                            </Animated.View>
                          );
                        })}
                      </View>
                    ));
                  })()}
                </Animated.View>
              )}
            </Animated.View>
          </ScrollView>
        </GestureDetector>
      </GestureHandlerRootView>

      <PlaceEditor
        // The resolved place, not the entry's snapshot — the sheet has to open
        // on the name the card is actually showing.
        place={
          editingPlace?.place
            ? resolvePlace(editingPlace.place, dataStore.places)
            : null
        }
        savedHeading={
          editingPlace?.place
            ? (matchSavedPlace(editingPlace.place, dataStore.places)?.heading ??
              null)
            : null
        }
        onSave={(next, remember) => void savePlaceEdit(next, remember)}
        onCancel={() => setEditingPlace(null)}
        saving={savingPlace}
      />

      {/* Edit entry (FR-E3) — text and photos.
          Same chrome as ConfirmDialog (scrim, PaperCard, button row) so the
          screen doesn't run two different dialog looks. */}
      <Modal
        visible={editingEntry !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEditor}
      >
        <KeyboardAvoidingView
          style={styles.editFill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.editBackdrop}
            onPress={closeEditor}
            accessibilityViewIsModal
            accessibilityRole="button"
            accessibilityLabel="Dismiss editor"
          >
            {/* Swallow taps so pressing the card doesn't dismiss the editor. */}
            <Pressable style={styles.editCardWrap} onPress={() => {}}>
              <PaperCard>
                {/* Scrolls because the card now holds text AND a photo strip,
                    and the keyboard is up the whole time — without this the
                    buttons end up under it on a short screen. */}
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                <Text style={styles.editTitle} accessibilityRole="header">
                  Edit highlight
                </Text>
                <TextInput
                  style={styles.editInput}
                  value={editText}
                  onChangeText={setEditText}
                  multiline
                  autoFocus
                  editable={!editSaving}
                  placeholder="Tell me something about today..."
                  placeholderTextColor={Colors.textSecondary}
                  accessibilityLabel="Highlight text"
                />
                <EntryPhotoEditor
                  paths={editKeptPaths}
                  localUris={editNewUris}
                  max={MAX_IMAGES}
                  disabled={editSaving}
                  onRemovePath={(path) =>
                    setEditKeptPaths((prev) => prev.filter((p) => p !== path))
                  }
                  onRemoveLocal={(uri) =>
                    setEditNewUris((prev) => prev.filter((u) => u !== uri))
                  }
                  onAdd={() => void pickEditPhotos()}
                />
                {editError ? (
                  <Text style={styles.editErrorText}>{editError}</Text>
                ) : null}
                <View style={styles.editButtonRow}>
                  <PressableScale
                    containerStyle={styles.editButtonSlot}
                    style={[styles.editButton, styles.editCancelButton]}
                    onPress={closeEditor}
                    disabled={editSaving}
                    accessibilityLabel="Cancel"
                  >
                    <Text
                      style={[
                        styles.editCancelText,
                        editSaving && styles.editButtonDisabled,
                      ]}
                    >
                      Cancel
                    </Text>
                  </PressableScale>
                  <PressableScale
                    containerStyle={styles.editButtonSlot}
                    style={[
                      styles.editButton,
                      styles.editSaveButton,
                      editSaving && styles.editButtonDisabled,
                    ]}
                    onPress={handleEditSave}
                    disabled={editSaving}
                    accessibilityLabel={editSaving ? "Saving" : "Save"}
                  >
                    <Text style={styles.editSaveText}>
                      {editSaving ? "Saving..." : "Save"}
                    </Text>
                  </PressableScale>
                </View>
                </ScrollView>
              </PaperCard>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
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
  gestureRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  monthHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
  },
  monthTextWrapper: {
    alignItems: "center",
    paddingHorizontal: 4,
  },
  monthText: {
    // Larger than the Tracker's 20pt on purpose: the Feed has no page title
    // above it, so the month is this screen's heading.
    fontSize: 24,
    color: Colors.ink,
    // `fontWeight` is a no-op on ShantellSans — weight comes from the family.
    fontFamily: Fonts.handwritingSemiBold,
  },
  todayPill: {
    // Sits off the title rather than under it, so it reads as a control
    // instead of a caption.
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: `${Colors.accent}33`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accent,
  },
  todayPillText: {
    fontSize: 12,
    color: Colors.ink,
    // ShantellSans can't synthesize weight on iOS — the old `fontWeight: "700"`
    // here rendered as regular.
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: 0.3,
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
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  date: {
    // ShantellSans can't synthesize weight on iOS, so the old `fontWeight:
    // "700"` here rendered as regular — the bold has to come from the family.
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
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
  /** Roughly a text-only card, so scroll height doesn't lurch as cards land. */
  entryPlaceholder: { height: 120 },
  emptyContainer: {
    marginHorizontal: 16,
    marginTop: 32,
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Hairline.faint,
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
    textAlign: "center",
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
  editFill: {
    flex: 1,
  },
  editBackdrop: {
    flex: 1,
    backgroundColor: Scrim.modal,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  editCardWrap: {
    width: "100%",
    maxWidth: 360,
    // Leaves room for the keyboard rather than letting the card fill the
    // screen and push its own buttons out of reach.
    maxHeight: "80%",
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
  staleNotice: {
    marginBottom: 4,
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
  // `flex` goes on the Pressable via containerStyle; the painted surface
  // stays on the inner animated view. Passing flex in `style` leaves the
  // Pressable unflexed and collapses the button to nothing.
  editButtonSlot: { flex: 1 },
  editButton: {
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
