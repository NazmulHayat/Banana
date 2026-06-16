import { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleProp,
  ViewStyle,
} from "react-native";

interface PressableScaleProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** Visual style — applied to the inner animated view. */
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. Defaults to 0.97. */
  scaleTo?: number;
  hitSlop?: number;
}

/**
 * Generic scale-on-press wrapper. Same recipe as IconButton: Pressable
 * style-callback + a single native-driver spring, which keeps gesture
 * detection intact (no mixed-driver Animated.parallel).
 */
export function PressableScale({
  onPress,
  children,
  disabled,
  style,
  scaleTo = 0.97,
  hitSlop,
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const springTo = (toValue: number) => {
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      friction: 6,
      tension: 140,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => springTo(scaleTo)}
      onPressOut={() => springTo(1)}
      disabled={disabled}
      hitSlop={hitSlop}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
