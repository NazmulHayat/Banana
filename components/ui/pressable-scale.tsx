import { Motion } from "@/constants/motion";
import { useRef } from "react";
import {
  AccessibilityProps,
  Animated,
  Pressable,
  StyleProp,
  ViewStyle,
} from "react-native";

/**
 * The a11y props both primitives forward to their Pressable. Callers set these
 * directly — never on a wrapping `<View accessible>`, which swallows the
 * button role and the press state.
 */
export type A11yProps = Pick<
  AccessibilityProps,
  | "accessibilityLabel"
  | "accessibilityHint"
  | "accessibilityRole"
  | "accessibilityState"
  | "accessibilityValue"
>;

interface PressableScaleProps extends A11yProps {
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** Visual style — applied to the inner animated view. */
  style?: StyleProp<ViewStyle>;
  /**
   * Layout style for the OUTER Pressable — use this for `flex`, `width` or
   * `alignSelf`, i.e. anything about how this control sits among its siblings.
   *
   * `style` deliberately lands on the inner animated view so the whole
   * painted surface scales on press. The cost is that layout props passed
   * there never reach the row: a `flex: 1` in `style` gives the Pressable no
   * flex at all, and its child then resolves to zero width against an
   * auto-sized parent — the control vanishes while its card still renders.
   */
  containerStyle?: StyleProp<ViewStyle>;
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
  containerStyle,
  scaleTo = 0.97,
  hitSlop,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  accessibilityValue,
}: PressableScaleProps) {
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
      onPressIn={() => springTo(scaleTo)}
      onPressOut={() => springTo(1)}
      disabled={disabled}
      style={containerStyle}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      // Callers rarely repeat `disabled` — mirror it so the control never
      // reads as tappable to VoiceOver while it's inert.
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      accessibilityValue={accessibilityValue}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
