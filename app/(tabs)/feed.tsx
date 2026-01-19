import { PaperBackground } from '@/components/ui/paper-background';
import { FeedEntryCard } from '@/components/feed-entry-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts } from '@/constants/theme';
import { DailyEntry } from '@/lib/storage';
import { loadEncryptedEntriesForMonth } from '@/lib/e2ee/encrypted-storage';
import { useEffect, useState, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, RefreshControl, Animated, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  useEffect(() => {
    loadEntries();
  }, [currentMonth, currentYear]);

  useEffect(() => {
    // Fade in animation for entries
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [entries]);

  const loadEntries = async () => {
    // Load from encrypted cloud storage if unlocked, otherwise local
    const monthEntries = await loadEncryptedEntriesForMonth(currentYear, currentMonth);
    const sorted = monthEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEntries(sorted);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEntries();
    setRefreshing(false);
  };

  const changeMonth = (direction: number) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  };

  return (
    <PaperBackground>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.ink} />
        }>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>Feed</Text>
            <View style={styles.titleUnderline} />
          </View>
        </View>

        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navButton}>
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{monthName}</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.navButton}>
            <IconSymbol name="chevron.right" size={24} color={Colors.ink} />
          </TouchableOpacity>
        </View>

        {entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No journal entries yet</Text>
            <Text style={styles.emptyHint}>
              Start writing on the Tracker tab
            </Text>
          </View>
        ) : (
          <Animated.View style={[styles.entriesContainer, { opacity: fadeAnim }]}>
            {entries.map((entry) => (
              <View key={entry.id} style={styles.entryWrapper}>
                <Text style={styles.date}>{formatDate(entry.date)}</Text>
                <FeedEntryCard entry={entry} />
              </View>
            ))}
          </Animated.View>
        )}
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
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleContainer: {
    position: 'relative',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    letterSpacing: 1,
  },
  titleUnderline: {
    position: 'absolute',
    bottom: -4,
    left: 0,
    right: -8,
    height: 3,
    backgroundColor: Colors.accent,
    borderRadius: 2,
    opacity: 0.6,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 8,
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
  entriesContainer: {
    paddingHorizontal: 16,
  },
  entryWrapper: {
    marginBottom: 24,
  },
  date: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
  },
  emptyContainer: {
    marginHorizontal: 16,
    marginTop: 32,
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 16,
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
