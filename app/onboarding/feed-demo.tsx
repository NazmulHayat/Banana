import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PaperBackground } from '@/components/ui/paper-background';
import { PaperCard } from '@/components/ui/paper-card';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts } from '@/constants/theme';
import { useOnboarding } from '@/lib/onboarding-context';
import { DailyEntry, saveEntry, waitForAuth } from '@/lib/db';

const { width, height } = Dimensions.get('window');

const DEFAULT_ENTRY_TEXT = 'Started a new journey of tracking my habits! Here we go 🍌';

type Stage = 'intro' | 'input' | 'saving' | 'feed';

export default function FeedDemoScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useOnboarding();
  const [stage, setStage] = useState<Stage>('intro');
  const [journalText, setJournalText] = useState(DEFAULT_ENTRY_TEXT);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const inputFade = useRef(new Animated.Value(0)).current;
  const inputSlide = useRef(new Animated.Value(20)).current;
  const savingScale = useRef(new Animated.Value(0)).current;
  const feedTransition = useRef(new Animated.Value(0)).current;
  const cardEntrance = useRef(new Animated.Value(0)).current;
  const buttonFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Initial fade in
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Show input area after intro
      setTimeout(() => {
        setStage('input');
        Animated.parallel([
          Animated.timing(inputFade, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(inputSlide, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start();
      }, 600);
    });
  }, []);

  const handleSave = async () => {
    if (!journalText.trim()) return;

    setStage('saving');
    
    // Wait for auth to be ready before saving
    console.log('[FeedDemo] Waiting for auth before saving entry...');
    const isReady = await waitForAuth();
    if (!isReady) {
      console.error('[FeedDemo] Auth not ready, cannot save entry');
      setStage('input');
      return;
    }
    
    // Save the entry with today's date
    const entry: DailyEntry = {
      id: 'onboarding-' + Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      text: journalText.trim(),
      mediaUrls: [],
      createdAt: new Date().toISOString(),
    };
    console.log('[FeedDemo] Saving entry...');
    await saveEntry(entry);
    console.log('[FeedDemo] Entry saved');
    
    // Saving animation
    Animated.sequence([
      Animated.spring(savingScale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.delay(1000),
    ]).start(() => {
      // Transition to feed view
      setStage('feed');
      Animated.parallel([
        Animated.timing(feedTransition, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(cardEntrance, {
          toValue: 1,
          friction: 6,
          delay: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Show finish button
        Animated.timing(buttonFade, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      });
    });
  };

  const handleFinish = async () => {
    // Mark onboarding as complete
    await completeOnboarding();
    
    // Navigate to feed to show their saved entry
    router.replace('/(tabs)/feed' as Href);
  };

  const handleSkip = async () => {
    await completeOnboarding();
    router.replace('/(tabs)' as Href);
  };

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.container, { paddingTop: insets.top + 20 }]}>
          {/* Intro/Input Stage */}
          {(stage === 'intro' || stage === 'input') && (
            <View style={styles.introContainer}>
              <Animated.View
                style={[
                  styles.header,
                  {
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                  },
                ]}
              >
                <Text style={styles.title}>One more thing...</Text>
                <Text style={styles.subtitle}>
                  Each day, capture a highlight or thought. These entries become your personal Feed - a timeline of your journey.
                </Text>
              </Animated.View>

              {/* Input area */}
              <Animated.View
                style={[
                  styles.inputContainer,
                  {
                    opacity: inputFade,
                    transform: [{ translateY: inputSlide }],
                  },
                ]}
              >
                <Text style={styles.inputLabel}>Here's your first entry:</Text>
                <View style={styles.inputBox}>
                  <TextInput
                    style={styles.textInput}
                    value={journalText}
                    onChangeText={setJournalText}
                    placeholder="What's on your mind today?"
                    placeholderTextColor={Colors.textSecondary}
                    multiline
                    textAlignVertical="top"
                  />
                </View>

                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    !journalText.trim() && styles.saveButtonDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={!journalText.trim()}
                  activeOpacity={0.7}
                >
                  <IconSymbol name="arrow.right" size={20} color={Colors.paper} />
                  <Text style={styles.saveButtonText}>Save to Feed</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={handleSkip}
                  activeOpacity={0.7}
                >
                  <Text style={styles.skipButtonText}>Skip for now</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}

          {/* Saving animation */}
          {stage === 'saving' && (
            <View style={styles.savingContainer}>
              <Animated.View
                style={[
                  styles.savingCircle,
                  {
                    transform: [{ scale: savingScale }],
                  },
                ]}
              >
                <IconSymbol name="checkmark" size={40} color={Colors.paper} />
              </Animated.View>
              <Text style={styles.savingText}>Saved!</Text>
              <Text style={styles.savingSubtext}>See how it looks in your Feed...</Text>
            </View>
          )}

          {/* Feed demo view */}
          {stage === 'feed' && (
            <Animated.View
              style={[
                styles.feedContainer,
                {
                  opacity: feedTransition,
                },
              ]}
            >
              <View style={styles.feedHeader}>
                <Text style={styles.feedTitle}>Feed</Text>
                <View style={styles.feedTitleUnderline} />
              </View>

              <Text style={styles.feedDate}>
                {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
              </Text>

              <Animated.View
                style={[
                  styles.feedCardContainer,
                  {
                    opacity: cardEntrance,
                    transform: [
                      {
                        translateY: cardEntrance.interpolate({
                          inputRange: [0, 1],
                          outputRange: [50, 0],
                        }),
                      },
                      {
                        scale: cardEntrance.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.9, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <PaperCard style={styles.feedCard}>
                  <Text style={styles.feedCardText}>{journalText}</Text>
                </PaperCard>
              </Animated.View>

              <Animated.View
                style={[
                  styles.feedExplanation,
                  { opacity: buttonFade },
                ]}
              >
                <Text style={styles.feedExplanationText}>
                  Your entries will appear here, creating a timeline of your journey.
                </Text>
              </Animated.View>
            </Animated.View>
          )}

          {/* Bottom section */}
          <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + 20 }]}>
            {stage === 'feed' && (
              <Animated.View style={{ opacity: buttonFade }}>
                <TouchableOpacity
                  style={styles.finishButton}
                  onPress={handleFinish}
                  activeOpacity={0.7}
                >
                  <Text style={styles.finishButtonText}>Start tracking</Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* Progress indicator */}
            <View style={styles.progressContainer}>
              <View style={styles.progressDot} />
              <View style={styles.progressDot} />
              <View style={[styles.progressDot, styles.progressDotActive]} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  introContainer: {
    flex: 1,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
  },
  inputContainer: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inputBox: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
    marginBottom: 20,
  },
  textInput: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 28,
    flex: 1,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.ink,
    paddingVertical: 18,
    borderRadius: 30,
    gap: 10,
    marginBottom: 16,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  savingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  savingCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  savingText: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  savingSubtext: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  feedContainer: {
    flex: 1,
  },
  feedHeader: {
    marginBottom: 24,
  },
  feedTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  feedTitleUnderline: {
    position: 'absolute',
    bottom: -4,
    left: 0,
    width: 60,
    height: 3,
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  feedDate: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  feedCardContainer: {
    marginBottom: 24,
  },
  feedCard: {
    marginHorizontal: 0,
  },
  feedCardText: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 28,
  },
  feedExplanation: {
    alignItems: 'center',
  },
  feedExplanationText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    lineHeight: 22,
  },
  bottomContainer: {
    paddingTop: 16,
  },
  finishButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 16,
  },
  finishButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  progressContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.shadow,
  },
  progressDotActive: {
    backgroundColor: Colors.ink,
    width: 24,
  },
});
