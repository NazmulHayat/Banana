import { Motion } from "@/constants/motion";
import { Hairline, Scrim } from "@/constants/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * A single shimmering placeholder block. Pulses opacity from 0.45 to 0.85
 * over ~1200ms — softer than a linear shimmer and matches the paper aesthetic.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  borderRadius = 6,
  style,
}: SkeletonProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    // A looping pulse is the textbook thing Reduce Motion turns off — hold it
    // at the midpoint instead, so the placeholder is still visibly a placeholder.
    if (reduceMotion) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: Motion.pulse,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: Motion.pulse,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.block,
        {
          width: width as any,
          height,
          borderRadius,
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.4, 0.75],
          }),
        },
        style,
      ]}
    />
  );
}

interface SkeletonCardProps {
  height?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * A card-shaped placeholder matching PaperCard geometry. Use as a stand-in
 * while a real card's data loads.
 */
export function SkeletonCard({ height = 120, style }: SkeletonCardProps) {
  return (
    <View style={[styles.card, { height }, style]}>
      <Skeleton width="60%" height={14} />
      <View style={{ height: 12 }} />
      <Skeleton width="90%" height={12} />
      <View style={{ height: 8 }} />
      <Skeleton width="75%" height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: Hairline.wash,
  },
  card: {
    backgroundColor: Scrim.card,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: Hairline.faint,
  },
});
