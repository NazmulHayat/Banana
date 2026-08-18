import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { todayKey } from "@/lib/dates";
import type { Stamp } from "@/lib/gamification";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, Line, Pattern, Rect } from "react-native-svg";

interface StampGridProps {
  /** Stamps to draw, in display order. */
  stamps: Stamp[];
  /** Show the progress arc + threshold for unearned stamps. Default true. */
  showProgress?: boolean;
}

const SIZE = 84;
const RING = SIZE / 2 - 4;
const CIRC = 2 * Math.PI * RING;
const HAIRLINE = "rgba(26,26,26,0.16)";

/** The stamp's headline — derived from its kind, not stored anywhere. */
function title(stamp: Stamp): string {
  switch (stamp.kind) {
    case "streak":
      return `${stamp.threshold}-day run`;
    case "journal":
      return stamp.threshold === 1 ? "First entry" : `${stamp.threshold} entries`;
    case "perfect-week":
      return "Perfect week";
    case "perfect-days":
      return `${stamp.threshold} perfect days`;
  }
}

/** The line under the stamp: whose it is, or when it was earned. */
function caption(stamp: Stamp): string {
  if (stamp.kind === "streak") return stamp.habitName ?? "";
  if (stamp.earned && stamp.earnedOn) return stamp.earnedOn;
  return `${stamp.best} / ${stamp.threshold}`;
}

interface StampBadgeProps {
  stamp: Stamp;
  index: number;
  showProgress: boolean;
}

/**
 * One pressed-ink stamp: a perforated ring (postage-stamp edge), a crosshatch
 * field when earned — the same hatch the heatmap uses — and an accent arc for
 * how far along an unearned one is. Settles in with a quiet spring.
 */
function StampBadge({ stamp, index, showProgress }: StampBadgeProps) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = Math.min(index, Motion.staggerCap) * Motion.stagger;
    const anim = Animated.spring(enter, {
      toValue: 1,
      delay,
      useNativeDriver: true,
      ...Motion.spring, // quiet settle — no bounce, nothing celebratory
    });
    anim.start();
    return () => anim.stop();
  }, [enter, index]);

  const arc = showProgress ? Math.max(0, Math.min(1, stamp.progress)) : 0;
  // Stamp ids carry ":" separators; SVG ids must stay plain for url(#…).
  const patternId = `stamp-hatch-${stamp.id.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  return (
    <Animated.View
      style={[
        styles.item,
        {
          opacity: enter,
          transform: [
            { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
    >
      <View style={styles.badge}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <Pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width={5}
              height={5}
            >
              <Line x1="0" y1="0" x2="5" y2="5" stroke={Colors.ink} strokeWidth="1.2" />
              <Line x1="5" y1="0" x2="0" y2="5" stroke={Colors.ink} strokeWidth="1.2" />
            </Pattern>
          </Defs>
          {/* Perforated edge — earned stamps get the full ink bite. */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RING}
            fill={stamp.earned ? `url(#${patternId})` : "transparent"}
            fillOpacity={stamp.earned ? 0.16 : 0}
            stroke={stamp.earned ? Colors.ink : HAIRLINE}
            strokeWidth={1.5}
            strokeDasharray="2 4"
          />
          {/* Inner ring, drawn solid for earned and as a progress arc otherwise. */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RING - 6}
            fill="transparent"
            stroke={stamp.earned ? Colors.accent : HAIRLINE}
            strokeWidth={stamp.earned ? 2.5 : 1}
          />
          {!stamp.earned && arc > 0 && (
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RING - 6}
              fill="transparent"
              stroke={Colors.accent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={`${arc * CIRC} ${CIRC}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          )}
          {/* Keeps the SVG's intrinsic box stable across platforms. */}
          <Rect x={0} y={0} width={SIZE} height={SIZE} fill="transparent" />
        </Svg>
        <View style={styles.center} pointerEvents="none">
          <Text style={[styles.number, !stamp.earned && styles.dim]}>
            {stamp.threshold}
          </Text>
        </View>
      </View>
      <Text style={[styles.title, !stamp.earned && styles.dim]} numberOfLines={1}>
        {title(stamp)}
      </Text>
      <Text style={styles.caption} numberOfLines={1}>
        {caption(stamp)}
      </Text>
    </Animated.View>
  );
}

/**
 * FR-G3 — the permanent stamp wall. Stamps are derived from best-ever values,
 * so nothing here disappears when a streak breaks. A single light haptic fires
 * when something was earned today; nothing modal, nothing blocking.
 */
export function StampGrid({ stamps, showProgress = true }: StampGridProps) {
  const celebrated = useRef(false);

  useEffect(() => {
    if (celebrated.current) return;
    const today = todayKey();
    if (stamps.some((s) => s.earned && s.earnedOn === today)) {
      celebrated.current = true;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [stamps]);

  if (stamps.length === 0) return null;

  return (
    <View style={styles.grid}>
      {stamps.map((s, i) => (
        <StampBadge key={s.id} stamp={s} index={i} showProgress={showProgress} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 18 },
  item: { width: "33.33%", alignItems: "center" },
  badge: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  number: { fontSize: 22, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  title: {
    fontSize: 12.5,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    marginTop: 6,
    textAlign: "center",
  },
  caption: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    paddingHorizontal: 4,
  },
  dim: { opacity: 0.45 },
});
