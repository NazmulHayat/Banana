import { Colors } from '@/constants/theme';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

interface HabitCellProps {
  completed: boolean;
  onPress: () => void;
  isCurrentDay?: boolean;
  size?: number;
}

export function HabitCell({ completed, onPress, isCurrentDay, size = 60 }: HabitCellProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const wasCompleted = useRef(completed);

  const handlePress = () => {
    if (!wasCompleted.current) {
      // Toggling ON: selection haptic + spring punch
      void Haptics.selectionAsync();
      scale.setValue(0.85);
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 5,
        tension: 100,
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
  const uniqueId = `crosshatch-${size}`;
  const uniqueId2 = `crosshatch2-${size}`;

  return (
    <Pressable onPress={handlePress}>
      <Animated.View
        style={[
          styles.cell,
          isCurrentDay && styles.currentDay,
          { transform: [{ scale }] },
        ]}
      >
        {completed && (
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
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
});
