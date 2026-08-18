import { Colors } from "@/constants/theme";
import { useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

interface StatSparklineProps {
  /** Values in 0..1 (e.g. monthly completion rates), oldest → newest. */
  values: number[];
  height?: number;
}

/**
 * A tiny trend line for the 6-month completion-rate series. Honest 0..1 scale
 * (top = 100%), last point dotted in accent. One SVG node, measures its width.
 */
export function StatSparkline({ values, height = 40 }: StatSparklineProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const pad = 5;
  const n = values.length;
  let points = "";
  let lastX = 0;
  let lastY = 0;
  if (width > 0 && n > 1) {
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    points = values
      .map((v, i) => {
        const x = pad + (i / (n - 1)) * innerW;
        const y = pad + (1 - Math.max(0, Math.min(1, v))) * innerH;
        if (i === n - 1) {
          lastX = x;
          lastY = y;
        }
        return `${x},${y}`;
      })
      .join(" ");
  }

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && n > 1 && (
        <Svg width={width} height={height}>
          <Polyline
            points={points}
            fill="none"
            stroke={Colors.ink}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Circle cx={lastX} cy={lastY} r={3.5} fill={Colors.accent} stroke={Colors.ink} strokeWidth={1} />
        </Svg>
      )}
    </View>
  );
}
