import { PressableScale } from "@/components/ui/pressable-scale";
import {
  StreakFlame,
  daysToNextTier,
  streakTier,
} from "@/components/ui/streak-flame";
import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/**
 * The streak badge: a flame that grows, a number that rolls, and a pill that
 * deepens as the streak does.
 *
 * The point is that reaching day 30 should *look* like something happened.
 * A static counter makes every day identical, which is exactly the feeling a
 * streak is supposed to fight.
 *
 * Deliberately not a celebration engine: no confetti, no modal, nothing that
 * interrupts. The reward is that the mark on the screen changed.
 */

interface StreakPillProps {
  streak: number;
  onPress?: () => void;
}

/** How far the old digits travel as they leave. */
const ROLL_DISTANCE = 14;

/** Pill background per tier — pale at the start, saturated once it's earned. */
const TIER_BG = [
  `${Colors.accent}22`,
  `${Colors.accent}33`,
  `${Colors.accent}66`,
  Colors.accent,
  Colors.accent,
] as const;

export function StreakPill({ streak, onPress }: StreakPillProps) {
  const reduceMotion = useReduceMotion();
  const tier = streakTier(streak);

  // The number currently painted. It lags `streak` by one frame during a roll
  // so the outgoing and incoming digits can both be on screen.
  const [shown, shown_set] = useState(streak);
  const previous = useRef(streak);
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const roll = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const [flareKey, setFlareKey] = useState(0);

  useEffect(() => {
    const before = previous.current;
    previous.current = streak;
    if (streak === before) return;

    const grew = streak > before;
    if (reduceMotion || !grew) {
      shown_set(streak);
      return;
    }

    // Grew: roll the digits, pop the pill, flare the flame, one light tap.
    setOutgoing(before);
    shown_set(streak);
    setFlareKey((k) => k + 1);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    roll.setValue(0);
    Animated.timing(roll, {
      toValue: 1,
      duration: Motion.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setOutgoing(null);
    });

    pop.setValue(1);
    Animated.sequence([
      Animated.timing(pop, {
        toValue: 1.12,
        duration: Motion.fast,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(pop, {
        toValue: 1,
        useNativeDriver: true,
        ...Motion.springBouncy,
      }),
    ]).start();
  }, [streak, reduceMotion, roll, pop]);

  const remaining = daysToNextTier(streak);
  const label =
    remaining === null
      ? `Current streak, ${streak} days`
      : `Current streak, ${streak} day${streak === 1 ? "" : "s"}. ${remaining} more until the flame grows.`;

  const digits = (
    <View style={styles.digits}>
      {/* Outgoing digits leave upward; the new ones arrive from below. Both
          are absolute so the pill's width doesn't jump mid-roll. */}
      {outgoing !== null ? (
        <Animated.Text
          style={[
            styles.value,
            tier >= 3 && styles.valueOnSolid,
            styles.digitsLeaving,
            {
              opacity: roll.interpolate({
                inputRange: [0, 0.7],
                outputRange: [1, 0],
                extrapolate: "clamp",
              }),
              transform: [
                {
                  translateY: roll.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -ROLL_DISTANCE],
                  }),
                },
              ],
            },
          ]}
        >
          {outgoing}
        </Animated.Text>
      ) : null}
      <Animated.Text
        style={[
          styles.value,
          tier >= 3 && styles.valueOnSolid,
          outgoing !== null && {
            opacity: roll,
            transform: [
              {
                translateY: roll.interpolate({
                  inputRange: [0, 1],
                  outputRange: [ROLL_DISTANCE, 0],
                }),
              },
            ],
          },
        ]}
      >
        {shown}
      </Animated.Text>
    </View>
  );

  const body = (
    <Animated.View
      style={[
        styles.pill,
        { backgroundColor: TIER_BG[tier], transform: [{ scale: pop }] },
        tier >= 3 && styles.pillEarned,
      ]}
    >
      <StreakFlame
        streak={streak}
        size={16}
        // On the solid pill the ink core would disappear — flip it to paper.
        accent={tier >= 3 ? Colors.paper : Colors.accent}
        flareKey={flareKey}
      />
      {digits}
    </Animated.View>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint="Opens your stats and analysis"
    >
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Hairline.outline,
  },
  /** Once it's solid accent, the hairline would muddy the edge. */
  pillEarned: { borderColor: Colors.accent },
  digits: { justifyContent: "center" },
  digitsLeaving: { position: "absolute", left: 0, right: 0 },
  value: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  valueOnSolid: { color: Colors.ink },
});
