import { Motion } from '@/constants/motion';
import { Colors, Fonts } from '@/constants/theme';
import { daysInMonth as daysInMonthOf, isFutureDay, toDayKey, todayKey } from '@/lib/dates';
import { Habit, HabitLog } from '@/lib/db';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { HabitCell } from './ui/habit-cell';
import { IconSymbol } from './ui/icon-symbol';

// Column geometry — kept in sync with the styles below. One column is the
// cell plus its 2pt right margin.
export const CELL_GAP = 2;
/** Every cell is 60pt tall so the habit rows line up with the DAY column. */
export const CELL_HEIGHT = 60;
/** A fixed column (60pt cell + 2pt gap) — the 4-or-more-habits layout. */
export const HABIT_COLUMN_WIDTH = 62;
/** The pinned DAY column on the left, same width as a fixed habit column. */
export const DAY_COLUMN_WIDTH = 62;
/**
 * At or below this many habits the columns stretch to fill the row instead of
 * hugging the left edge with dead paper to the right — and the grid does not
 * scroll horizontally. Above it we keep fixed columns + horizontal scroll.
 */
export const ADAPTIVE_MAX_HABITS = 3;

/**
 * Width of one habit column for `habitCount` habits in `availableWidth` points
 * (the space left of the pinned DAY column). 1–3 habits divide the row evenly;
 * 4+ keep the fixed column so the month stays scannable. Never narrower than a
 * fixed column, so the 44pt touch-target floor always holds.
 */
export function computeColumnWidth(availableWidth: number, habitCount: number): number {
  if (habitCount <= 0 || habitCount > ADAPTIVE_MAX_HABITS || availableWidth <= 0) {
    return HABIT_COLUMN_WIDTH;
  }
  return Math.max(HABIT_COLUMN_WIDTH, Math.floor(availableWidth / habitCount));
}

interface HabitGridProps {
  habits: Habit[];
  logs: HabitLog[];
  currentMonth: number;
  currentYear: number;
  onToggle: (habitId: string, date: string) => void;
  onEdit: () => void;
  /** Persist a reordered habit list (optimistic update + save lives in the screen). */
  onReorder?: (newOrder: Habit[]) => void;
  onHeaderLayout?: (y: number) => void;
  headerRef?: React.RefObject<View | null>;
  onHorizontalScroll?: (offsetX: number) => void;
  stickyHeaderScrollRef?: React.RefObject<ScrollView | null>;
}

export function HabitGrid({ habits, logs, currentMonth, currentYear, onToggle, onEdit, onReorder, onHeaderLayout, headerRef, onHorizontalScroll, stickyHeaderScrollRef }: HabitGridProps) {
  const daysInMonth = daysInMonthOf(currentYear, currentMonth);
  const today = new Date();
  const isCurrentMonth = today.getMonth() + 1 === currentMonth && today.getFullYear() === currentYear;
  const currentDay = isCurrentMonth ? today.getDate() : null;
  const horizontalScrollRef = useRef<ScrollView>(null);
  const headerScrollRef = useRef<ScrollView>(null);
  const todayStr = todayKey();

  // Available width for the habit columns, measured from the real layout
  // (never Dimensions.get) so it is right on every device and after any
  // layout change. 0 until the first onLayout — we render fixed columns
  // meanwhile, then settle into the adaptive width on the next frame.
  const [gridWidth, setGridWidth] = useState(0);
  const columnWidth = computeColumnWidth(gridWidth, habits.length);
  const cellSize = columnWidth - CELL_GAP;
  const adaptive = habits.length > 0 && habits.length <= ADAPTIVE_MAX_HABITS;

  // Drag-to-reorder: long-press a habit name to enter reorder mode, then drag
  // the lifted column left/right. Disabled while names are still loading
  // (placeholder habits have an empty createdAt — see index.tsx).
  const [reordering, setReordering] = useState(false);
  const canReorder = !!onReorder && habits.length > 1 && habits.every((h) => h.createdAt !== '');

  const commitReorder = (from: number, to: number) => {
    if (from === to || !onReorder) return;
    const next = habits.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  // Day keys are local-time and built in exactly one place (lib/dates.ts) so a
  // tapped cell and a saved highlight always agree on the day (bug D1).
  const dayKeyFor = (day: number) => toDayKey(new Date(currentYear, currentMonth - 1, day));

  const isCompleted = (habitId: string, day: number) => {
    const date = dayKeyFor(day);
    return logs.some((log) => log.habitId === habitId && log.date === date && log.completed);
  };

  const getDayName = (day: number) => {
    const date = new Date(currentYear, currentMonth - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
  };

  /** "March 4" — the date half of a cell's spoken label. */
  const getDayLabel = (day: number) =>
    new Date(currentYear, currentMonth - 1, day).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    });

  const handleContentScroll = (event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    // Sync header scroll with content scroll
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollTo({ x: offsetX, animated: false });
    }
    // Notify parent for sticky header sync
    if (onHorizontalScroll) {
      onHorizontalScroll(offsetX);
    }
  };

  const handleHeaderScroll = (event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    // Sync content scroll with header scroll
    if (horizontalScrollRef.current) {
      horizontalScrollRef.current.scrollTo({ x: offsetX, animated: false });
    }
    // Notify parent for sticky header sync
    if (onHorizontalScroll) {
      onHorizontalScroll(offsetX);
    }
  };

  const handleHeaderLayout = (event: any) => {
    if (onHeaderLayout) {
      const { y } = event.nativeEvent.layout;
      onHeaderLayout(y);
    }
  };

  const totalHabitsWidth = habits.length * columnWidth;

  if (habits.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>HABITS</Text>
        </View>
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <IconSymbol name="leaf.fill" size={32} color={Colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>Start tracking</Text>
          <Text style={styles.emptyHint}>
            Add habits like Exercise, Read, or Hydrate to build your routine.
          </Text>
          <TouchableOpacity
            style={styles.emptyCta}
            onPress={onEdit}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyCtaText}>+ Add Your First Habit</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          HABITS
        </Text>
        {reordering ? (
          <TouchableOpacity
            onPress={() => setReordering(false)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Done reordering"
          >
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={onEdit}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Edit habits"
          >
            <Text style={styles.edit}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>
      {reordering && (
        <Text style={styles.reorderHint}>Drag a habit to reorder · tap Done when finished</Text>
      )}
      <View style={styles.gridWrapper}>
        {/* Header row container */}
        <View
          ref={headerRef}
          onLayout={handleHeaderLayout}
          style={styles.headerRowContainer}>
          {/* Fixed day header */}
          <View style={styles.fixedDayHeader}>
            <View style={styles.dayHeaderCell}>
              <Text style={styles.dayHeaderText}>DAY</Text>
            </View>
          </View>
          
          {/* Fixed header row (habits) - synced with content scroll.
              In reorder mode the row becomes a draggable list; scroll is
              disabled so the pan gesture owns the touch. */}
          <ScrollView
            ref={headerScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleHeaderScroll}
            scrollEnabled={!reordering && !adaptive}
            style={styles.headerScrollView}
            contentContainerStyle={{ width: totalHabitsWidth }}>
            {reordering ? (
              <ReorderableHeaderRow
                habits={habits}
                width={totalHabitsWidth}
                columnWidth={columnWidth}
                onCommit={commitReorder}
              />
            ) : (
              <View style={styles.headerRow}>
                {habits.map((habit) => (
                  <HabitHeaderName
                    key={habit.id}
                    name={habit.name}
                    width={cellSize}
                    canReorder={canReorder}
                    onLongPress={() => setReordering(true)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </View>

        {/* Content area - no vertical scroll here, parent handles it */}
        <View style={styles.contentWrapper}>
          {/* Fixed day column */}
          <View style={styles.fixedDayColumn}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
              // Group the two lines so VoiceOver reads "Mon 4", not two stops.
              <View key={day} style={styles.dayCell} accessible>
                <Text style={styles.dayName}>{getDayName(day)}</Text>
                <Text style={styles.dayNumber}>{day}</Text>
              </View>
            ))}
          </View>
          
          {/* Scrollable habit columns */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            ref={horizontalScrollRef}
            scrollEventThrottle={16}
            onScroll={handleContentScroll}
            scrollEnabled={!adaptive}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
            style={styles.habitsScrollView}
            contentContainerStyle={{ width: totalHabitsWidth }}>
            <View style={styles.habitsColumn}>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const date = dayKeyFor(day);
                // A day you haven't lived yet can't be ticked (D14). Past days
                // stay editable — back-filling is the point of a journal.
                const future = isFutureDay(date, todayStr);
                const dayLabel = getDayLabel(day);
                return (
                  <View key={day} style={styles.row}>
                    {habits.map((habit) => {
                      const completed = isCompleted(habit.id, day);
                      return (
                        <View
                          key={`${habit.id}-${day}`}
                          style={[styles.cellWrapper, { width: cellSize }]}>
                          <HabitCell
                            completed={completed}
                            isCurrentDay={currentDay === day}
                            onPress={() => onToggle(habit.id, date)}
                            size={cellSize}
                            height={CELL_HEIGHT}
                            disabled={future}
                            // A future day isn't a miss — say "not yet" so
                            // VoiceOver never reads an unlived day as a fail.
                            accessibilityLabel={`${habit.name}, ${dayLabel}, ${
                              completed
                                ? 'completed'
                                : future
                                  ? 'not yet'
                                  : 'not completed'
                            }`}
                          />
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

/**
 * A single habit name cell in the (non-reordering) header. A long-press
 * arms reorder mode; haptic confirms the pickup intent.
 */
interface HabitHeaderNameProps {
  name: string;
  /** Measured cell width (adaptive when there are 1–3 habits). */
  width: number;
  canReorder: boolean;
  onLongPress: () => void;
}

function HabitHeaderName({ name, width, canReorder, onLongPress }: HabitHeaderNameProps) {
  return (
    <TouchableOpacity
      style={[styles.habitHeaderCell, { width }]}
      activeOpacity={canReorder ? 0.6 : 1}
      delayLongPress={300}
      disabled={!canReorder}
      // The header clamps long names to two lines; the full name still reads
      // out here and lives unabridged in the habit editor.
      accessibilityLabel={name}
      accessibilityRole="header"
      accessibilityHint={canReorder ? 'Long press to reorder habits' : undefined}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress();
      }}>
      <Text style={styles.habitName} numberOfLines={2} ellipsizeMode="tail">
        {name}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * The header row while in reorder mode. The whole row is one GestureDetector;
 * a pan picks the column under the finger, lifts it, slides the other columns
 * out of the way, and on release commits the new index. Haptics fire on
 * pickup and drop.
 */
interface ReorderableHeaderRowProps {
  habits: Habit[];
  width: number;
  /** One column's width — drives both the hit test and the make-room shift. */
  columnWidth: number;
  onCommit: (from: number, to: number) => void;
}

function ReorderableHeaderRow({ habits, width, columnWidth, onCommit }: ReorderableHeaderRowProps) {
  // -1 = nothing being dragged.
  const activeIndex = useSharedValue(-1);
  const dragX = useSharedValue(0); // finger delta from the column's home x
  const targetIndex = useSharedValue(-1);

  const count = habits.length;
  const clampIndex = (i: number) => {
    'worklet';
    return Math.max(0, Math.min(count - 1, i));
  };

  const haptic = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const pan = Gesture.Pan()
    .onBegin((e) => {
      const idx = clampIndex(Math.floor(e.x / columnWidth));
      activeIndex.value = idx;
      targetIndex.value = idx;
      dragX.value = 0;
      runOnJS(haptic)();
    })
    .onUpdate((e) => {
      if (activeIndex.value < 0) return;
      dragX.value = e.translationX;
      const moved = activeIndex.value + Math.round(e.translationX / columnWidth);
      targetIndex.value = clampIndex(moved);
    })
    .onEnd(() => {
      const from = activeIndex.value;
      const to = targetIndex.value;
      if (from >= 0 && to >= 0 && from !== to) {
        runOnJS(haptic)();
        runOnJS(onCommit)(from, to);
      }
      activeIndex.value = -1;
      targetIndex.value = -1;
      dragX.value = 0; // snap home instantly; the reordered list lands it in place
    })
    .onFinalize(() => {
      activeIndex.value = -1;
      targetIndex.value = -1;
    });

  return (
    // GestureHandlerRootView is required for the pan to register; the app root
    // doesn't mount one, so we scope a minimal one here (matches ImageViewer).
    <GestureHandlerRootView style={{ width, height: 60 }}>
      <GestureDetector gesture={pan}>
        <View style={[styles.headerRow, { width }]}>
          {habits.map((habit, index) => (
            <ReorderCell
              key={habit.id}
              name={habit.name}
              index={index}
              columnWidth={columnWidth}
              activeIndex={activeIndex}
              targetIndex={targetIndex}
              dragX={dragX}
            />
          ))}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

interface ReorderCellProps {
  name: string;
  index: number;
  /** One column's width — how far a neighbour slides to open the gap. */
  columnWidth: number;
  activeIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  dragX: SharedValue<number>;
}

function ReorderCell({ name, index, columnWidth, activeIndex, targetIndex, dragX }: ReorderCellProps) {
  const animatedStyle = useAnimatedStyle(() => {
    // The picked-up column follows the finger and lifts above the rest.
    if (activeIndex.value === index) {
      return {
        transform: [{ translateX: dragX.value }, { scale: 1.06 }],
        zIndex: 10,
        opacity: 0.95,
      };
    }
    // While dragging, the columns between the picked-up slot and the current
    // target slide one column over to OPEN A GAP (spring = natural make-room).
    // When not dragging the shift is 0 with no animation, so on drop the list
    // just reorders into place — no post-swap settle/wobble.
    const from = activeIndex.value;
    const to = targetIndex.value;
    let shift = 0;
    if (from >= 0 && to >= 0) {
      if (from < to && index > from && index <= to) shift = -columnWidth;
      else if (from > to && index < from && index >= to) shift = columnWidth;
    }
    const dragging = from >= 0;
    return {
      transform: [
        { translateX: dragging ? withSpring(shift, Motion.spring) : 0 },
        { scale: 1 },
      ],
      zIndex: 1,
      opacity: 1,
    };
  });

  return (
    <Animated.View
      style={[styles.reorderCell, { width: columnWidth - CELL_GAP }, animatedStyle]}
      accessibilityLabel={name}>
      <View style={styles.reorderCellInner}>
        <Text style={styles.habitName} numberOfLines={2} ellipsizeMode="tail">
          {name}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.shadow,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.5,
  },
  edit: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  done: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwritingSemiBold,
  },
  reorderHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: -8,
    marginBottom: 12,
  },
  gridWrapper: {
    backgroundColor: 'transparent',
  },
  headerRowContainer: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
  },
  fixedDayHeader: {
    width: DAY_COLUMN_WIDTH,
  },
  headerScrollView: {
    flex: 1,
    height: 60,
  },
  headerRow: {
    flexDirection: 'row',
  },
  contentWrapper: {
    flexDirection: 'row',
  },
  fixedDayColumn: {
    width: DAY_COLUMN_WIDTH,
    paddingTop: 0,
  },
  habitsScrollView: {
    flex: 1,
  },
  habitsColumn: {
    flexDirection: 'column',
  },
  dayHeaderCell: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: 'transparent',
    marginBottom: 0,
  },
  dayHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.5,
  },
  habitHeaderCell: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: 2,
    marginBottom: 0,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: 'transparent',
  },
  habitName: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    fontWeight: '700',
  },
  reorderCell: {
    width: 60,
    height: 60,
    marginRight: 2,
  },
  reorderCellInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    backgroundColor: `${Colors.accent}1A`,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  dayCell: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
    marginBottom: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: 'transparent',
  },
  dayName: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
  },
  dayNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  cellWrapper: {
    // width is set inline (adaptive when there are 1-3 habits)
    width: HABIT_COLUMN_WIDTH - CELL_GAP,
    height: CELL_HEIGHT,
    marginRight: CELL_GAP,
  },
  emptyCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  emptyIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: `${Colors.accent}26`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 6,
  },
  emptyHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  emptyCta: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: Colors.ink,
    borderRadius: 10,
  },
  emptyCtaText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
});