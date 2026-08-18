// Onboarding step 1 of 3 — the promise.
//
// States what the app is (private habits + journal) and waits. Nothing
// auto-advances: the user leaves this screen by tapping Continue. The entrance
// animation is decorative only, is held in one handle, and is stopped on
// unmount so nothing runs against a dead screen.
//
// There is no back button here on purpose — this screen is a `replace` target
// from account setup, so "back" would mean the signup form of an account that
// already exists. Skip is here, though, and it matters more than it used to:
// step 2 now requires two habits and has no skip of its own, so this is the
// one door out of the flow (step 3's entry stays optional). A flow you can't
// leave is not a welcome.

import { IconSymbol } from "@/components/ui/icon-symbol";
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
          {/* Drawn glyph, not a character: the typed check was a bare
              codepoint the handwriting font doesn't carry, so it fell back to
              a system face (or a tofu box) — and step 3's saved mark already
              uses this icon. One mark, both ends of the flow. */}
          <View style={styles.mark}>
            <IconSymbol name="checkmark" size={38} color={Colors.paper} />
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.copy,
            { opacity: fade, transform: [{ translateY: rise }] },
          ]}
        >
          <Text style={styles.headline} accessibilityRole="header">
            A private place
          </Text>
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
  // 24pt gutters, like steps 2 and 3 — the three screens share one page
  // rhythm so nothing shifts sideways as the flow advances.
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  markWrapper: {
    alignItems: "center",
    marginBottom: 40,
  },
  // Same 72pt disc as the saved mark on step 3.
  mark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
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
  // The accent rule under a title — the one orange mark, repeated on all
  // three steps at the same 48x2.
  rule: {
    height: 2,
    width: 48,
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
  // Full-width pill, 16pt tall, radius 30 — the same primary button steps 2
  // and 3 end on, so the eye doesn't have to re-find it each step.
  button: {
    backgroundColor: Colors.ink,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
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
