import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image, Alert } from 'react-native';
import { PaperCard } from './ui/paper-card';
import { Colors, Fonts } from '@/constants/theme';
import { IconSymbol } from './ui/icon-symbol';
import { DailyEntry } from '@/lib/storage';
import * as ImagePicker from 'expo-image-picker';

interface HighlightInputProps {
  todayEntryCount: number; // How many entries exist for today
  onSave: (text: string, mediaUrls: string[]) => void;
}

const MAX_IMAGES = 4;
const MAX_ENTRIES_PER_DAY = 2;

export function HighlightInput({ todayEntryCount, onSave }: HighlightInputProps) {
  const [text, setText] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  
  const canAddEntry = todayEntryCount < MAX_ENTRIES_PER_DAY;

  const handleAddPhoto = async () => {
    if (mediaUrls.length >= MAX_IMAGES) {
      Alert.alert('Limit Reached', `You can only add up to ${MAX_IMAGES} photos per entry.`);
      return;
    }

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant camera roll permissions to add photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        selectionLimit: MAX_IMAGES - mediaUrls.length,
      });

      if (!result.canceled && result.assets) {
        const newUrls = result.assets.map((asset) => asset.uri);
        const totalImages = mediaUrls.length + newUrls.length;
        
        if (totalImages > MAX_IMAGES) {
          Alert.alert('Limit Reached', `You can only add up to ${MAX_IMAGES} photos. Only the first ${MAX_IMAGES - mediaUrls.length} will be added.`);
          setMediaUrls([...mediaUrls, ...newUrls.slice(0, MAX_IMAGES - mediaUrls.length)]);
        } else {
          setMediaUrls([...mediaUrls, ...newUrls]);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to add photo. Please try again.');
    }
  };

  const handleRemovePhoto = (index: number) => {
    setMediaUrls(mediaUrls.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!canAddEntry) {
      Alert.alert('Limit reached', 'You can only add 2 entries per day.');
      return;
    }
    if (text.trim() || mediaUrls.length > 0) {
      onSave(text.trim(), mediaUrls);
      setText('');
      setMediaUrls([]);
    }
  };

  // If limit reached, show message instead of input
  if (!canAddEntry) {
    return (
      <PaperCard style={styles.container}>
        <Text style={styles.title}>Highlight of the day</Text>
        <View style={styles.limitReached}>
          <IconSymbol name="checkmark.circle.fill" size={24} color={Colors.accent} />
          <Text style={styles.limitText}>You've added 2 entries today!</Text>
          <Text style={styles.limitHint}>Check the Feed to see them.</Text>
        </View>
      </PaperCard>
    );
  }

  return (
    <PaperCard style={styles.container}>
      <Text style={styles.title}>Highlight of the day</Text>
      <Text style={styles.placeholder}>
        {todayEntryCount === 0 
          ? 'Tell me something about today...' 
          : 'Add another highlight...'}
      </Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder=""
        multiline
        placeholderTextColor={Colors.textSecondary}
      />
      {mediaUrls.length > 0 && (
        <View style={styles.mediaPreviewContainer}>
          {mediaUrls.map((url, index) => (
            <View key={index} style={styles.mediaPreview}>
              <Image source={{ uri: url }} style={styles.previewImage} resizeMode="cover" />
              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemovePhoto(index)}
                activeOpacity={0.7}>
                <IconSymbol name="xmark.circle.fill" size={20} color={Colors.ink} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.mediaButton, mediaUrls.length >= MAX_IMAGES && styles.mediaButtonDisabled]}
          onPress={handleAddPhoto}
          disabled={mediaUrls.length >= MAX_IMAGES}
          activeOpacity={0.7}>
          <View style={styles.mediaButtonContent}>
            <IconSymbol
              name="camera.fill"
              size={18}
              color={mediaUrls.length >= MAX_IMAGES ? Colors.textSecondary : Colors.ink}
            />
            <Text
              style={[
                styles.mediaButtonText,
                mediaUrls.length >= MAX_IMAGES && styles.mediaButtonTextDisabled,
              ]}>
              Add Photo {mediaUrls.length > 0 && `(${mediaUrls.length}/${MAX_IMAGES})`}
            </Text>
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
  limitReached: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  limitText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginTop: 8,
    fontWeight: '500',
  },
  limitHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
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
  mediaPreviewContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 8,
  },
  mediaPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.shadow,
    position: 'relative',
    marginRight: 8,
    marginBottom: 8,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: Colors.paper,
    borderRadius: 12,
  },
  mediaButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.ink,
    backgroundColor: Colors.card,
  },
  mediaButtonDisabled: {
    borderColor: Colors.textSecondary,
    opacity: 0.5,
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
  mediaButtonTextDisabled: {
    color: Colors.textSecondary,
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