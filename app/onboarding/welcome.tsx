import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { router, Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PaperBackground } from '@/components/ui/paper-background';
import { Colors, Fonts } from '@/constants/theme';

const { width } = Dimensions.get('window');

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  
  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const lineWidth = useRef(new Animated.Value(0)).current;
  const secondTextFade = useRef(new Animated.Value(0)).current;
  const secondTextSlide = useRef(new Animated.Value(20)).current;
  const buttonFade = useRef(new Animated.Value(0)).current;
  const buttonSlide = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    // Staggered entrance animation
    Animated.sequence([
      // First: checkmark pops in
      Animated.spring(checkmarkScale, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
      }),
      // Then: main text fades in
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
      ]),
      // Line draws across
      Animated.timing(lineWidth, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }),
      // Secondary text appears
      Animated.parallel([
        Animated.timing(secondTextFade, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(secondTextSlide, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
      // Button fades in
      Animated.parallel([
        Animated.timing(buttonFade, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(buttonSlide, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, []);

  const handleContinue = () => {
    router.push('/onboarding/habits' as Href);
  };

  return (
    <PaperBackground>
      <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
        {/* Checkmark animation */}
        <Animated.View
          style={[
            styles.checkmarkContainer,
            { transform: [{ scale: checkmarkScale }] },
          ]}
        >
          <View style={styles.checkmark}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        </Animated.View>

        {/* Main headline */}
        <Animated.View
          style={[
            styles.headlineContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={styles.headline}>You've already taken</Text>
          <Text style={styles.headline}>your first step.</Text>
        </Animated.View>

        {/* Animated line */}
        <Animated.View
          style={[
            styles.line,
            {
              width: lineWidth.interpolate({
                inputRange: [0, 1],
                outputRange: [0, width * 0.5],
              }),
            },
          ]}
        />

        {/* Secondary text */}
        <Animated.View
          style={[
            styles.secondaryContainer,
            {
              opacity: secondTextFade,
              transform: [{ translateY: secondTextSlide }],
            },
          ]}
        >
          <Text style={styles.secondary}>
            Every journey starts with a single decision.
          </Text>
          <Text style={styles.secondary}>
            Let's build something meaningful together.
          </Text>
        </Animated.View>

        {/* Continue button */}
        <Animated.View
          style={[
            styles.buttonContainer,
            {
              opacity: buttonFade,
              transform: [{ translateY: buttonSlide }],
            },
          ]}
        >
          <Animated.View style={styles.button}>
            <Text style={styles.buttonText} onPress={handleContinue}>
              Let's begin
            </Text>
          </Animated.View>
        </Animated.View>

        {/* Progress indicator */}
        <View style={[styles.progressContainer, { paddingBottom: insets.bottom + 20 }]}>
          <View style={[styles.progressDot, styles.progressDotActive]} />
          <View style={styles.progressDot} />
          <View style={styles.progressDot} />
        </View>
      </View>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 32,
  },
  checkmarkContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  checkmark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    fontSize: 40,
    color: Colors.paper,
    fontWeight: '300',
  },
  headlineContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headline: {
    fontSize: 32,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    lineHeight: 42,
  },
  line: {
    height: 2,
    backgroundColor: Colors.accent,
    alignSelf: 'center',
    marginBottom: 32,
    borderRadius: 1,
  },
  secondaryContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  secondary: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    lineHeight: 28,
  },
  buttonContainer: {
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: 40,
  },
  button: {
    backgroundColor: Colors.ink,
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 30,
  },
  buttonText: {
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
