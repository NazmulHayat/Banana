import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { PaperCard } from './ui/paper-card';
import { Colors, Fonts } from '@/constants/theme';
import { IconSymbol } from './ui/icon-symbol';
import { DailyEntry } from '@/lib/storage';

interface HighlightInputProps {
  entry: DailyEntry | null;
  onSave: (text: string, mediaUrls: string[]) => void;
}

export function HighlightInput({ entry, onSave }: HighlightInputProps) {
  const [text, setText] = useState(entry?.text || '');
  const [mediaUrls, setMediaUrls] = useState<string[]>(entry?.mediaUrls || []);

  const handleSave = () => {
    if (text.trim() || mediaUrls.length > 0) {
      onSave(text.trim(), mediaUrls);
      if (!entry) {
        setText('');
        setMediaUrls([]);
      }
    }
  };

  return (
    <PaperCard style={styles.container}>
      <Text style={styles.title}>Highlight of the day</Text>
      <Text style={styles.placeholder}>Tell me something about today...</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder=""
        multiline
        placeholderTextColor={Colors.textSecondary}
      />
      <View style={styles.footer}>
        <TouchableOpacity style={styles.mediaButton} activeOpacity={0.7}>
          <View style={styles.mediaButtonContent}>
            <IconSymbol name="camera.fill" size={18} color={Colors.ink} />
            <Text style={styles.mediaButtonText}>Add Photo</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.7}>
          <View style={styles.saveButtonContent}>
            <Text style={styles.saveButtonText}>Add</Text>
            <IconSymbol name="checkmark.circle.fill" size={20} color={Colors.ink} />
          </View>
        </TouchableOpacity>
      </View>
    </PaperCard>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.ink,
    marginBottom: 4,
    fontFamily: Fonts.handwriting,
  },
  placeholder: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
    fontFamily: Fonts.handwriting,
    fontStyle: 'italic',
  },
  input: {
    fontSize: 16,
    color: Colors.ink,
    minHeight: 60,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mediaButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.ink,
    backgroundColor: Colors.card,
  },
  mediaButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mediaButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
    marginLeft: 6,
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.ink,
    backgroundColor: Colors.card,
  },
  saveButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
});