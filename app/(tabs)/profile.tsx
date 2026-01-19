import { useEffect, useState, useCallback } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  RefreshControl,
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
import { storage, Habit, HabitLog } from '@/lib/storage';
import { keyring, isKeyringUnlocked } from '@/lib/e2ee/keyring';
import { loadEncryptedHabits } from '@/lib/e2ee/encrypted-storage';
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
  
  // Privacy password state
  const [hasPrivacyPassword, setHasPrivacyPassword] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'setup' | 'unlock'>('setup');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

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
      checkKeyringStatus(),
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
    const [loadedHabits, entries, allLogs] = await Promise.all([
      loadEncryptedHabits(),
      storage.getDailyEntries(),
      storage.getAllHabitLogs(),
    ]);
    
    setHabits(loadedHabits);
    
    // Calculate streak (consecutive days with at least one habit completed)
    const streak = calculateStreak(loadedHabits, allLogs);
    
    // Calculate this month's completion rate
    const thisMonthCompletion = calculateMonthCompletion(loadedHabits, allLogs);
    
    setStats({
      totalHabits: loadedHabits.length,
      totalEntries: entries.length,
      streak,
      thisMonthCompletion,
    });
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

  const checkKeyringStatus = async () => {
    if (!user) return;
    
    // Check if profile has wrapped key
    const { data: profile } = await supabase
      .from('profiles')
      .select('wrapped_master_key')
      .eq('id', user.id)
      .single();
    
    setHasPrivacyPassword(!!profile?.wrapped_master_key);
    setIsUnlocked(isKeyringUnlocked());
  };

  const handleSetupPassword = () => {
    setPasswordMode('setup');
    setPassword('');
    setConfirmPassword('');
    setShowPasswordModal(true);
  };

  const handleUnlockPassword = () => {
    setPasswordMode('unlock');
    setPassword('');
    setShowPasswordModal(true);
  };

  const handlePasswordSubmit = async () => {
    if (passwordMode === 'setup') {
      if (password.length < 8) {
        Alert.alert('Weak password', 'Password must be at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert('Mismatch', 'Passwords do not match.');
        return;
      }
      
      setPasswordLoading(true);
      try {
        await keyring.setupMasterKey(password);
        setHasPrivacyPassword(true);
        setIsUnlocked(true);
        setShowPasswordModal(false);
        Alert.alert(
          'Privacy password set',
          'Your data is now encrypted. Remember this password - if you forget it, your data cannot be recovered!'
        );
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to set up encryption.');
      } finally {
        setPasswordLoading(false);
      }
    } else {
      // Unlock mode
      setPasswordLoading(true);
      try {
        await keyring.unlock(password);
        setIsUnlocked(true);
        setShowPasswordModal(false);
      } catch (err: any) {
        Alert.alert('Wrong password', 'Please try again.');
      } finally {
        setPasswordLoading(false);
      }
    }
  };

  const handleLock = () => {
    keyring.lock();
    setIsUnlocked(false);
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
            keyring.lock();
            await signOut();
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
          <Text style={styles.sectionTitle}>Your Habits ({habits.length})</Text>
          {habits.length > 0 ? (
            <View style={styles.habitsContainer}>
              {habits.map((habit) => (
                <View key={habit.id} style={styles.habitChip}>
                  <Text style={styles.habitChipText}>{habit.name}</Text>
                </View>
              ))}
            </View>
          ) : (
            <PaperCard style={styles.emptyHabitsCard}>
              <Text style={styles.emptyHabitsText}>No habits yet</Text>
              <Text style={styles.emptyHabitsHint}>
                Add habits from the Tracker tab
              </Text>
            </PaperCard>
          )}
        </View>

        {/* Privacy Password Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy & Encryption</Text>
          
          <PaperCard style={styles.privacyCard}>
            {!hasPrivacyPassword ? (
              <>
                <View style={styles.privacyHeader}>
                  <IconSymbol name="lock.fill" size={24} color={Colors.ink} />
                  <Text style={styles.privacyTitle}>Set up encryption</Text>
                </View>
                <Text style={styles.privacyDesc}>
                  Create a privacy password to encrypt your journal entries and photos. 
                  Only you will be able to read them.
                </Text>
                <TouchableOpacity
                  style={styles.privacyButton}
                  onPress={handleSetupPassword}
                  activeOpacity={0.7}
                >
                  <Text style={styles.privacyButtonText}>Set Privacy Password</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.privacyHeader}>
                  <IconSymbol 
                    name={isUnlocked ? 'lock.open.fill' : 'lock.fill'} 
                    size={24} 
                    color={isUnlocked ? Colors.accent : Colors.ink} 
                  />
                  <Text style={styles.privacyTitle}>
                    {isUnlocked ? 'Encryption unlocked' : 'Encryption locked'}
                  </Text>
                </View>
                <Text style={styles.privacyDesc}>
                  {isUnlocked 
                    ? 'Your data is encrypted and accessible.' 
                    : 'Enter your privacy password to access encrypted data.'}
                </Text>
                <TouchableOpacity
                  style={styles.privacyButton}
                  onPress={isUnlocked ? handleLock : handleUnlockPassword}
                  activeOpacity={0.7}
                >
                  <Text style={styles.privacyButtonText}>
                    {isUnlocked ? 'Lock now' : 'Unlock'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </PaperCard>
          
          <Text style={styles.warning}>
            If you forget your privacy password, your encrypted data cannot be recovered.
          </Text>
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
                  'This will delete all habits, entries, and logs. Are you sure?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: async () => {
                        await storage.clearAll();
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

      {/* Password Modal */}
      <Modal
        visible={showPasswordModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {passwordMode === 'setup' ? 'Set Privacy Password' : 'Unlock'}
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <View style={styles.modalContent}>
            <Text style={styles.modalLabel}>
              {passwordMode === 'setup' ? 'Create a strong password' : 'Enter your password'}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry
              autoFocus
            />

            {passwordMode === 'setup' && (
              <TextInput
                style={styles.modalInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Confirm password"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry
              />
            )}

            <TouchableOpacity
              style={[styles.modalButton, passwordLoading && styles.buttonDisabled]}
              onPress={handlePasswordSubmit}
              disabled={passwordLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.modalButtonText}>
                {passwordLoading 
                  ? 'Processing...' 
                  : passwordMode === 'setup' 
                    ? 'Set Password' 
                    : 'Unlock'}
              </Text>
            </TouchableOpacity>

            {passwordMode === 'setup' && (
              <Text style={styles.modalHint}>
                Use at least 8 characters. This password encrypts your data locally - 
                Supabase never sees it.
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </PaperBackground>
  );
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
  privacyButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  privacyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  warning: {
    fontSize: 12,
    color: '#d32f2f',
    fontFamily: Fonts.handwriting,
    marginHorizontal: 16,
    marginTop: 12,
    fontStyle: 'italic',
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
  emptyHabitsCard: {
    marginHorizontal: 16,
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyHabitsText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 4,
  },
  emptyHabitsHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
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
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  modalContent: {
    padding: 24,
  },
  modalLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 16,
  },
  modalInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 16,
  },
  modalButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  modalHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 16,
    lineHeight: 18,
  },
});
