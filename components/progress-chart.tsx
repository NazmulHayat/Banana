import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Rect } from "react-native-svg";

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
const DOT_R = 4;
/**
 * Breathing room above and below the plot. A 100% month puts the trend line
 * exactly on the top edge, so without this its stroke and its dot are sliced
 * in half by the SVG bounds — and the same happens at 0%. Sized off the dot,
 * since that's the widest thing that can sit on a boundary.
 */
const PAD = DOT_R + 4;
/**
 * Every bar the same weight. Singling the best month out with a stronger fill
 * made the chart look like it had two categories in it when it only has one —
 * the height already says which month was best.
 */
const BAR_OPACITY = 0.72;

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
  // The cap exists to stop three months rendering as three slabs — but at 28pt
  // in a 108pt slot they instead read as three lonely sticks. Scale it: few
  // bars get to be wide, many bars stay slim.
  const maxBarW = points.length <= 3 ? 40 : points.length <= 6 ? 32 : 26;
  const barW = Math.max(3, Math.min(maxBarW, slot * 0.62));

  // With more than eight columns the labels would collide — show the ends and
  // the middle, which is what a reader actually needs to orient the axis.
  const dense = points.length > 8;
  const midIndex = Math.floor((points.length - 1) / 2);
  const showLabel = (i: number) =>
    !dense || i === 0 || i === points.length - 1 || i === midIndex;

  // The trend line runs through the centre of each bar's top. It carries the
  // same numbers the bars do, which is normally double-encoding — but bars of
  // similar height read as a wall, and the direction of travel is the thing
  // anyone actually wants from this chart. The bars step back (lower opacity)
  // so the line is the sentence and they're the footnotes.
  // Everything is drawn inside a plot band inset by PAD, so nothing that sits
  // on 0% or 100% can be clipped by the canvas edge.
  const baseline = PAD + height;
  const centreX = (i: number) => Y_AXIS_WIDTH + i * slot + slot / 2;
  const topY = (rate: number) => {
    const r = Math.max(0, Math.min(1, rate));
    // Sit on top of the 2pt stub a zero month draws, not below it.
    return r > 0 ? baseline - r * height : baseline - 2;
  };
  const trend = points.map((p, i) => `${centreX(i)},${topY(p.rate)}`).join(" ");

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <>
          <Svg width={width} height={height + PAD * 2}>
            {GRID.map((g) => {
              // The padding already keeps a 1pt stroke off the canvas edge, so
              // the gridlines sit exactly on their values.
              const yy = PAD + (1 - g) * height;
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
              return (
                <Rect
                  key={`${p.label}-${i}`}
                  x={x}
                  // A zero month still gets a 2pt stub so the column is
                  // visibly present-and-empty rather than missing.
                  y={h > 0 ? baseline - h : baseline - 2}
                  width={barW}
                  height={h > 0 ? h : 2}
                  rx={2}
                  fill={h > 0 ? Colors.accent : Hairline.track}
                  // Muted so the trend line reads first.
                  fillOpacity={h > 0 ? BAR_OPACITY : 1}
                  accessible
                  accessibilityLabel={`${p.label}, ${Math.round(r * 100)} percent`}
                />
              );
            })}

            <Polyline
              points={trend}
              fill="none"
              stroke={Colors.ink}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* A dot on every point: the line shows the direction, the dots
                show that each one is a real reading rather than an
                interpolation. Paper-coloured centre so a dot sitting on the
                accent bar behind it still reads as a separate mark. */}
            {points.map((p, i) => (
              <Circle
                key={`dot-${p.label}-${i}`}
                cx={centreX(i)}
                cy={topY(p.rate)}
                r={DOT_R}
                fill={Colors.paper}
                stroke={Colors.ink}
                strokeWidth={2}
              />
            ))}
          </Svg>

          {/* Y-axis labels, positioned over the gridlines they belong to. */}
          <View style={[StyleSheet.absoluteFill, { width: Y_AXIS_WIDTH }]} pointerEvents="none">
            {GRID.filter((g) => g === 0 || g === 0.5 || g === 1).map((g) => (
              <Text
                key={g}
                style={[
                  styles.yLabel,
                  // Offset by PAD to follow the plot band, then nudge the end
                  // labels inward so they sit beside their line rather than
                  // hanging off the top and bottom of it.
                  {
                    top:
                      PAD + (1 - g) * height - (g === 1 ? 0 : g === 0 ? 12 : 6),
                  },
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
