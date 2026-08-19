import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { fromDayKey } from "@/lib/dates";
import type { HeatCell } from "@/lib/stats";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { useEffect, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

interface HabitHeatmapProps {
  /** Days oldest → newest (from `heatmapCells`). Laid out in columns of `rows`. */
  cells: HeatCell[];
  /** Rows per column (a "week"). Default 7. */
  rows?: number;
  /** Gap between cells in px. Default 4. */
  gap?: number;
  /** Tap a day — used for the journal-highlight sheet. */
  onDayPress?: (cell: HeatCell) => void;
  /** Said when there are no days to draw. Never render a zero-height grid. */
  emptyLabel?: string;
  /**
   * Name of the single habit being shown, if any. Only used to make the
   * spoken label say what it's actually about ("Exercise, March 4, done")
   * — a square with no text needs the whole sentence.
   */
  habitName?: string;
}

const spokenDate = (key: string) =>
  fromDayKey(key).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

/**
 * What one square means, said plainly. `level` carries a different meaning per
 * mode (streak length for one habit, share-of-habits overall), so describe
 * each honestly rather than inventing a number.
 */
function spokenState(cell: HeatCell, singleHabit: boolean): string {
  if (!cell.eligible) return "before you started tracking";
  if (cell.perfect) return "perfect day, everything done";
  if (cell.level === 0) return singleHabit ? "not done" : "nothing marked";
  if (singleHabit) return "done";
  return cell.level === 3 ? "nearly all done" : cell.level === 2 ? "most done" : "a few done";
}

// One colour, five steps — the GitHub contribution-graph idea in our accent
// instead of green. A single ramp is readable at a glance: darker means more.
// (It replaced a crosshatch pattern, where "denser hatching" had to be decoded
// rather than seen, and the solid-ink perfect day sat outside the scale
// entirely as a sixth, different-looking thing.)
//
// Empty days stay paper with a hairline so the grid still reads as a calendar,
// and `Hairline.faint` marks days before any habit existed: not a miss, not
// yours.
const LEVEL_OPACITY = [0, 0.28, 0.52, 0.76, 1] as const;

/** Fill opacity for a cell. A perfect day is the top of the same ramp. */
const levelOpacity = (level: number, perfect: boolean): number =>
  perfect ? LEVEL_OPACITY[4] : LEVEL_OPACITY[Math.max(0, Math.min(3, level))];

/**
 * A crosshatch consistency heatmap drawn as a single SVG (one node, not N).
 * Darker = stronger; the all-time longest run is outlined in accent, and a
 * perfect day (FR-G1 — every eligible habit done) is filled solid ink, the
 * darkest mark on the grid. Fades in on mount. Pure presentation — feed it
 * cells from `lib/stats.heatmapCells`.
 */
export function HabitHeatmap({
  cells,
  rows = 7,
  gap = 4,
  onDayPress,
  emptyLabel = "No days to show in this range yet.",
  habitName,
}: HabitHeatmapProps) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReduceMotion();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The entrance is decoration — with Reduce Motion on, just be there.
    if (reduceMotion) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: Motion.slow,
      useNativeDriver: true,
    }).start();
  }, [enter, cells.length, reduceMotion]);

  // An empty window would draw a zero-height SVG — a blank frame with no
  // explanation. Say why instead. (After the hooks: order must never change.)
  if (cells.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

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
          {cells.map((c, i) => {
            const x = Math.floor(i / rows) * (cell + gap);
            const y = (i % rows) * (cell + gap);
            const op = levelOpacity(c.level, c.perfect);
            // The fill is the accent now, so the longest run can't be outlined
            // in accent too — ink reads against every step of the ramp.
            const stroke = c.inLongest
              ? Colors.ink
              : c.eligible
                ? Hairline.outline
                : Hairline.faint;
            // A square carries no text, so the label has to say the whole
            // thing: which habit, which day, how it went.
            const label = [
              habitName,
              spokenDate(c.date),
              spokenState(c, !!habitName),
              c.inLongest ? "part of your longest streak" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <Rect
                key={c.date}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={3}
                fill={op > 0 ? Colors.accent : "transparent"}
                fillOpacity={op}
                stroke={stroke}
                strokeWidth={c.inLongest ? 1.5 : 1}
                onPress={onDayPress ? () => onDayPress(c) : undefined}
                accessible
                // react-native-svg only forwards `accessible` +
                // `accessibilityLabel` to shapes — no role, no hint — so the
                // affordance has to ride along inside the label.
                accessibilityLabel={
                  onDayPress ? `${label}. Double tap to look back` : label
                }
              />
            );
          })}
        </Svg>
      )}
      {cell > 0 && <HeatmapLegend />}
    </Animated.View>
  );
}

/**
 * The key to the ramp. Without it "darker = more" is a guess; with it the grid
 * is self-explaining, which is the whole reason GitHub prints one.
 */
function HeatmapLegend() {
  return (
    <View style={styles.legend} accessibilityLabel="Lighter squares are fewer habits done, darker squares are more">
      <Text style={styles.legendText}>Less</Text>
      {LEVEL_OPACITY.map((op, i) => (
        <View
          key={i}
          style={[
            styles.swatch,
            op === 0
              ? { borderColor: Hairline.outline, borderWidth: 1 }
              : { backgroundColor: Colors.accent, opacity: op },
          ]}
        />
      ))}
      <Text style={styles.legendText}>More</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 3,
    marginTop: 10,
  },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: {
    fontSize: 10.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginHorizontal: 3,
  },
  empty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    paddingVertical: 8,
  },
});
