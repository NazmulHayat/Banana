import { HabitGrid } from '@/components/habit-grid';
import { HighlightInput } from '@/components/highlight-input';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PaperBackground } from '@/components/ui/paper-background';
import { Colors, Fonts } from '@/constants/theme';
import { DailyEntry, Habit, HabitLog, storage } from '@/lib/storage';
import { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [entry, setEntry] = useState<DailyEntry | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const habitGridHeaderRef = useRef<View>(null);
  const stickyHeaderScrollRef = useRef<ScrollView>(null);
  const [headerStickyY, setHeaderStickyY] = useState(0);

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  useEffect(() => {
    loadData();
  }, [currentMonth, currentYear]);

  const loadData = async () => {
    const [loadedHabits, loadedLogs] = await Promise.all([
      storage.getHabits(),
      storage.getHabitLogs(currentMonth, currentYear),
    ]);
    setHabits(loadedHabits);
    setLogs(loadedLogs);

    const today = new Date().toISOString().split('T')[0];
    const todayEntry = await storage.getDailyEntry(today);
    setEntry(todayEntry);
  };

  const changeMonth = (direction: number) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const handleToggleHabit = async (habitId: string, date: string) => {
    await storage.toggleHabitLog(habitId, date);
    const updatedLogs = await storage.getHabitLogs(currentMonth, currentYear);
    setLogs(updatedLogs);
  };

  const handleSaveEntry = async (text: string, mediaUrls: string[]) => {
    const today = new Date().toISOString().split('T')[0];
    const newEntry: DailyEntry = {
      id: entry?.id || Date.now().toString(),
      date: today,
      text,
      mediaUrls,
      createdAt: entry?.createdAt || new Date().toISOString(),
    };
    await storage.saveDailyEntry(newEntry);
    setEntry(newEntry);
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
        }
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
            { useNativeDriver: false }
          )}
          scrollEventThrottle={16}>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
            <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton}>
              <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            </TouchableOpacity>
            <Text style={styles.monthText}>{monthName}</Text>
            <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton}>
              <IconSymbol name="chevron.right" size={24} color={Colors.ink} />
            </TouchableOpacity>
          </View>

          <HighlightInput entry={entry} onSave={handleSaveEntry} />

          <HabitGrid
            habits={habits}
            logs={logs}
            currentMonth={currentMonth}
            currentYear={currentYear}
            onToggle={handleToggleHabit}
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
                  extrapolate: 'clamp',
                }),
              },
            ]}>
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
                contentContainerStyle={{ width: totalHabitsWidth }}>
                <View style={styles.stickyHeaderRow}>
                  {habits.map((habit) => (
                    <View key={habit.id} style={styles.stickyHabitCell}>
                      <Text style={styles.stickyHabitName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                        {habit.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  navButton: {
    padding: 8,
  },
  monthText: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: Colors.paper,
  },
  stickyHeaderContent: {
    flexDirection: 'row',
    marginHorizontal: 16,
  },
  stickyDayHeader: {
    width: 62,
  },
  stickyDayCell: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: 'transparent',
  },
  stickyDayText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.5,
  },
  stickyHabitsScroll: {
    flex: 1,
    height: 60,
  },
  stickyHeaderRow: {
    flexDirection: 'row',
  },
  stickyHabitCell: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: 2,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: 'transparent',
  },
  stickyHabitName: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    fontWeight: '700',
  },
});