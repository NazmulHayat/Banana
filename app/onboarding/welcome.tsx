// Onboarding step 1 of 3 — the promise.
//
// States what the app is (private habits + journal) and waits. Nothing
// auto-advances: the user leaves this screen by tapping Continue. The entrance
// animation is decorative only, is held in one handle, and is stopped on
// unmount so nothing runs against a dead screen.
//
// There is no back button here on purpose — this screen is a `replace` target
// from account setup, so "back" would mean the signup form of an account that
// already exists. Skip is here, though: steps 2 and 3 both have one, and a
// flow you can't leave is not a welcome.

import { PaperBackground } from "@/components/ui/paper-background";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useOnboarding } from "@/lib/onboarding-context";
import { clearOnboardingDraft } from "@/lib/onboarding-draft";
import { Href, router } from "expo-router";
import { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingProgress } from "./_layout";

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useOnboarding();

  const markScale = useRef(new Animated.Value(0.8)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.timing(markScale, {
        toValue: 1,
        duration: Motion.slow,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: Motion.slow,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: Motion.slow,
        useNativeDriver: true,
      }),
    ]);
    entrance.start();
    // Cleanup: the animation dies with the screen — no callback ever fires
    // against an unmounted component.
    return () => entrance.stop();
    // Animated.Value refs are stable across renders (useRef); listing them
    // satisfies exhaustive-deps without changing when this runs.
  }, [fade, markScale, rise]);

  // Leaving early still counts as done — the tracker and the composer teach
  // the rest, and nobody should be walked through this twice.
  async function skipSetup() {
    await clearOnboardingDraft();
    await completeOnboarding();
    router.replace("/(tabs)");
  }

  return (
    <PaperBackground>
      <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
        <Animated.View
          style={[styles.markWrapper, { transform: [{ scale: markScale }] }]}
        >
          <View style={styles.mark}>
            <Text style={styles.markText}>✓</Text>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.copy,
            { opacity: fade, transform: [{ translateY: rise }] },
          ]}
        >
          <Text style={styles.headline}>A private place</Text>
          <Text style={styles.headline}>for your days.</Text>

          <View style={styles.rule} />

          <Text style={styles.body}>
            Track the habits that matter and keep a short daily journal.
          </Text>
          <Text style={styles.body}>
            Everything is encrypted on this device before it leaves — your
            words and habits stay yours, even from us.
          </Text>
        </Animated.View>

        <View style={styles.footer}>
          <PressableScale
            style={styles.button}
            onPress={() => router.push("/onboarding/habits" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Let's begin"
          >
            <Text style={styles.buttonText}>Let&apos;s begin</Text>
          </PressableScale>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={skipSetup}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Skip setup for now"
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>

          <OnboardingProgress step={1} bottomInset={insets.bottom + 20} />
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
  markWrapper: {
    alignItems: "center",
    marginBottom: 40,
  },
  mark: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
  },
  markText: {
    fontSize: 40,
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  copy: {
    alignItems: "center",
  },
  headline: {
    fontSize: 32,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
    lineHeight: 42,
  },
  rule: {
    height: 2,
    width: 120,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginVertical: 24,
  },
  body: {
    fontSize: 17,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 12,
  },
  footer: {
    marginTop: "auto",
  },
  button: {
    backgroundColor: Colors.ink,
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 30,
    alignItems: "center",
    alignSelf: "center",
  },
  buttonText: {
    fontSize: 18,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  skipButton: { alignItems: "center", paddingVertical: 12, marginTop: 4 },
  skipText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
