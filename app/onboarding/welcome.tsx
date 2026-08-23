// The front door — the promise, and three ways in.
//
// This screen now runs BEFORE any account exists. A brand-new install lands
// here: Get started walks into the guest onboarding steps (habits, one survey
// tap, first entry), Take a look around opens the example tour, and Sign in is
// for people who already have a journal. Nothing here needs a session and
// nothing auto-advances.
//
// The entrance is choreographed rather than simultaneous. Everything used to
// fade up at once on one `Motion.slow` timing, which reads as a screen
// appearing; the pieces now arrive on their own beat — mark, headline, the
// accent rule drawing itself, then the copy and the buttons — which reads as a
// page being made. All decorative, all native-driver, all held in two handles
// (entrance + idle float) that are stopped on unmount, and all skipped
// entirely when Reduce Motion is on.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** How far each block travels on its way in. */
const RISE_FROM = 18;
/** The mark starts a touch small so its spring reads as a landing. */
const MARK_FROM = 0.86;
/** Idle bob on the mark, in points. Small enough to feel like breathing. */
const FLOAT_LIFT = 5;

/**
 * One element of the entrance: fade up from `RISE_FROM`, `beat` beats late.
 *
 * Returned as a pair — the style to spread onto an `Animated.View`, and the
 * animation to hand to the parallel below — so a block's timing lives in one
 * place instead of being spread across a ref, an effect and a style.
 */
function useEntrance(beat: number) {
  const progress = useRef(new Animated.Value(0)).current;
  return {
    progress,
    style: {
      opacity: progress,
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [RISE_FROM, 0],
          }),
        },
      ],
    },
    animation: Animated.sequence([
      Animated.delay(beat * Motion.heroBeat),
      Animated.timing(progress, {
        toValue: 1,
        duration: Motion.slow,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]),
  };
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  // A signed-in user can land here too (an account that never finished
  // onboarding). They get the same flow; only the sign-in link goes away.
  const { session } = useAuth();

  // The mark gets a spring rather than a timing — it's the one thing on the
  // screen that should feel like it has weight.
  const markScale = useRef(new Animated.Value(MARK_FROM)).current;
  const markFade = useRef(new Animated.Value(0)).current;
  // Its idle bob, once the entrance has settled.
  const float = useRef(new Animated.Value(0)).current;
  // The accent rule draws itself open from the centre. scaleX keeps it on the
  // native driver; animating `width` would not be.
  const ruleScale = useRef(new Animated.Value(0)).current;

  const headline = useEntrance(1);
  const body = useEntrance(3);
  const footer = useEntrance(4);

  useEffect(() => {
    const blocks = [headline, body, footer];

    if (reduceMotion) {
      // Final frame, no performance. Feedback motion (the press scale) stays;
      // this is the decorative half.
      markScale.setValue(1);
      markFade.setValue(1);
      ruleScale.setValue(1);
      float.setValue(0);
      blocks.forEach((block) => block.progress.setValue(1));
      return;
    }

    const entrance = Animated.parallel([
      Animated.timing(markFade, {
        toValue: 1,
        duration: Motion.base,
        useNativeDriver: true,
      }),
      Animated.spring(markScale, {
        toValue: 1,
        ...Motion.spring,
        useNativeDriver: true,
      }),
      ...blocks.map((block) => block.animation),
      // The rule lands between the headline and the body, so it reads as the
      // stroke that separates them rather than decoration arriving late.
      Animated.sequence([
        Animated.delay(2 * Motion.heroBeat),
        Animated.timing(ruleScale, {
          toValue: 1,
          duration: Motion.slow,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]);

    // Ambient, and deliberately slower than anything else on screen: it should
    // register as stillness, not as a second animation competing for the eye.
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: Motion.float.bob,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: Motion.float.bob,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    entrance.start(({ finished }) => {
      // Only breathe once the arrival is done, and never against a screen the
      // user has already left.
      if (finished) bob.start();
    });

    return () => {
      entrance.stop();
      bob.stop();
    };
    // Animated.Value refs are stable across renders (useRef); the entrance
    // blocks are too. Only the Reduce Motion switch should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  function begin() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/onboarding/habits" as Href);
  }

  function explore() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/onboarding/explore" as Href);
  }

  return (
    <PaperBackground>
      <View style={[styles.container, { paddingTop: insets.top + 60 }]}>
        <Animated.View
          style={[
            styles.markWrapper,
            {
              opacity: markFade,
              transform: [
                { scale: markScale },
                {
                  translateY: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -FLOAT_LIFT],
                  }),
                },
              ],
            },
          ]}
        >
          {/* Drawn glyph, not a character: the typed check was a bare
              codepoint the handwriting font doesn't carry, so it fell back to
              a system face (or a tofu box) — and the saved mark at the end of
              the flow already uses this icon. One mark, both ends. */}
          <View style={styles.mark}>
            <IconSymbol name="checkmark" size={38} color={Colors.paper} />
          </View>
        </Animated.View>

        <View style={styles.copy}>
          <Animated.View style={headline.style}>
            <Text style={styles.headline} accessibilityRole="header">
              A private place
            </Text>
            <Text style={styles.headline}>for your days.</Text>
          </Animated.View>

          <Animated.View
            style={[styles.rule, { transform: [{ scaleX: ruleScale }] }]}
          />

          <Animated.View style={body.style}>
            <Text style={styles.body}>
              Track a few habits, write one line a day. All of it encrypted on
              your phone.
            </Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.footer, footer.style]}>
          <PressableScale
            style={styles.button}
            onPress={begin}
            accessibilityRole="button"
            accessibilityLabel="Get started"
          >
            <Text style={styles.buttonText}>Get started</Text>
          </PressableScale>

          <PressableScale
            style={styles.secondaryButton}
            onPress={explore}
            accessibilityRole="button"
            accessibilityLabel="Take a look around"
          >
            <Text style={styles.secondaryButtonText}>Take a look around</Text>
          </PressableScale>

          {!session && (
            <TouchableOpacity
              style={styles.signInButton}
              onPress={() => router.push("/auth/signin")}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Sign in to an existing account"
            >
              <Text style={styles.signInText}>
                Already have an account?{" "}
                <Text style={styles.signInLink}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          )}

          {__DEV__ && (
            <TouchableOpacity
              style={styles.devLink}
              onPress={() => router.replace("/(tabs)" as Href)}
              activeOpacity={0.7}
            >
              <Text style={styles.devLinkText}>Skip to app →</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: insets.bottom + 16 }} />
        </Animated.View>
      </View>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  // 24pt gutters, like the steps that follow — the flow shares one page
  // rhythm so nothing shifts sideways as it advances.
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  markWrapper: {
    alignItems: "center",
    marginBottom: 40,
  },
  // Same 72pt disc as the saved mark at the end of the flow.
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
  // The accent rule under a title — the one orange mark, repeated on every
  // step at the same 48x2.
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
    maxWidth: 300,
  },
  footer: {
    marginTop: "auto",
  },
  // Full-width pill, 16pt tall, radius 30 — the same primary button every
  // step ends on, so the eye doesn't have to re-find it.
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
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 15,
    borderRadius: 30,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 17,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
  },
  signInButton: { alignItems: "center", paddingVertical: 14, marginTop: 4 },
  signInText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signInLink: {
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textDecorationLine: "underline",
  },
  devLink: { alignItems: "center", paddingVertical: 6 },
  devLinkText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
});
