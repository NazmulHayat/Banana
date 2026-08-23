// Onboarding step 2 of 3 — one survey tap.
//
// A single question with three big answers. No typing, no wrong answer, and
// the answer is not decorative: step 3 opens with a line that matches it, and
// the app can echo it back later once there is a real streak to point at.
//
// Tapping an answer saves it to the draft and advances on a short beat, so the
// selection is seen landing before the screen moves. Skip is a real option and
// costs nothing.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import type { PriorExperience } from "@/lib/onboarding-draft";
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboarding-draft";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingProgress } from "./_layout";

interface AnswerOption {
  id: PriorExperience;
  label: string;
  detail: string;
}

const ANSWERS: AnswerOption[] = [
  {
    id: "never",
    label: "Not really",
    detail: "This would be my first proper go at it",
  },
  {
    id: "fell_off",
    label: "Tried, fell off",
    detail: "Started strong, faded after a while",
  },
  {
    id: "doing_it",
    label: "Doing it now",
    detail: "I already track, I want a better home for it",
  },
];

/** How long the selected state is on screen before the flow advances. */
const ADVANCE_DELAY_MS = 450;

export default function OnboardingSurveyScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<PriorExperience | null>(null);
  // Guards the timed advance from firing after unmount or a double tap.
  const advancing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: Motion.base,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: Motion.base,
        useNativeDriver: true,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
  }, [fade, rise]);

  // Restore a previous answer (Back from step 3, or an interrupted run).
  useEffect(() => {
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (cancelled || !draft.priorExperience) return;
      setSelected(draft.priorExperience);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function choose(id: PriorExperience) {
    if (advancing.current) return;
    advancing.current = true;
    void Haptics.selectionAsync();
    setSelected(id);
    saveOnboardingDraft({ priorExperience: id });
    timer.current = setTimeout(() => {
      router.push("/onboarding/entry" as Href);
      // Allow re-answering if the user comes Back to this screen.
      advancing.current = false;
    }, ADVANCE_DELAY_MS);
  }

  function skip() {
    if (advancing.current) return;
    router.push("/onboarding/entry" as Href);
  }

  return (
    <PaperBackground>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 16, paddingBottom: 24 },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Animated.View
          style={[styles.body, { opacity: fade, transform: [{ translateY: rise }] }]}
        >
          <Text style={styles.title} accessibilityRole="header">
            Quick one. Tried tracking habits before?
          </Text>
          {/* Same accent rule as every step — the flow's one orange mark. */}
          <View style={styles.titleRule} />
          <Text style={styles.subtitle}>
            One tap, no wrong answer. It helps us pitch things right.
          </Text>

          <View style={styles.answers}>
            {ANSWERS.map((answer) => {
              const isSelected = selected === answer.id;
              return (
                <PressableScale
                  key={answer.id}
                  style={[styles.answer, isSelected && styles.answerSelected]}
                  onPress={() => choose(answer.id)}
                  accessibilityRole="button"
                  accessibilityLabel={answer.label}
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.answerTextWrap}>
                    <Text
                      style={[
                        styles.answerLabel,
                        isSelected && styles.answerLabelSelected,
                      ]}
                    >
                      {answer.label}
                    </Text>
                    <Text
                      style={[
                        styles.answerDetail,
                        isSelected && styles.answerDetailSelected,
                      ]}
                    >
                      {answer.detail}
                    </Text>
                  </View>
                  {isSelected && (
                    <IconSymbol name="checkmark" size={18} color={Colors.paper} />
                  )}
                </PressableScale>
              );
            })}
          </View>
        </Animated.View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={skip}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Skip this question"
          >
            <Text style={styles.skipText}>Skip this</Text>
          </TouchableOpacity>
          <OnboardingProgress step={2} bottomInset={insets.bottom + 8} />
        </View>
      </View>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  body: { flex: 1 },
  title: {
    fontSize: 28,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    lineHeight: 36,
  },
  titleRule: {
    height: 2,
    width: 48,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginTop: 10,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
    marginBottom: 28,
  },
  answers: { gap: 12 },
  answer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  answerSelected: {
    backgroundColor: Colors.ink,
  },
  answerTextWrap: { flex: 1 },
  answerLabel: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  answerLabelSelected: { color: Colors.paper },
  answerDetail: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 3,
    lineHeight: 20,
  },
  answerDetailSelected: { color: Colors.shadow },
  footer: {},
  skipButton: { alignItems: "center", paddingVertical: 10 },
  skipText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
