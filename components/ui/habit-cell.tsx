import { TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Defs, Pattern, Line, Rect } from 'react-native-svg';
import { Colors } from '@/constants/theme';

interface HabitCellProps {
  completed: boolean;
  onPress: () => void;
  isCurrentDay?: boolean;
  size?: number;
}

export function HabitCell({ completed, onPress, isCurrentDay, size = 60 }: HabitCellProps) {
  // Create a dense crosshatch pattern using SVG patterns
  // This ensures uniform, complete coverage
  const patternSize = 6;
  const uniqueId = `crosshatch-${size}`;
  const uniqueId2 = `crosshatch2-${size}`;
  
  return (
    <TouchableOpacity
      style={[styles.cell, isCurrentDay && styles.currentDay]}
      onPress={onPress}
      activeOpacity={0.7}>
      {completed && (
        <Svg 
          style={StyleSheet.absoluteFill} 
          width="100%" 
          height="100%"
          viewBox="0 0 100 100"
          preserveAspectRatio="none">
          <Defs>
            {/* First diagonal pattern */}
            <Pattern
              id={uniqueId}
              patternUnits="userSpaceOnUse"
              width={patternSize}
              height={patternSize}
              x="0"
              y="0">
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
              y="0">
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
    </TouchableOpacity>
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