import { Motion } from "@/constants/motion";
import { Hairline } from "@/constants/theme";
import { useRef } from "react";
import { Animated, Pressable, StyleSheet, ViewStyle } from "react-native";
import type { A11yProps } from "./pressable-scale";

interface IconButtonProps extends A11yProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  /** Diameter of the round button. Defaults to 44 — the minimum touch target. */
  size?: number;
}

/**
 * Round 44pt+ touch target with a spring scale-down on press.
 * Used for chevrons in month navigation and other icon-only actions.
 *
 * Icon-only means there is no text for VoiceOver to read, so
 * `accessibilityLabel` is effectively required at every call site.
 */
export function IconButton({
  onPress,
  children,
  disabled,
  style,
  size = 44,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  accessibilityValue,
}: IconButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      ...Motion.springPress,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => springTo(0.92)}
      onPressOut={() => springTo(1)}
      disabled={disabled}
      hitSlop={6}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      accessibilityValue={accessibilityValue}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: disabled ? 0.35 : 1,
          backgroundColor: pressed ? Hairline.faint : "transparent",
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.inner,
          {
            width: size,
            height: size,
            transform: [{ scale }],
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: "center",
    alignItems: "center",
  },
  inner: {
    justifyContent: "center",
    alignItems: "center",
  },
});
