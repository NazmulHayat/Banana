import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

export interface ProgressPoint {
  /** Short axis label — a month name, or a day number. */
  label: string;
  /** Completion rate in 0..1. */
  rate: number;
}

interface ProgressChartProps {
  /** Oldest → newest. Fewer than two points renders nothing. */
  points: ProgressPoint[];
  /** Plot height in points, excluding the axis labels. Default 132. */
  height?: number;
}

/** Gridlines at 0 / 25 / 50 / 75 / 100 — labelled at the quarters only. */
const GRID = [0, 0.25, 0.5, 0.75, 1];
const Y_AXIS_WIDTH = 30;

/**
 * The progress chart: completion rate per period, drawn as a proper column
 * chart with a labelled Y axis, gridlines and a baseline.
 *
 * This replaced a bare sparkline. A line with no axis, no scale and no labels
 * can't be read — you can see that it moved but not what it moved between, so
 * it carried no information the delta above it didn't already state. Bars on a
 * fixed 0–100% scale can be compared against each other and against the grid.
 *
 * The scale is always the full 0–100%, never fitted to the data: rescaling to
 * the min/max would make a flat month look dramatic.
 */
export function ProgressChart({ points, height = 132 }: ProgressChartProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length < 2) return null;

  const plotW = Math.max(0, width - Y_AXIS_WIDTH);
  // Bars sit in equal slots with a gap either side; thin the bar as the series
  // grows so a 30-day window stays legible instead of becoming a solid block.
  const slot = points.length > 0 ? plotW / points.length : 0;
  const barW = Math.max(3, Math.min(28, slot * 0.62));

  // With more than eight columns the labels would collide — show the ends and
  // the middle, which is what a reader actually needs to orient the axis.
  const dense = points.length > 8;
  const midIndex = Math.floor((points.length - 1) / 2);
  const showLabel = (i: number) =>
    !dense || i === 0 || i === points.length - 1 || i === midIndex;

  const best = points.reduce((m, p) => Math.max(m, p.rate), 0);

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <>
          <Svg width={width} height={height}>
            {GRID.map((g) => {
              const y = (1 - g) * height;
              // Clamp the end lines inward so a 1pt stroke isn't half-clipped.
              const yy = g === 1 ? 0.5 : g === 0 ? height - 0.5 : y;
              return (
                <Line
                  key={g}
                  x1={Y_AXIS_WIDTH}
                  y1={yy}
                  x2={width}
                  y2={yy}
                  stroke={g === 0 ? Hairline.outline : Hairline.track}
                  strokeWidth={1}
                />
              );
            })}
            {points.map((p, i) => {
              const r = Math.max(0, Math.min(1, p.rate));
              const h = r * height;
              const x = Y_AXIS_WIDTH + i * slot + (slot - barW) / 2;
              const isBest = r > 0 && r === best;
              return (
                <Rect
                  key={`${p.label}-${i}`}
                  x={x}
                  // A zero month still gets a 2pt stub so the column is
                  // visibly present-and-empty rather than missing.
                  y={h > 0 ? height - h : height - 2}
                  width={barW}
                  height={h > 0 ? h : 2}
                  rx={2}
                  fill={h > 0 ? Colors.accent : Hairline.track}
                  fillOpacity={h > 0 && !isBest ? 0.75 : 1}
                  accessible
                  accessibilityLabel={`${p.label}, ${Math.round(r * 100)} percent`}
                />
              );
            })}
          </Svg>

          {/* Y-axis labels, positioned over the gridlines they belong to. */}
          <View style={[StyleSheet.absoluteFill, { width: Y_AXIS_WIDTH }]} pointerEvents="none">
            {GRID.filter((g) => g === 0 || g === 0.5 || g === 1).map((g) => (
              <Text
                key={g}
                style={[
                  styles.yLabel,
                  // Nudge the end labels inward so they sit beside the line
                  // rather than hanging off the top and bottom of the plot.
                  { top: (1 - g) * height - (g === 1 ? 0 : g === 0 ? 12 : 6) },
                ]}
              >
                {Math.round(g * 100)}%
              </Text>
            ))}
          </View>

          <View style={[styles.xAxis, { paddingLeft: Y_AXIS_WIDTH }]}>
            {points.map((p, i) => (
              <Text
                key={`${p.label}-x-${i}`}
                numberOfLines={1}
                style={[styles.xLabel, { width: slot }]}
              >
                {showLabel(i) ? p.label : ""}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  yLabel: {
    position: "absolute",
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  xAxis: { flexDirection: "row", marginTop: 6 },
  xLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
});
