import { PaperBackground } from '@/components/ui/paper-background';
import { Colors, Fonts } from '@/constants/theme';
import { DailyEntry, storage } from '@/lib/storage';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DailyEntry[]>([]);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    const allEntries = await storage.getDailyEntries();
    const sorted = allEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setEntries(sorted);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  return (
    <PaperBackground>
      <ScrollView style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <Text style={styles.title}>Feed</Text>
        </View>
        {entries.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No journal entries yet</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={styles.entryCard}>
              <Text style={styles.date}>{formatDate(entry.date)}</Text>
              {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
              {entry.mediaUrls && entry.mediaUrls.length > 0 && (
                <View style={styles.mediaContainer}>
                  {entry.mediaUrls.map((url, index) => (
                    <Image
                      key={index}
                      source={{ uri: url }}
                      style={[
                        styles.image,
                        entry.mediaUrls.length === 1 ? styles.singleImage : styles.multiImage,
                      ]}
                      resizeMode="cover"
                    />
                  ))}
                </View>
              )}
            </View>
          ))
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
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  entryCard: {
    marginHorizontal: 16,
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.shadow,
  },
  date: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 12,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
  },
  text: {
    fontSize: 16,
    color: Colors.ink,
    lineHeight: 26,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  mediaContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginHorizontal: -4,
  },
  image: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.shadow,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  singleImage: {
    width: '100%',
    height: 250,
  },
  multiImage: {
    width: '48%',
    height: 180,
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
  },
});