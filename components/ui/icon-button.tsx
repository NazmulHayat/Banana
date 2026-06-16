import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  ViewStyle,
} from "react-native";

interface IconButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  /** Diameter of the round button. Defaults to 44. */
  size?: number;
}

/**
 * Round 44pt+ touch target with a spring scale-down on press.
 * Used for chevrons in month navigation and other icon-only actions.
 */
export function IconButton({
  onPress,
  children,
  disabled,
  style,
  size = 44,
}: IconButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.92,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: disabled ? 0.35 : 1,
          backgroundColor: pressed
            ? "rgba(26, 26, 26, 0.06)"
            : "transparent",
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
