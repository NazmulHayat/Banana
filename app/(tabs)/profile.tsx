import { useEffect, useState, useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { PaperBackground } from '@/components/ui/paper-background';
import { PaperCard } from '@/components/ui/paper-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { useOnboarding } from '@/lib/onboarding-context';
import { supabase } from '@/lib/supabase';
import {
  Habit,
  HabitLog,
  getHabits,
  saveHabits,
  getHabitLogsForMonth,
  getEntriesForMonth,
  waitForAuth,
} from '@/lib/db';
import { router, Href } from 'expo-router';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { resetOnboarding } = useOnboarding();
  const [username, setUsername] = useState<string | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalHabits: 0,
    totalEntries: 0,
    streak: 0,
    thisMonthCompletion: 0,
  });
  
  // Habit management state
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [habitName, setHabitName] = useState('');

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadAllData();
    }, [user])
  );

  const loadAllData = async () => {
    await Promise.all([
      loadProfile(),
      loadStats(),
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  };

  const loadProfile = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('accounts')
      .select('username')
      .eq('id', user.id)
      .single();
    
    if (data) {
      setUsername(data.username);
    }
  };

  const loadStats = async () => {
    // Wait for auth to be ready first
    const isReady = await waitForAuth();
    if (!isReady) {
      console.log('[ProfileScreen] Auth not ready, skipping load');
      return;
    }

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    // Load habits first
    console.log('[ProfileScreen] Loading habits...');
    const loadedHabits = await getHabits();
    console.log('[ProfileScreen] Loaded', loadedHabits.length, 'habits');
    setHabits(loadedHabits);
    
    // Load current month data in parallel
    const [monthLogs, monthEntries] = await Promise.all([
      getHabitLogsForMonth(currentYear, currentMonth),
      getEntriesForMonth(currentYear, currentMonth),
    ]);
    
    // Calculate this month's completion rate (fast)
    const thisMonthCompletion = calculateMonthCompletion(loadedHabits, monthLogs);
    
    // Set initial stats (fast)
    setStats({
      totalHabits: loadedHabits.length,
      totalEntries: monthEntries.length,
      streak: 0, // Will update after loading logs
      thisMonthCompletion,
    });
    
    // Load logs for streak calculation (last 3 months)
    const allLogs: HabitLog[] = [];
    const logPromises = [];
    for (let i = 0; i < 3; i++) {
      const checkDate = new Date(today);
      checkDate.setMonth(today.getMonth() - i);
      const month = checkDate.getMonth() + 1;
      const year = checkDate.getFullYear();
      logPromises.push(getHabitLogsForMonth(year, month));
    }
    const logResults = await Promise.all(logPromises);
    logResults.forEach(logs => allLogs.push(...logs));
    
    // Update streak (non-blocking update)
    const streak = calculateStreak(loadedHabits, allLogs);
    setStats(prev => ({ ...prev, streak }));
  };

  const calculateStreak = (habits: Habit[], logs: HabitLog[]): number => {
    if (habits.length === 0) return 0;
    
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Check each day going backwards
    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(today.getDate() - i);
      const dateStr = checkDate.toISOString().split('T')[0];
      
      // Count completed habits for this day
      const completedCount = logs.filter(
        log => log.date === dateStr && log.completed
      ).length;
      
      // If at least one habit completed, increment streak
      if (completedCount > 0) {
        streak++;
      } else if (i > 0) {
        // Allow today to be incomplete, but break on previous days
        break;
      }
    }
    
    return streak;
  };

  const calculateMonthCompletion = (habits: Habit[], logs: HabitLog[]): number => {
    if (habits.length === 0) return 0;
    
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const currentDay = today.getDate();
    
    // Count total possible completions (habits × days so far)
    const totalPossible = habits.length * currentDay;
    if (totalPossible === 0) return 0;
    
    // Count actual completions this month
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const completedCount = logs.filter(
      log => log.date.startsWith(monthStr) && log.completed
    ).length;
    
    return Math.round((completedCount / totalPossible) * 100);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
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

  const handleCloseModal = () => {
    setShowHabitModal(false);
    setEditingHabit(null);
    setHabitName('');
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

    // Save to Supabase
    await saveHabits(updatedHabits);
    
    // Reload from database to ensure sync
    const reloadedHabits = await getHabits();
    setHabits(reloadedHabits);
    setStats(prev => ({ ...prev, totalHabits: reloadedHabits.length }));
    
    // Reload all stats to ensure everything is in sync
    await loadStats();
    
    setEditingHabit(null);
    setHabitName('');
  };

  const handleDeleteHabit = (habit: Habit) => {
    Alert.alert(
      'Delete habit',
      `Are you sure you want to delete "${habit.name}"? This will also remove it from your tracking history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updatedHabits = habits.filter(h => h.id !== habit.id);
            
            // Save to Supabase
            await saveHabits(updatedHabits);
            
            // Reload from database to ensure sync
            const reloadedHabits = await getHabits();
            setHabits(reloadedHabits);
            setStats(prev => ({ ...prev, totalHabits: reloadedHabits.length }));
            
            // Reload all stats to ensure everything is in sync
            await loadStats();
            
            setEditingHabit(null);
            setHabitName('');
          },
        },
      ]
    );
  };

  return (
    <PaperBackground>
      <ScrollView 
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.ink} />
        }
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* User Info */}
        <PaperCard style={styles.userCard}>
          <View style={styles.avatar}>
            <IconSymbol name="person.fill" size={32} color={Colors.ink} />
          </View>
          {username && <Text style={styles.username}>@{username}</Text>}
          <Text style={styles.email}>{user?.email}</Text>
        </PaperCard>

        {/* Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stats</Text>
          <View style={styles.statsRow}>
            <PaperCard style={styles.statCard}>
              <Text style={styles.statValue}>{stats.streak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
            </PaperCard>
            <PaperCard style={styles.statCard}>
              <Text style={styles.statValue}>{stats.thisMonthCompletion}%</Text>
              <Text style={styles.statLabel}>This Month</Text>
            </PaperCard>
            <PaperCard style={styles.statCard}>
              <Text style={styles.statValue}>{stats.totalEntries}</Text>
              <Text style={styles.statLabel}>Entries</Text>
            </PaperCard>
          </View>
        </View>

        {/* Habits */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { marginHorizontal: 0, marginBottom: 0 }]}>Your Habits ({habits.length})</Text>
            <TouchableOpacity 
              style={styles.editButton}
              onPress={() => handleOpenHabitModal()}
              activeOpacity={0.7}
            >
              <IconSymbol name="pencil" size={14} color={Colors.accent} />
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
          {habits.length > 0 ? (
            <View style={styles.habitsContainer}>
              {habits.map((habit) => (
                <TouchableOpacity 
                  key={habit.id} 
                  style={styles.habitChip}
                  onPress={() => handleOpenHabitModal(habit)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.habitChipText}>{habit.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity 
                style={styles.addHabitChip}
                onPress={() => handleOpenHabitModal()}
                activeOpacity={0.7}
              >
                <IconSymbol name="plus" size={14} color={Colors.accent} />
                <Text style={styles.addHabitChipText}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <PaperCard style={styles.emptyHabitsCard}>
              <IconSymbol name="sparkles" size={32} color={Colors.accent} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyHabitsText}>No habits yet</Text>
              <Text style={styles.emptyHabitsHint}>
                Start building your routine by adding habits to track
              </Text>
              <TouchableOpacity 
                style={styles.addFirstHabitButton}
                onPress={() => handleOpenHabitModal()}
                activeOpacity={0.7}
              >
                <IconSymbol name="plus" size={16} color={Colors.paper} />
                <Text style={styles.addFirstHabitText}>Add Your First Habit</Text>
              </TouchableOpacity>
            </PaperCard>
          )}
        </View>

        {/* Privacy & Encryption Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy & Encryption</Text>
          
          <PaperCard style={styles.privacyCard}>
            <View style={styles.privacyHeader}>
              <IconSymbol name="lock.fill" size={24} color={Colors.accent} />
              <Text style={styles.privacyTitle}>Encryption Enabled</Text>
            </View>
            <Text style={styles.privacyDesc}>
              Your data is encrypted using your account UUID. All entries, habits, and logs 
              are encrypted before syncing to the cloud. Only you can decrypt your data.
            </Text>
          </PaperCard>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <IconSymbol name="rectangle.portrait.and.arrow.right" size={20} color="#d32f2f" />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* Dev Tools Section */}
        {__DEV__ && (
          <View style={styles.devSection}>
            <Text style={styles.devTitle}>Developer Tools</Text>
            <TouchableOpacity
              style={styles.devButton}
              onPress={async () => {
                await resetOnboarding();
                router.replace('/onboarding/welcome' as Href);
              }}
              activeOpacity={0.7}
            >
              <IconSymbol name="arrow.clockwise" size={18} color={Colors.accent} />
              <Text style={styles.devButtonText}>Restart Onboarding</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.devButton, { marginTop: 8 }]}
              onPress={() => {
                Alert.alert(
                  'Clear All Data',
                  'This will delete all habits, entries, and logs from Supabase. Are you sure?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: async () => {
                        // Delete all data from Supabase
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                          await supabase.from('habits').delete().eq('owner_id', user.id);
                          await supabase.from('entries').delete().eq('owner_id', user.id);
                          await supabase.from('habit_logs').delete().eq('owner_id', user.id);
                        }
                        await resetOnboarding();
                        Alert.alert('Done', 'All data cleared. Restarting onboarding...');
                        router.replace('/onboarding/welcome' as Href);
                      },
                    },
                  ]
                );
              }}
              activeOpacity={0.7}
            >
              <IconSymbol name="trash" size={18} color="#d32f2f" />
              <Text style={[styles.devButtonText, { color: '#d32f2f' }]}>Clear All Data</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Habit Management Modal */}
      <Modal
        visible={showHabitModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={handleCloseModal}
      >
        <KeyboardAvoidingView 
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={handleCloseModal}>
              <Text style={styles.modalCancel}>Done</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingHabit ? 'Edit Habit' : 'Manage Habits'}
            </Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            {/* Add new habit form */}
            <View style={styles.addHabitSection}>
              <Text style={styles.formLabel}>
                {editingHabit ? 'Edit Habit Name' : 'Add New Habit'}
              </Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.habitInput}
                  value={habitName}
                  onChangeText={setHabitName}
                  placeholder="Enter habit name..."
                  placeholderTextColor={Colors.textSecondary}
                  maxLength={20}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={handleSaveHabit}
                />
                <TouchableOpacity
                  style={[
                    styles.addButton,
                    !habitName.trim() && styles.addButtonDisabled
                  ]}
                  onPress={handleSaveHabit}
                  activeOpacity={0.7}
                  disabled={!habitName.trim()}
                >
                  <IconSymbol 
                    name={editingHabit ? "checkmark" : "plus"} 
                    size={20} 
                    color={habitName.trim() ? Colors.paper : Colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.charCount}>{habitName.length}/20 characters</Text>

              {editingHabit && (
                <View style={styles.editActions}>
                  <TouchableOpacity
                    style={styles.deleteHabitButton}
                    onPress={() => handleDeleteHabit(editingHabit)}
                    activeOpacity={0.7}
                  >
                    <IconSymbol name="trash" size={16} color="#d32f2f" />
                    <Text style={styles.deleteHabitText}>Delete this habit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.backToListButton}
                    onPress={() => {
                      setEditingHabit(null);
                      setHabitName('');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.backToListText}>Back to list</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Existing habits list */}
            {!editingHabit && habits.length > 0 && (
              <View style={styles.existingHabitsSection}>
                <Text style={styles.formLabel}>Your Habits</Text>
                {habits.map((habit, index) => (
                  <TouchableOpacity
                    key={habit.id}
                    style={[
                      styles.habitListItem,
                      index === 0 && styles.habitListItemFirst,
                      index === habits.length - 1 && styles.habitListItemLast
                    ]}
                    onPress={() => handleOpenHabitModal(habit)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.habitListItemContent}>
                      <View style={styles.habitListItemIcon}>
                        <Text style={styles.habitEmoji}>
                          {getHabitEmoji(habit.name)}
                        </Text>
                      </View>
                      <Text style={styles.habitListItemName}>{habit.name}</Text>
                    </View>
                    <View style={styles.habitListItemActions}>
                      <TouchableOpacity
                        style={styles.habitActionButton}
                        onPress={() => handleOpenHabitModal(habit)}
                        activeOpacity={0.7}
                      >
                        <IconSymbol name="pencil" size={16} color={Colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.habitActionButton}
                        onPress={() => handleDeleteHabit(habit)}
                        activeOpacity={0.7}
                      >
                        <IconSymbol name="trash" size={16} color="#d32f2f" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Empty state */}
            {!editingHabit && habits.length === 0 && (
              <View style={styles.emptyModalState}>
                <IconSymbol name="sparkles" size={48} color={Colors.accent} />
                <Text style={styles.emptyModalTitle}>No habits yet</Text>
                <Text style={styles.emptyModalHint}>
                  Add your first habit above to start building your routine
                </Text>
              </View>
            )}

            {/* Suggestions */}
            {!editingHabit && (
              <View style={styles.suggestionsSection}>
                <Text style={styles.formLabel}>Popular Habits</Text>
                <View style={styles.suggestionsGrid}>
                  {['Exercise', 'Read', 'Meditate', 'Journal', 'Hydrate', 'Sleep 8h'].map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion}
                      style={[
                        styles.suggestionChip,
                        habits.some(h => h.name.toLowerCase() === suggestion.toLowerCase()) && styles.suggestionChipDisabled
                      ]}
                      onPress={() => {
                        if (!habits.some(h => h.name.toLowerCase() === suggestion.toLowerCase())) {
                          setHabitName(suggestion);
                        }
                      }}
                      activeOpacity={0.7}
                      disabled={habits.some(h => h.name.toLowerCase() === suggestion.toLowerCase())}
                    >
                      <Text style={[
                        styles.suggestionChipText,
                        habits.some(h => h.name.toLowerCase() === suggestion.toLowerCase()) && styles.suggestionChipTextDisabled
                      ]}>
                        {getHabitEmoji(suggestion)} {suggestion}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </PaperBackground>
  );
}

// Helper function to get emoji for habit
function getHabitEmoji(name: string): string {
  const lowName = name.toLowerCase();
  if (lowName.includes('exercise') || lowName.includes('workout') || lowName.includes('gym')) return '💪';
  if (lowName.includes('read')) return '📚';
  if (lowName.includes('meditat')) return '🧘';
  if (lowName.includes('journal') || lowName.includes('write')) return '✍️';
  if (lowName.includes('water') || lowName.includes('hydrat') || lowName.includes('drink')) return '💧';
  if (lowName.includes('sleep')) return '😴';
  if (lowName.includes('walk') || lowName.includes('run')) return '🏃';
  if (lowName.includes('eat') || lowName.includes('food') || lowName.includes('diet')) return '🥗';
  if (lowName.includes('study') || lowName.includes('learn')) return '📖';
  if (lowName.includes('code') || lowName.includes('program')) return '💻';
  if (lowName.includes('music') || lowName.includes('practice')) return '🎵';
  if (lowName.includes('stretch') || lowName.includes('yoga')) return '🤸';
  if (lowName.includes('clean')) return '🧹';
  if (lowName.includes('cook')) return '👨‍🍳';
  return '✨';
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  userCard: {
    marginHorizontal: 16,
    marginBottom: 24,
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.paper,
    borderWidth: 2,
    borderColor: Colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  username: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginHorizontal: 16,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  privacyCard: {
    marginHorizontal: 16,
    paddingVertical: 20,
  },
  privacyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  privacyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 8,
  },
  privacyDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent,
    gap: 4,
  },
  editButtonText: {
    fontSize: 12,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
  habitsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
  },
  habitChip: {
    backgroundColor: Colors.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.ink,
  },
  habitChipText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
  addHabitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
    gap: 4,
  },
  addHabitChipText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
  emptyHabitsCard: {
    marginHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyHabitsText: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyHabitsHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  addFirstHabitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    gap: 8,
  },
  addFirstHabitText: {
    fontSize: 14,
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderColor: '#d32f2f',
    borderRadius: 12,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#d32f2f',
    fontFamily: Fonts.handwriting,
    marginLeft: 8,
  },
  // Dev tools section
  devSection: {
    marginTop: 32,
    marginHorizontal: 16,
    padding: 16,
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: 'dashed',
  },
  devTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  devButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.paper,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  devButtonText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    marginLeft: 8,
    fontWeight: '500',
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
    fontWeight: '600',
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
  addHabitSection: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  habitInput: {
    flex: 1,
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
  addButton: {
    width: 52,
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: Colors.shadow,
  },
  charCount: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  editActions: {
    marginTop: 16,
    gap: 12,
  },
  deleteHabitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#d32f2f',
    borderRadius: 12,
    gap: 8,
  },
  deleteHabitText: {
    fontSize: 14,
    color: '#d32f2f',
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
  backToListButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backToListText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
  existingHabitsSection: {
    marginBottom: 24,
  },
  habitListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.shadow,
  },
  habitListItemFirst: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  habitListItemLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  habitListItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  habitListItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.paper,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  habitEmoji: {
    fontSize: 18,
  },
  habitListItemName: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
    flex: 1,
  },
  habitListItemActions: {
    flexDirection: 'row',
    gap: 8,
  },
  habitActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.paper,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  emptyModalState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyModalTitle: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
  emptyModalHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  suggestionsSection: {
    marginTop: 8,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.shadow,
  },
  suggestionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    backgroundColor: Colors.card,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  suggestionChipDisabled: {
    opacity: 0.4,
  },
  suggestionChipText: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  suggestionChipTextDisabled: {
    color: Colors.textSecondary,
  },
});
