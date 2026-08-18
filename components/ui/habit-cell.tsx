import { Motion } from '@/constants/motion';
import { Colors } from '@/constants/theme';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

interface HabitCellProps {
  completed: boolean;
  onPress: () => void;
  isCurrentDay?: boolean;
  /** Rendered cell width — the grid widens columns when there are 1-3 habits. */
  size?: number;
  /** Rendered cell height. Defaults to `size` (a square cell). */
  height?: number;
  /**
   * Not tappable (a future day — you can't tick a habit before you've lived
   * it). Renders muted so the dead control looks dead. Past days stay
   * editable; back-filling is a core journal use.
   */
  disabled?: boolean;
  /** Spoken label, e.g. "Exercise, March 4, completed". */
  accessibilityLabel?: string;
}

export function HabitCell({
  completed,
  onPress,
  isCurrentDay,
  size = 60,
  height = size,
  disabled = false,
  accessibilityLabel,
}: HabitCellProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const wasCompleted = useRef(completed);

  const handlePress = () => {
    if (disabled) return;
    if (!wasCompleted.current) {
      // Toggling ON: selection haptic + spring punch
      void Haptics.selectionAsync();
      scale.setValue(0.85);
      // The one place a bouncy spring belongs: the tick landing is the reward.
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        ...Motion.springBouncy,
      }).start();
    } else {
      // Toggling OFF: subtle tick
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    wasCompleted.current = !wasCompleted.current;
    onPress();
  };

  // Create a dense crosshatch pattern using SVG patterns
  // This ensures uniform, complete coverage
  const patternSize = 6;
  const uniqueId = `crosshatch-${size}x${height}`;
  const uniqueId2 = `crosshatch2-${size}x${height}`;
  // The user space is 100 tall and as wide as the cell's aspect ratio, so a
  // wide (adaptive) cell gets MORE hatch, not a stretched one — a square cell
  // is still exactly the original 100x100 box.
  const viewBoxWidth = height > 0 ? (size * 100) / height : 100;

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: completed, disabled }}
    >
      <Animated.View
        style={[
          styles.cell,
          isCurrentDay && styles.currentDay,
          disabled && styles.disabled,
          { transform: [{ scale }] },
        ]}
      >
        {completed && (
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewBoxWidth} 100`}
            preserveAspectRatio="none"
          >
            <Defs>
              {/* First diagonal pattern */}
              <Pattern
                id={uniqueId}
                patternUnits="userSpaceOnUse"
                width={patternSize}
                height={patternSize}
                x="0"
                y="0"
              >
                <Line
                  x1="0"
                  y1="0"
                  x2={patternSize}
                  y2={patternSize}
                  stroke={Colors.completed}
                  strokeWidth="2.5"
                />
              </Pattern>
              {/* Second diagonal pattern (perpendicular) */}
              <Pattern
                id={uniqueId2}
                patternUnits="userSpaceOnUse"
                width={patternSize}
                height={patternSize}
                x="0"
                y="0"
              >
                <Line
                  x1={patternSize}
                  y1="0"
                  x2="0"
                  y2={patternSize}
                  stroke={Colors.completed}
                  strokeWidth="2.5"
                />
              </Pattern>
            </Defs>
            {/* Apply both patterns for crosshatch effect */}
            <Rect width="100%" height="100%" fill={`url(#${uniqueId})`} />
            <Rect width="100%" height="100%" fill={`url(#${uniqueId2})`} />
          </Svg>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.ink,
    minWidth: 40,
    minHeight: 40,
  },
  currentDay: {
    backgroundColor: `${Colors.accent}20`,
    borderColor: Colors.accent,
    borderWidth: 1.5,
  },
  // Future days: visibly inert, still legible as part of the grid.
  disabled: {
    opacity: 0.35,
  },
});
