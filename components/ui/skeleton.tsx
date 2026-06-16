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

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

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
    backgroundColor: "rgba(26, 26, 26, 0.12)",
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "rgba(26, 26, 26, 0.06)",
  },
});
