import { Motion } from "@/constants/motion";
import { Colors } from "@/constants/theme";
import type { HeatCell } from "@/lib/stats";
import { useEffect, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, Line, Pattern, Rect } from "react-native-svg";

interface HabitHeatmapProps {
  /** Days oldest → newest (from `heatmapCells`). Laid out in columns of `rows`. */
  cells: HeatCell[];
  /** Rows per column (a "week"). Default 7. */
  rows?: number;
  /** Gap between cells in px. Default 4. */
  gap?: number;
  /** Tap a day — used for the journal-highlight sheet. */
  onDayPress?: (cell: HeatCell) => void;
}

// Crosshatch density per level, reusing the HabitCell ink look. Empty days
// stay paper with a hairline so the grid still reads as a calendar.
const levelOpacity = (l: number): number =>
  l === 1 ? 0.4 : l === 2 ? 0.7 : l === 3 ? 1 : 0;

/**
 * A crosshatch consistency heatmap drawn as a single SVG (one node, not N).
 * Darker = stronger; the all-time longest run is outlined in accent. Fades in
 * on mount. Pure presentation — feed it cells from `lib/stats.heatmapCells`.
 */
export function HabitHeatmap({ cells, rows = 7, gap = 4, onDayPress }: HabitHeatmapProps) {
  const [width, setWidth] = useState(0);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: Motion.slow,
      useNativeDriver: true,
    }).start();
  }, [enter, cells.length]);

  const cols = Math.max(1, Math.ceil(cells.length / rows));
  const cell = width > 0 ? (width - gap * (cols - 1)) / cols : 0;
  const height = cell > 0 ? cell * rows + gap * (rows - 1) : 0;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <Animated.View
      onLayout={onLayout}
      style={{
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        ],
      }}
    >
      {cell > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <Pattern id="hm-hatch" patternUnits="userSpaceOnUse" width={5} height={5}>
              <Line x1="0" y1="0" x2="5" y2="5" stroke={Colors.ink} strokeWidth="1.4" />
              <Line x1="5" y1="0" x2="0" y2="5" stroke={Colors.ink} strokeWidth="1.4" />
            </Pattern>
          </Defs>
          {cells.map((c, i) => {
            const x = Math.floor(i / rows) * (cell + gap);
            const y = (i % rows) * (cell + gap);
            const op = levelOpacity(c.level);
            return (
              <Rect
                key={c.date}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={3}
                fill={op > 0 ? "url(#hm-hatch)" : "transparent"}
                fillOpacity={op}
                stroke={c.inLongest ? Colors.accent : "rgba(26,26,26,0.16)"}
                strokeWidth={c.inLongest ? 1.5 : 1}
                onPress={onDayPress ? () => onDayPress(c) : undefined}
              />
            );
          })}
        </Svg>
      )}
    </Animated.View>
  );
}
