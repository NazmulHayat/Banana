import { Motion } from '@/constants/motion';
import { Colors, Fonts } from '@/constants/theme';
import { daysInMonth as daysInMonthOf, toDayKey } from '@/lib/dates';
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
// cell (60) plus its 2pt right margin.
const CELL_WIDTH = 62;

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

  const totalHabitsWidth = habits.length * CELL_WIDTH;

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
        <Text style={styles.title}>HABITS</Text>
        {reordering ? (
          <TouchableOpacity onPress={() => setReordering(false)} activeOpacity={0.7}>
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onEdit} activeOpacity={0.7}>
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
            scrollEnabled={!reordering}
            style={styles.headerScrollView}
            contentContainerStyle={{ width: totalHabitsWidth }}>
            {reordering ? (
              <ReorderableHeaderRow
                habits={habits}
                width={totalHabitsWidth}
                onCommit={commitReorder}
              />
            ) : (
              <View style={styles.headerRow}>
                {habits.map((habit) => (
                  <HabitHeaderName
                    key={habit.id}
                    name={habit.name}
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
              <View key={day} style={styles.dayCell}>
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
            scrollEnabled={true}
            style={styles.habitsScrollView}
            contentContainerStyle={{ width: totalHabitsWidth }}>
            <View style={styles.habitsColumn}>
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const date = dayKeyFor(day);
                return (
                  <View key={day} style={styles.row}>
                    {habits.map((habit) => (
                      <View key={`${habit.id}-${day}`} style={styles.cellWrapper}>
                        <HabitCell
                          completed={isCompleted(habit.id, day)}
                          isCurrentDay={currentDay === day}
                          onPress={() => onToggle(habit.id, date)}
                          size={60}
                        />
                      </View>
                    ))}
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
  canReorder: boolean;
  onLongPress: () => void;
}

function HabitHeaderName({ name, canReorder, onLongPress }: HabitHeaderNameProps) {
  return (
    <TouchableOpacity
      style={styles.habitHeaderCell}
      activeOpacity={canReorder ? 0.6 : 1}
      delayLongPress={300}
      disabled={!canReorder}
      onLongPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress();
      }}>
      <Text style={styles.habitName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
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
  onCommit: (from: number, to: number) => void;
}

function ReorderableHeaderRow({ habits, width, onCommit }: ReorderableHeaderRowProps) {
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
      const idx = clampIndex(Math.floor(e.x / CELL_WIDTH));
      activeIndex.value = idx;
      targetIndex.value = idx;
      dragX.value = 0;
      runOnJS(haptic)();
    })
    .onUpdate((e) => {
      if (activeIndex.value < 0) return;
      dragX.value = e.translationX;
      const moved = activeIndex.value + Math.round(e.translationX / CELL_WIDTH);
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
  activeIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  dragX: SharedValue<number>;
}

function ReorderCell({ name, index, activeIndex, targetIndex, dragX }: ReorderCellProps) {
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
      if (from < to && index > from && index <= to) shift = -CELL_WIDTH;
      else if (from > to && index < from && index >= to) shift = CELL_WIDTH;
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
    <Animated.View style={[styles.reorderCell, animatedStyle]}>
      <View style={styles.reorderCellInner}>
        <Text style={styles.habitName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
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
    width: 62,
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
    width: 62,
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
    width: 60,
    height: 60,
    marginRight: 2,
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