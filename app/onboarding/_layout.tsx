import { Colors, Fonts } from "@/constants/theme";
import { Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

/** How many steps the flow has. Steps read their position from this. */
export const ONBOARDING_STEPS = 3;

interface OnboardingProgressProps {
  /** 1-based position of the screen showing this. */
  step: number;
  /** Extra room under the dots — the safe-area inset where a screen needs it. */
  bottomInset?: number;
}

/**
 * "Step 2 of 3" plus the dots. All three steps hand-rolled their own copy of
 * this, which is how step 1 ended up with a label the other two had lost.
 * Lives here rather than in `components/` because it belongs to this flow and
 * nothing else renders it.
 */
export function OnboardingProgress({
  step,
  bottomInset = 0,
}: OnboardingProgressProps) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${ONBOARDING_STEPS}`}
      accessibilityValue={{ min: 1, max: ONBOARDING_STEPS, now: step }}
    >
      <Text style={styles.label}>
        Step {step} of {ONBOARDING_STEPS}
      </Text>
      <View style={[styles.dots, { paddingBottom: bottomInset }]}>
        {Array.from({ length: ONBOARDING_STEPS }).map((_, index) => (
          // Three states, not two: steps already behind you read as inked-in
          // (faded), the one you're on as the long bar, the rest as blank
          // paper — so the row shows progress, not just position.
          <View
            key={index}
            style={[
              styles.dot,
              index < step - 1 && styles.dotDone,
              index === step - 1 && styles.dotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.paper },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="habits" />
      <Stack.Screen name="feed-demo" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 10,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.shadow,
  },
  dotDone: { backgroundColor: Colors.ink, opacity: 0.35 },
  dotActive: { backgroundColor: Colors.ink, width: 24 },
});
