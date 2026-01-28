import { Colors, Fonts } from '@/constants/theme';
import { Habit, HabitLog } from '@/lib/db';
import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { HabitCell } from './ui/habit-cell';

interface HabitGridProps {
  habits: Habit[];
  logs: HabitLog[];
  currentMonth: number;
  currentYear: number;
  onToggle: (habitId: string, date: string) => void;
  onEdit: () => void;
  onHeaderLayout?: (y: number) => void;
  headerRef?: React.RefObject<View | null>;
  onHorizontalScroll?: (offsetX: number) => void;
  stickyHeaderScrollRef?: React.RefObject<ScrollView | null>;
}

export function HabitGrid({ habits, logs, currentMonth, currentYear, onToggle, onEdit, onHeaderLayout, headerRef, onHorizontalScroll, stickyHeaderScrollRef }: HabitGridProps) {
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getMonth() + 1 === currentMonth && today.getFullYear() === currentYear;
  const currentDay = isCurrentMonth ? today.getDate() : null;
  const horizontalScrollRef = useRef<ScrollView>(null);
  const headerScrollRef = useRef<ScrollView>(null);

  const isCompleted = (habitId: string, day: number) => {
    const date = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
      const { y, height } = event.nativeEvent.layout;
      onHeaderLayout(y);
    }
  };

  const cellWidth = 62; // 60 + 2 margin
  const totalHabitsWidth = habits.length * cellWidth;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>HABITS</Text>
        <TouchableOpacity onPress={onEdit} activeOpacity={0.7}>
          <Text style={styles.edit}>Edit</Text>
        </TouchableOpacity>
      </View>
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
          
          {/* Fixed header row (habits) - synced with content scroll */}
          <ScrollView
            ref={headerScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleHeaderScroll}
            scrollEnabled={true}
            style={styles.headerScrollView}
            contentContainerStyle={{ width: totalHabitsWidth }}>
            <View style={styles.headerRow}>
              {habits.map((habit) => (
                <View key={habit.id} style={styles.habitHeaderCell}>
                  <Text style={styles.habitName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {habit.name}
                  </Text>
                </View>
              ))}
            </View>
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
                const date = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
});