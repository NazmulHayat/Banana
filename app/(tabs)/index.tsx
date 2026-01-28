import { HabitGrid } from '@/components/habit-grid';
import { HighlightInput } from '@/components/highlight-input';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PaperBackground } from '@/components/ui/paper-background';
import { Colors, Fonts } from '@/constants/theme';
import {
  // Types
  DailyEntry,
  Habit,
  HabitLog,
  // Operations
  saveEntry,
  saveHabits,
  getHabits,
  getHabitLogsForMonth,
  toggleHabitLog,
  getEntriesForDate,
  waitForAuth,
} from '@/lib/db';
import { useRef, useState, useCallback } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View, Modal, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

export default function TrackerScreen() {
  const insets = useSafeAreaInsets();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [todayEntryCount, setTodayEntryCount] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const habitGridHeaderRef = useRef<View>(null);
  const stickyHeaderScrollRef = useRef<ScrollView>(null);
  const [headerStickyY, setHeaderStickyY] = useState(0);

  // Habit management state
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [habitName, setHabitName] = useState('');

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [currentMonth, currentYear])
  );

  const loadData = async () => {
    // Wait for auth to be ready first
    const isReady = await waitForAuth();
    if (!isReady) {
      console.log('[TrackerScreen] Auth not ready, skipping load');
      return;
    }

    // Load data from Supabase
    console.log('[TrackerScreen] Loading data...');
    const [loadedHabits, loadedLogs] = await Promise.all([
      getHabits(),
      getHabitLogsForMonth(currentYear, currentMonth),
    ]);
    console.log('[TrackerScreen] Loaded', loadedHabits.length, 'habits and', loadedLogs.length, 'logs');
    setHabits(loadedHabits);
    setLogs(loadedLogs);

    // Get count of entries for today (background, do not block)
    const today = new Date().toISOString().split('T')[0];
    void getEntriesForDate(today).then((todayEntries) => {
      setTodayEntryCount(todayEntries.length);
    });
  };

  const changeMonth = (direction: number) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const handleToggleHabit = async (habitId: string, date: string) => {
    const existing = logs.find(
      (log) => log.habitId === habitId && log.date === date,
    );
    const currentCompleted = existing?.completed ?? false;

    // Optimistic toggle based on current logs
    setLogs((prevLogs) => {
      const existingIndex = prevLogs.findIndex(
        (log) => log.habitId === habitId && log.date === date,
      );
      if (existingIndex === -1) {
        return [...prevLogs, { habitId, date, completed: true }];
      }
      const next = [...prevLogs];
      next[existingIndex] = {
        ...next[existingIndex],
        completed: !next[existingIndex].completed,
      };
      return next;
    });

    // Fire-and-correct network call
    try {
      await toggleHabitLog(habitId, date, currentCompleted);
    } catch (error) {
      console.error('[TrackerScreen] Failed to toggle habit log:', error);
      // On failure, resync from server
      const updatedLogs = await getHabitLogsForMonth(currentYear, currentMonth);
      setLogs(updatedLogs);
    }
  };

  const handleSaveEntry = async (text: string, mediaUrls: string[]) => {
    const today = new Date().toISOString().split('T')[0];

    const newEntry: DailyEntry = {
      id: Date.now().toString(),
      date: today,
      text,
      mediaUrls,
      createdAt: new Date().toISOString(),
    };
    
    // Optimistic update for speed (no hard limit)
    setTodayEntryCount((count) => count + 1);

    try {
      await saveEntry(newEntry);
    } catch (error) {
      console.error('[TrackerScreen] Failed to save entry:', error);
      Alert.alert('Save failed', 'Could not save entry. Please try again.');
      const updatedEntries = await getEntriesForDate(today);
      setTodayEntryCount(updatedEntries.length);
    }
  };

  // Habit management handlers
  const handleOpenHabitModal = (habit?: Habit) => {
    if (habit) {
      setEditingHabit(habit);
      setHabitName(habit.name);
    } else {
      setEditingHabit(null);
      setHabitName('');
    }
    setShowHabitModal(true);
  };

  const handleSaveHabit = async () => {
    const name = habitName.trim();
    if (!name) {
      Alert.alert('Required', 'Please enter a habit name.');
      return;
    }
    if (name.length > 20) {
      Alert.alert('Too long', 'Habit name must be 20 characters or less.');
      return;
    }

    let updatedHabits: Habit[];
    if (editingHabit) {
      // Update existing habit
      updatedHabits = habits.map(h => 
        h.id === editingHabit.id ? { ...h, name } : h
      );
    } else {
      // Add new habit
      const newHabit: Habit = {
        id: Date.now().toString(),
        name,
        createdAt: new Date().toISOString(),
      };
      updatedHabits = [...habits, newHabit];
    }

    // Optimistic UI update for speed
    setHabits(updatedHabits);
    setShowHabitModal(false);
    setHabitName('');
    setEditingHabit(null);

    try {
      // Save to Supabase
      await saveHabits(updatedHabits);

      // Refresh logs in background (habits may affect grid rendering)
      const updatedLogs = await getHabitLogsForMonth(currentYear, currentMonth);
      setLogs(updatedLogs);
    } catch (error) {
      console.error('[TrackerScreen] Failed to save habits:', error);
      Alert.alert('Save failed', 'Could not save habits. Please try again.');

      // Re-sync state from server on failure
      const reloadedHabits = await getHabits();
      setHabits(reloadedHabits);
    }
  };

  const handleDeleteHabit = async (habit: Habit) => {
    Alert.alert(
      'Delete habit',
      `Are you sure you want to delete "${habit.name}"? This will also delete all logs for this habit.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updatedHabits = habits.filter(h => h.id !== habit.id);
            
            // Optimistic update
            setHabits(updatedHabits);
            setShowHabitModal(false);

            try {
              await saveHabits(updatedHabits);
              const updatedLogs = await getHabitLogsForMonth(currentYear, currentMonth);
              setLogs(updatedLogs);
            } catch (error) {
              console.error('[TrackerScreen] Failed to delete habit:', error);
              Alert.alert('Delete failed', 'Could not delete habit. Please try again.');
              const reloadedHabits = await getHabits();
              setHabits(reloadedHabits);
            }
          },
        },
      ]
    );
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

          <HighlightInput todayEntryCount={todayEntryCount} onSave={handleSaveEntry} />

          <HabitGrid
            habits={habits}
            logs={logs}
            currentMonth={currentMonth}
            currentYear={currentYear}
            onToggle={handleToggleHabit}
            onEdit={() => handleOpenHabitModal()}
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
                {editingHabit ? 'Edit Habit' : 'Manage Habits'}
              </Text>
              <TouchableOpacity onPress={() => handleOpenHabitModal()}>
                <IconSymbol name="plus" size={24} color={Colors.accent} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* Current habits list */}
              {habits.length > 0 && !editingHabit && (
                <View style={styles.habitsList}>
                  <Text style={styles.habitsListTitle}>Your Habits</Text>
                  {habits.map((habit) => (
                    <TouchableOpacity
                      key={habit.id}
                      style={styles.habitItem}
                      onPress={() => handleOpenHabitModal(habit)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.habitItemName}>{habit.name}</Text>
                      <IconSymbol name="chevron.right" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Add/Edit form */}
              {(editingHabit || habits.length === 0 || habitName !== '') && (
                <View style={styles.habitForm}>
                  <Text style={styles.formLabel}>
                    {editingHabit ? 'Habit Name' : 'Add New Habit'}
                  </Text>
                  <TextInput
                    style={styles.habitInput}
                    value={habitName}
                    onChangeText={setHabitName}
                    placeholder="e.g. Exercise, Read, Meditate"
                    placeholderTextColor={Colors.textSecondary}
                    maxLength={20}
                    autoFocus={editingHabit !== null || habits.length === 0}
                  />
                  <Text style={styles.charCount}>{habitName.length}/20</Text>

                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveHabit}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.saveButtonText}>
                      {editingHabit ? 'Save Changes' : 'Add Habit'}
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
                        setHabitName('');
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.backButtonText}>Back to list</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {habits.length === 0 && habitName === '' && (
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
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontWeight: '600',
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
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  habitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontWeight: '500',
  },
  habitForm: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: 'uppercase',
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
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  saveButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  deleteButton: {
    height: 52,
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d32f2f',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  deleteButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d32f2f',
    fontFamily: Fonts.handwriting,
  },
  backButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  backButtonText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
  emptyHabits: {
    alignItems: 'center',
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
});