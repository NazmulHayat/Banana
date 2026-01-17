import { PaperBackground } from '@/components/ui/paper-background';
import { PaperCard } from '@/components/ui/paper-card';
import { Colors, Fonts } from '@/constants/theme';
import { storage } from '@/lib/storage';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function ProfileScreen() {
  const [stats, setStats] = useState({
    totalHabits: 0,
    totalEntries: 0,
    streak: 7,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    const [habits, entries] = await Promise.all([
      storage.getHabits(),
      storage.getDailyEntries(),
    ]);
    setStats({
      totalHabits: habits.length,
      totalEntries: entries.length,
      streak: 7,
    });
  };

  return (
    <PaperBackground>
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>
        <PaperCard style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalHabits}</Text>
          <Text style={styles.statLabel}>Total Habits</Text>
        </PaperCard>
        <PaperCard style={styles.statCard}>
          <Text style={styles.statValue}>{stats.streak}</Text>
          <Text style={styles.statLabel}>Day Streak</Text>
        </PaperCard>
        <PaperCard style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalEntries}</Text>
          <Text style={styles.statLabel}>Journal Entries</Text>
        </PaperCard>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  statCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
    paddingVertical: 24,
  },
  statValue: {
    fontSize: 32,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});