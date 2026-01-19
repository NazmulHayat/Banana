import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { PaperBackground } from '@/components/ui/paper-background';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { HabitCell } from '@/components/ui/habit-cell';
import { Colors, Fonts } from '@/constants/theme';
import { Habit } from '@/lib/storage';
import { saveEncryptedHabits } from '@/lib/e2ee/encrypted-storage';

const { width, height } = Dimensions.get('window');

// Calculate cell size to fill screen width (6 columns: 1 day + 5 habits)
const GRID_PADDING = 8; // horizontal padding on each side
const CELL_GAP = 2; // gap between cells
const NUM_COLUMNS = 6;
const CALCULATED_CELL_SIZE = Math.floor((width - (GRID_PADDING * 2) - (CELL_GAP * (NUM_COLUMNS - 1))) / NUM_COLUMNS);

const HABIT_SUGGESTIONS = [
  { name: 'Exercise', emoji: '💪' },
  { name: 'Read', emoji: '📚' },
  { name: 'Meditate', emoji: '🧘' },
  { name: 'Journal', emoji: '✍️' },
  { name: 'Hydrate', emoji: '💧' },
  { name: 'Sleep 8hrs', emoji: '😴' },
  { name: 'No phone', emoji: '📵' },
  { name: 'Walk', emoji: '🚶' },
  { name: 'Stretch', emoji: '🤸' },
  { name: 'Vitamins', emoji: '💊' },
];

// Demo habits for the preview animation
const DEMO_HABITS = ['Exercise', 'Read', 'Meditate', 'Hydrate', 'Sleep'];

// Generate realistic demo data - just enough to show the concept
const generateRealisticMonth = () => {
  const days = 18; // Fewer days - just enough to show the effect
  const patterns: boolean[][] = [];
  
  for (let day = 0; day < days; day++) {
    const dayOfWeek = day % 7;
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
    const isEarlyWeek = day < 7;
    
    const row: boolean[] = [
      // Exercise - 75% consistent, worse on weekends
      isWeekend ? Math.random() > 0.5 : Math.random() > 0.25,
      // Read - 85% consistent
      Math.random() > 0.15,
      // Meditate - builds up over time
      isEarlyWeek ? Math.random() > 0.5 : Math.random() > 0.2,
      // Hydrate - consistent
      Math.random() > 0.25,
      // Sleep - weekends are harder
      isWeekend ? Math.random() > 0.6 : Math.random() > 0.25,
    ];
    patterns.push(row);
  }
  
  return patterns;
};

const DEMO_DATA = generateRealisticMonth();

type Stage = 'demo' | 'transition' | 'select';

export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('demo');
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [customHabit, setCustomHabit] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Demo animation refs
  const demoScrollRef = useRef<ScrollView>(null);
  const demoFade = useRef(new Animated.Value(0)).current;
  const demoTitleFade = useRef(new Animated.Value(0)).current;
  const transitionFade = useRef(new Animated.Value(0)).current;
  const transitionSlide = useRef(new Animated.Value(30)).current;

  // Selection stage animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const previewFade = useRef(new Animated.Value(0)).current;
  const previewSlide = useRef(new Animated.Value(50)).current;
  const suggestionsStagger = useRef(
    HABIT_SUGGESTIONS.map(() => new Animated.Value(0))
  ).current;

  useEffect(() => {
    // Start with demo animation
    Animated.parallel([
      Animated.timing(demoFade, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(demoTitleFade, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Quick start scrolling
      setTimeout(() => {
        startDemoScroll();
      }, 600);
    });
  }, []);

  const startDemoScroll = () => {
    // Short smooth scroll - just enough to show the concept
    const scrollDuration = 3000;
    const rowHeight = cellSize + CELL_GAP;
    // Only scroll through about 8-10 rows - just to show movement
    const scrollDistance = rowHeight * 8;
    
    let startTime: number;
    const animateScroll = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = (timestamp - startTime) / scrollDuration;
      
      if (progress < 1 && demoScrollRef.current) {
        // Smooth ease-in-out for more natural feel
        const easeProgress = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const scrollY = easeProgress * scrollDistance;
        demoScrollRef.current.scrollTo({ y: scrollY, animated: false });
        requestAnimationFrame(animateScroll);
      } else {
        // Demo complete - quick transition
        setTimeout(() => {
          transitionToSelect();
        }, 500);
      }
    };
    
    requestAnimationFrame(animateScroll);
  };

  const transitionToSelect = () => {
    setStage('transition');
    
    // Quick fade out demo - 400ms
    Animated.timing(demoFade, {
      toValue: 0,
      duration: 400,
      useNativeDriver: true,
    }).start(() => {
      // Show transition message
      Animated.parallel([
        Animated.timing(transitionFade, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(transitionSlide, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Wait 1.2 seconds on transition message, then move to selection
        setTimeout(() => {
          Animated.timing(transitionFade, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }).start(() => {
            setStage('select');
            showSelectionUI();
          });
        }, 1200);
      });
    });
  };

  const showSelectionUI = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    // Stagger suggestion pills
    Animated.stagger(
      60,
      suggestionsStagger.map((anim) =>
        Animated.spring(anim, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        })
      )
    ).start();
  };

  useEffect(() => {
    // Show preview when habits are selected
    if (selectedHabits.length > 0 && !showPreview && stage === 'select') {
      setShowPreview(true);
      Animated.parallel([
        Animated.timing(previewFade, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(previewSlide, {
          toValue: 0,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [selectedHabits, stage]);

  const toggleHabit = (habitName: string) => {
    setSelectedHabits((prev) =>
      prev.includes(habitName)
        ? prev.filter((h) => h !== habitName)
        : [...prev, habitName]
    );
  };

  const addCustomHabit = () => {
    const name = customHabit.trim();
    if (name && !selectedHabits.includes(name) && name.length <= 20) {
      setSelectedHabits((prev) => [...prev, name]);
      setCustomHabit('');
    }
  };

  const handleContinue = async () => {
    if (selectedHabits.length === 0) return;

    const habits: Habit[] = selectedHabits.map((name, index) => ({
      id: Date.now().toString() + index,
      name,
      createdAt: new Date().toISOString(),
    }));

    await saveEncryptedHabits(habits);
    router.push('/onboarding/feed-demo' as Href);
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cellSize = CALCULATED_CELL_SIZE;

  // Demo stage - show animated month view with actual HabitCell component
  if (stage === 'demo') {
    return (
      <PaperBackground>
        <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
          <Animated.View style={[styles.demoHeader, { opacity: demoTitleFade }]}>
            <Text style={styles.demoTitle}>Imagine tracking your habits</Text>
            <Text style={styles.demoSubtitle}>Day by day, building momentum...</Text>
          </Animated.View>

          <Animated.View style={[styles.demoContainer, { opacity: demoFade }]}>
            <View style={styles.demoGridWrapper}>
              {/* Fixed header row */}
              <View style={styles.demoHeaderRow}>
                <View style={[styles.demoDayHeaderCell, { width: cellSize, height: cellSize }]}>
                  <Text style={styles.demoDayLabel}>DAY</Text>
                </View>
                {DEMO_HABITS.map((habit) => (
                  <View key={habit} style={[styles.demoHabitHeader, { width: cellSize, height: cellSize }]}>
                    <Text style={styles.demoHabitName} numberOfLines={2} adjustsFontSizeToFit>
                      {habit}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Scrollable content with fade overlay */}
              <View style={styles.demoScrollContainer}>
                <ScrollView
                  ref={demoScrollRef}
                  style={styles.demoScroll}
                  showsVerticalScrollIndicator={false}
                  scrollEnabled={false}
                >
                  {DEMO_DATA.map((row, dayIndex) => (
                    <View key={dayIndex} style={styles.demoRow}>
                      <View style={[styles.demoDayCell, { width: cellSize, height: cellSize }]}>
                        <Text style={styles.demoDayName}>
                          {dayNames[dayIndex % 7]}
                        </Text>
                        <Text style={styles.demoDayNumber}>{dayIndex + 1}</Text>
                      </View>
                      {row.map((completed, habitIndex) => (
                        <View 
                          key={habitIndex} 
                          style={[styles.demoCellWrapper, { width: cellSize, height: cellSize }]}
                        >
                          <HabitCell
                            completed={completed}
                            onPress={() => {}}
                            size={cellSize}
                          />
                        </View>
                      ))}
                    </View>
                  ))}
                </ScrollView>
                
                {/* Bottom fade gradient - professional edge blur effect */}
                <LinearGradient
                  colors={[`${Colors.paper}00`, `${Colors.paper}40`, `${Colors.paper}CC`, Colors.paper]}
                  locations={[0, 0.3, 0.7, 1]}
                  style={styles.bottomFadeGradient}
                  pointerEvents="none"
                />
              </View>
            </View>
          </Animated.View>

          {/* Progress indicator */}
          <View style={[styles.progressContainer, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.progressDot} />
            <View style={[styles.progressDot, styles.progressDotActive]} />
            <View style={styles.progressDot} />
          </View>
        </View>
      </PaperBackground>
    );
  }

  // Transition stage - "You can do just the same"
  if (stage === 'transition') {
    return (
      <PaperBackground>
        <View style={[styles.container, styles.centerContent, { paddingTop: insets.top }]}>
          <Animated.View
            style={[
              styles.transitionContainer,
              {
                opacity: transitionFade,
                transform: [{ translateY: transitionSlide }],
              },
            ]}
          >
            <Text style={styles.transitionText}>You can build this too.</Text>
            <Text style={styles.transitionSubtext}>Let's get started.</Text>
          </Animated.View>
        </View>
      </PaperBackground>
    );
  }

  // Selection stage
  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 100 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Animated.View
            style={[
              styles.header,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <Text style={styles.title}>What do you want to track?</Text>
            <Text style={styles.subtitle}>
              Start simple. Pick a few habits that matter to you.
            </Text>
          </Animated.View>

          {/* Suggestion pills */}
          <View style={styles.suggestionsContainer}>
            {HABIT_SUGGESTIONS.map((habit, index) => {
              const isSelected = selectedHabits.includes(habit.name);
              return (
                <Animated.View
                  key={habit.name}
                  style={{
                    opacity: suggestionsStagger[index],
                    transform: [
                      {
                        scale: suggestionsStagger[index].interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.5, 1],
                        }),
                      },
                    ],
                  }}
                >
                  <TouchableOpacity
                    style={[
                      styles.suggestionPill,
                      isSelected && styles.suggestionPillSelected,
                    ]}
                    onPress={() => toggleHabit(habit.name)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionEmoji}>{habit.emoji}</Text>
                    <Text
                      style={[
                        styles.suggestionText,
                        isSelected && styles.suggestionTextSelected,
                      ]}
                    >
                      {habit.name}
                    </Text>
                    {isSelected && (
                      <IconSymbol name="checkmark" size={16} color={Colors.paper} />
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>

          {/* Custom habit input */}
          <View style={styles.customInputContainer}>
            <Text style={styles.customLabel}>Or add your own:</Text>
            <View style={styles.customInputRow}>
              <TextInput
                style={styles.customInput}
                value={customHabit}
                onChangeText={setCustomHabit}
                placeholder="Your habit..."
                placeholderTextColor={Colors.textSecondary}
                maxLength={20}
                onSubmitEditing={addCustomHabit}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[
                  styles.addButton,
                  !customHabit.trim() && styles.addButtonDisabled,
                ]}
                onPress={addCustomHabit}
                disabled={!customHabit.trim()}
              >
                <IconSymbol name="plus" size={20} color={Colors.paper} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Mini preview of selected habits */}
          {showPreview && (
            <Animated.View
              style={[
                styles.miniPreview,
                {
                  opacity: previewFade,
                  transform: [{ translateY: previewSlide }],
                },
              ]}
            >
              <Text style={styles.miniPreviewLabel}>Your habits:</Text>
              <View style={styles.miniPreviewChips}>
                {selectedHabits.map((habit) => (
                  <View key={habit} style={styles.miniPreviewChip}>
                    <Text style={styles.miniPreviewChipText}>{habit}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* Fixed bottom button */}
        <View
          style={[
            styles.bottomContainer,
            { paddingBottom: insets.bottom + 20 },
          ]}
        >
          <View style={styles.selectedCount}>
            <Text style={styles.selectedCountText}>
              {selectedHabits.length} habit{selectedHabits.length !== 1 ? 's' : ''} selected
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.continueButton,
              selectedHabits.length === 0 && styles.continueButtonDisabled,
            ]}
            onPress={handleContinue}
            disabled={selectedHabits.length === 0}
            activeOpacity={0.7}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
          </TouchableOpacity>

          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <View style={styles.progressDot} />
            <View style={[styles.progressDot, styles.progressDotActive]} />
            <View style={styles.progressDot} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    paddingHorizontal: 24,
  },
  // Demo stage styles
  demoHeader: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  demoTitle: {
    fontSize: 26,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    marginBottom: 8,
  },
  demoSubtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
  },
  demoContainer: {
    flex: 1,
    paddingHorizontal: GRID_PADDING,
  },
  demoGridWrapper: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  demoHeaderRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  demoDayHeaderCell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.ink,
    marginRight: 2,
    backgroundColor: 'transparent',
  },
  demoDayLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  demoHabitHeader: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.ink,
    marginRight: 2,
    paddingHorizontal: 2,
    backgroundColor: 'transparent',
  },
  demoHabitName: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
  },
  demoScrollContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  demoScroll: {
    flex: 1,
  },
  bottomFadeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  demoRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  demoDayCell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.ink,
    marginRight: 2,
    backgroundColor: 'transparent',
  },
  demoDayName: {
    fontSize: 8,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    fontWeight: '700',
  },
  demoDayNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  demoCellWrapper: {
    marginRight: 2,
  },
  // Transition stage styles
  transitionContainer: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  transitionText: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    marginBottom: 12,
  },
  transitionSubtext: {
    fontSize: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
  },
  // Selection stage styles
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
  },
  suggestionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    gap: 8,
  },
  suggestionPillSelected: {
    backgroundColor: Colors.ink,
  },
  suggestionEmoji: {
    fontSize: 18,
  },
  suggestionText: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
  suggestionTextSelected: {
    color: Colors.paper,
  },
  customInputContainer: {
    marginBottom: 32,
  },
  customLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  customInputRow: {
    flexDirection: 'row',
    gap: 12,
  },
  customInput: {
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
    opacity: 0.4,
  },
  miniPreview: {
    marginBottom: 24,
  },
  miniPreviewLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  miniPreviewChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  miniPreviewChip: {
    backgroundColor: Colors.accent,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  miniPreviewChipText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: '500',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.paper,
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.shadow,
  },
  selectedCount: {
    alignItems: 'center',
    marginBottom: 12,
  },
  selectedCountText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  continueButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 18,
    borderRadius: 30,
    alignItems: 'center',
    marginBottom: 16,
  },
  continueButtonDisabled: {
    opacity: 0.4,
  },
  continueButtonText: {
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
