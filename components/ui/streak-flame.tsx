import { Motion } from "@/constants/motion";
import { Colors } from "@/constants/theme";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, G, Path } from "react-native-svg";

/**
 * The streak mark: our character, standing inside the fire.
 *
 * The flame is a ring around him — licks on top, body wrapping the sides —
 * with a paper-clear middle he lives in, so the fire can never touch the eyes
 * or the smile. As the streak grows the ring grows with it: more licks, a
 * heavier highlighter fill, heat-lines off the sides, sparks landing on the
 * page. He doesn't change; his fire does.
 *
 * No glow — a pen has no glow. The heat is drawn: the accent fill is the same
 * path nudged +0.45,−0.3 UNDER the ink outline (a highlighter that doesn't
 * quite stay inside the lines), and the fill gets more solid per tier.
 * Design: Fable 5 concept, reshaped to a surround 2026-08-20.
 */

export type StreakTier = 0 | 1 | 2 | 3 | 4;

/** Where the fire changes. Matches the stamp thresholds. */
export const STREAK_TIERS = [1, 7, 30, 100] as const;

export function streakTier(streak: number): StreakTier {
  if (streak <= 0) return 0;
  if (streak < STREAK_TIERS[1]) return 1;
  if (streak < STREAK_TIERS[2]) return 2;
  if (streak < STREAK_TIERS[3]) return 3;
  return 4;
}

/** Days until the fire next changes, or null once it's fully grown. */
export function daysToNextTier(streak: number): number | null {
  for (const t of STREAK_TIERS) {
    if (streak < t) return t - streak;
  }
  return null;
}

/** Below this only the flame silhouette is drawn — a face would be mush. */
const FACE_MIN_SIZE = 30;

// ---------------------------------------------------------------------------
// The drawing (24×24 viewBox) — paths from the verified design render.
// ---------------------------------------------------------------------------

// The ring. Each path starts at a top lick, wraps down one side, under, and
// back up — the face-sized hole is cut by CORE (paper) drawn on top.
const FLAME: Record<1 | 2 | 3 | 4, string> = {
  1: "M12 3.6 C13.0 4.8 12.5 5.4 13.4 6.2 C16.3 7.3 18.6 9.2 18.6 12.0 C18.6 15.9 15.7 18.6 12 18.6 C8.3 18.6 5.4 15.9 5.4 12.0 C5.4 9.0 7.8 7.0 10.6 6.1 C11.4 5.3 11.6 4.6 12 3.6 Z",
  2: "M10.6 3.4 C10.9 4.6 10.4 5.2 10.9 5.9 C11.5 5.0 11.9 4.1 13.4 2.8 C13.2 4.3 13.9 5.1 14.4 6.0 C17.3 7.2 19.0 9.4 19.0 12.2 C19.0 16.2 15.9 19.0 12 19.0 C8.1 19.0 5.0 16.2 5.0 12.2 C5.0 9.3 6.9 7.1 9.8 6.0 C10.2 5.1 10.3 4.3 10.6 3.4 Z",
  3: "M8.9 4.4 C9.3 5.4 9.0 6.0 9.5 6.6 C10.0 5.2 10.6 3.6 12.2 2.2 C12.1 3.9 12.8 4.9 13.4 5.9 C14.0 5.2 14.6 4.8 15.5 4.5 C15.6 5.6 15.4 6.3 15.8 7.0 C18.2 8.4 19.6 10.3 19.6 12.6 C19.6 16.6 16.2 19.4 12 19.4 C7.8 19.4 4.4 16.6 4.4 12.6 C4.4 10.1 5.9 8.1 8.3 6.9 C8.6 6.1 8.7 5.2 8.9 4.4 Z",
  4: "M7.6 4.9 C8.2 5.9 7.9 6.6 8.5 7.2 C8.6 5.4 9.4 3.4 11.9 1.6 C11.7 3.5 12.5 4.6 13.2 5.6 C13.9 4.6 14.9 3.9 16.2 3.7 C16.0 4.9 15.9 5.8 16.2 6.7 C18.9 8.2 20.2 10.4 20.2 12.8 C20.2 17.0 16.5 19.8 12 19.8 C7.5 19.8 3.8 17.0 3.8 12.8 C3.8 10.2 5.2 8.1 7.2 6.9 C7.4 6.2 7.5 5.6 7.6 4.9 Z",
};

/** How solid the highlighter is — the "more glowing" per tier. */
const FIRE_FILL = [0, 0.35, 0.5, 0.7, 0.85] as const;

/** Heat-lines off the sides, tier 3 up — drawn heat, not rendered glow. */
const HEAT_L = "M3.6 10.2 C3.2 11.2 3.2 12.4 3.6 13.4";
const HEAT_R = "M20.4 10.2 C20.8 11.2 20.8 12.4 20.4 13.4";

/**
 * The room he lives in: a paper blob cut out of the ring, sized so the fire
 * clears the eyes and the smile with margin at every tier. One shape for all
 * tiers — the face never moves; only the fire around it does.
 */
const CORE =
  "M12 5.8 C15.6 5.8 17.9 8.2 17.9 11.6 C17.9 15.2 15.4 17.4 12 17.4 C8.6 17.4 6.1 15.2 6.1 11.6 C6.1 8.2 8.4 5.8 12 5.8 Z";

// The face, centred in the core — the brand boxes and smile, slightly wobbly.
const LEFT_EYE = "M8.2 10.2 L10.6 10.0 L10.75 12.4 L8.4 12.6 Z";
const RIGHT_EYE = "M12.9 10.0 L15.3 10.2 L15.1 12.6 L12.75 12.4 Z";
const SMILE = "M9.6 14.4 C10.7 15.5 13.0 15.6 14.3 14.4";
/** Tier 4: right corner pulled higher. He knows. */
const SMUG_SMILE = "M9.7 14.6 C10.8 15.7 12.9 15.7 14.3 14.2";

// Sunglasses furniture (tier 4): the blink state made permanent.
const BRIDGE = "M10.7 10.3 C11.3 10.05 12.3 10.05 12.85 10.25";
const TEMPLE_L = "M8.25 10.4 L7.3 10.0";
const TEMPLE_R = "M15.25 10.4 L16.2 10.0";
const GLINT_LONG = "M8.8 12.2 L10.2 10.5";
const GLINT_S1 = "M9.7 12.45 L10.3 11.7";
const GLINT_S2 = "M13.4 12.2 L14.5 10.7";

interface Spark {
  line?: string;
  dot?: { cx: number; cy: number; r: number };
}
const SPARKS: Record<3 | 4, Spark[]> = {
  3: [
    { line: "M17.4 4.6 L18.0 3.7" },
    { dot: { cx: 16.9, cy: 2.9, r: 0.6 } },
  ],
  4: [
    { line: "M18.9 4.4 L19.6 3.4" },
    { line: "M4.9 5.6 L4.3 4.6" },
    { dot: { cx: 18.4, cy: 2.2, r: 0.7 } },
    { dot: { cx: 5.6, cy: 2.8, r: 0.6 } },
  ],
};

/**
 * Tiny (pill) mode: ring + paper core, no face. The little donut-of-fire is
 * the character abstracted, and its size per tier is itself a growth signal.
 */
const TINY_SCALE = [0, 0.92, 1.0, 1.08, 1.16] as const;

/** Offset "highlighter" fill — under the ink line, not quite inside it. */
const FILL_OFFSET = "translate(0.45 -0.3)";

// Blink cadence, identical to BrandMark so the two faces blink the same way.
const DOUBLE_BLINK_GAP_MS = 480;
const BLINK_MIN_GAP_MS = 2400;
const BLINK_JITTER_MS = 2800;
/** The tier-4 glint sweep — a sunglasses glint is the blink's cool older brother. */
const GLINT_SWEEP_GAP_MS = 9000;

function blinkOnce(eye: SharedValue<number>) {
  "worklet";
  eye.value = withSequence(
    withTiming(1, { duration: Motion.blink.shut, easing: Easing.in(Easing.quad) }),
    withDelay(
      Motion.blink.hold,
      withTiming(0, { duration: Motion.blink.open, easing: Easing.out(Easing.cubic) }),
    ),
  );
}

interface StreakFlameProps {
  streak: number;
  size?: number;
  accent?: string;
  /** Bumped by the parent when the streak goes UP, to fire the flare. */
  flareKey?: number;
}

export function StreakFlame({
  streak,
  size = 20,
  accent = Colors.accent,
  flareKey = 0,
}: StreakFlameProps) {
  const reduceMotion = useReduceMotion();
  const tier = streakTier(streak);
  const tiny = size < FACE_MIN_SIZE;

  // One creature: face and flame share the root. The flicker rides on top at a
  // higher frequency, the way hair moves on a bobbing head — independent drift
  // would re-split the drawing into "face pasted on flame".
  const bob = useSharedValue(0);
  const sway = useSharedValue(0);
  const flick = useSharedValue(0);
  const flare = useSharedValue(0);
  const squash = useSharedValue(0);
  const tierPop = useSharedValue(1);
  const sparkA = useSharedValue(1);
  const sparkB = useSharedValue(1);
  const glintSweep = useSharedValue(0);
  const leftEye = useSharedValue(0);
  const rightEye = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const firstFlare = useRef(true);
  const firstTier = useRef(true);

  useEffect(() => {
    if (reduceMotion || tier === 0 || tiny) {
      bob.value = 0;
      sway.value = 0;
      flick.value = 0;
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        withTiming(4, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    // Non-multiple periods so the phases drift, like the brand mark.
    sway.value = withRepeat(
      withSequence(
        withTiming(-1.4, { duration: 3400, easing: Easing.inOut(Easing.sin) }),
        withTiming(1.4, { duration: 3400, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    flick.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 460, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    sparkA.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    sparkB.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, tier, tiny]);

  // Blink — tiers 1–3. Tier 4 never blinks (shades); its glint sweeps instead.
  useEffect(() => {
    if (tiny || reduceMotion || tier === 0) return;
    if (tier >= 4) {
      const sweep = () => {
        glintSweep.value = withSequence(
          withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 }),
        );
      };
      const schedule = () => {
        timers.current.push(
          setTimeout(() => {
            sweep();
            schedule();
          }, GLINT_SWEEP_GAP_MS + Math.random() * 2000),
        );
      };
      schedule();
      return () => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
      };
    }
    const fire = () => {
      if (Math.random() < 0.15) {
        blinkOnce(Math.random() < 0.5 ? leftEye : rightEye);
      } else {
        blinkOnce(leftEye);
        blinkOnce(rightEye);
        if (Math.random() < 0.25) {
          timers.current.push(
            setTimeout(() => {
              blinkOnce(leftEye);
              blinkOnce(rightEye);
            }, DOUBLE_BLINK_GAP_MS),
          );
        }
      }
    };
    const schedule = () => {
      timers.current.push(
        setTimeout(
          () => {
            fire();
            schedule();
          },
          BLINK_MIN_GAP_MS + Math.random() * BLINK_JITTER_MS,
        ),
      );
    };
    schedule();
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiny, reduceMotion, tier]);

  // Flare: anticipation squash, then the flame surges and springs back.
  useEffect(() => {
    if (firstFlare.current) {
      firstFlare.current = false;
      return;
    }
    if (reduceMotion) return;
    squash.value = withSequence(
      withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(0, Motion.springBouncy),
    );
    flare.value = withDelay(
      110,
      withSequence(
        withSpring(1, { damping: 10, stiffness: 240, mass: 0.6 }),
        withSpring(0, Motion.springBouncy),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flareKey, reduceMotion]);

  // Tier-up: no path morph — the old flame is unmounted by React and the new
  // one springs in from 0.6 with overshoot. The hard cut IS the reward.
  useEffect(() => {
    if (firstTier.current) {
      firstTier.current = false;
      return;
    }
    if (reduceMotion) return;
    tierPop.value = 0.6;
    tierPop.value = withSpring(1, Motion.springBouncy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, reduceMotion]);

  // Licks stretch upward from the ring's base, so scaling pivots there.
  const pivotY = size * (19 / 24);

  const rootStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: bob.value * (size / 120) },
      { rotate: `${sway.value}deg` },
      // Anticipation: squash down, widen — origin at the flame root.
      { translateY: pivotY },
      { scaleY: 1 - squash.value * 0.07 },
      { scaleX: 1 + squash.value * 0.04 },
      { translateY: -pivotY },
    ],
  }));

  const flameStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pivotY },
      {
        scaleY:
          interpolate(flick.value, [0, 1], [0.965, 1.045]) *
          tierPop.value *
          (1 + flare.value * 0.28),
      },
      { scaleX: tierPop.value },
      { rotate: `${interpolate(flick.value, [0, 1], [-1.6, 1.6])}deg` },
      { translateY: -pivotY },
    ],
  }));

  // The paper core runs counter-phase to the outer flame — that interior
  // shimmer is what makes it feel alive.
  const coreStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: pivotY },
      { scaleY: interpolate(flick.value, [0, 1], [1.06, 0.955]) },
      { translateY: -pivotY },
    ],
  }));

  const sparkAStyle = useAnimatedStyle(() => ({ opacity: sparkA.value }));
  const sparkBStyle = useAnimatedStyle(() => ({ opacity: sparkB.value }));
  const leftEyeStyle = useAnimatedStyle(() => ({ opacity: leftEye.value }));
  const rightEyeStyle = useAnimatedStyle(() => ({ opacity: rightEye.value }));
  const glintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(glintSweep.value, [0, 0.5, 1], [0, 1, 0]),
    transform: [
      { translateX: interpolate(glintSweep.value, [0, 1], [-2, 2]) * (size / 24) },
      { translateY: interpolate(glintSweep.value, [0, 1], [2, -2]) * (size / 24) },
    ],
  }));

  if (tier === 0) return <View style={{ width: size, height: size }} />;

  const s = size;
  const flameTier = tier as 1 | 2 | 3 | 4;

  // ------- tiny: silhouette only, static — nothing more reads at 16pt -------
  if (tiny) {
    const k = TINY_SCALE[flameTier];
    return (
      <View style={{ width: s, height: s }}>
        <Svg width={s} height={s} viewBox="0 0 24 24">
          <G transform={`translate(${12 * (1 - k)} ${11.5 * (1 - k)}) scale(${k})`}>
            <Path
              d={FLAME[flameTier]}
              fill={accent}
              stroke={Colors.ink}
              strokeWidth={1.6 / k}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Path d={CORE} fill={Colors.paper} />
          </G>
        </Svg>
      </View>
    );
  }

  // ---------------------------- full character ----------------------------
  const tier34 = flameTier >= 3 ? (flameTier as 3 | 4) : null;

  return (
    <Animated.View style={[{ width: s, height: s }, rootStyle]}>
      {/* The ring of fire. Highlighter first, ink line on top, then the paper
          room is cut out of it — everything the face needs stays clear. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, flameStyle]}>
        <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <G transform={FILL_OFFSET}>
            <Path d={FLAME[flameTier]} fill={accent} fillOpacity={FIRE_FILL[flameTier]} />
          </G>
          <Path
            d={FLAME[flameTier]}
            stroke={Colors.ink}
            strokeWidth={1.1}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {flameTier >= 3 && (
            <>
              <Path d={HEAT_L} stroke={accent} strokeWidth={1.1} strokeLinecap="round" />
              <Path d={HEAT_R} stroke={accent} strokeWidth={1.1} strokeLinecap="round" />
            </>
          )}
        </Svg>
      </Animated.View>

      {/* The room — breathes counter-phase to the ring, an interior shimmer. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, coreStyle]}>
        <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <Path d={CORE} fill={Colors.paper} />
        </Svg>
      </Animated.View>

      {/* Stray sparks landing on the page. */}
      {tier34 &&
        SPARKS[tier34].map((spark, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, i % 2 === 0 ? sparkAStyle : sparkBStyle]}
          >
            <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
              {spark.line && (
                <Path
                  d={spark.line}
                  stroke={Colors.ink}
                  strokeWidth={1.0}
                  strokeLinecap="round"
                />
              )}
              {spark.dot && (
                <Circle
                  cx={spark.dot.cx}
                  cy={spark.dot.cy}
                  r={spark.dot.r}
                  fill={accent}
                />
              )}
            </Svg>
          </Animated.View>
        ))}

      {/* Him. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
          <Path
            d={LEFT_EYE}
            fill={flameTier >= 4 ? Colors.ink : "none"}
            stroke={Colors.ink}
            strokeWidth={flameTier >= 4 ? 1.1 : 1.3}
            strokeLinejoin="round"
          />
          <Path
            d={RIGHT_EYE}
            fill={flameTier >= 4 ? Colors.ink : "none"}
            stroke={Colors.ink}
            strokeWidth={flameTier >= 4 ? 1.1 : 1.3}
            strokeLinejoin="round"
          />
          {flameTier >= 4 && (
            <>
              <Path d={BRIDGE} stroke={Colors.ink} strokeWidth={0.8} strokeLinecap="round" />
              <Path d={TEMPLE_L} stroke={Colors.ink} strokeWidth={1.0} strokeLinecap="round" />
              <Path d={TEMPLE_R} stroke={Colors.ink} strokeWidth={1.0} strokeLinecap="round" />
              <Path d={GLINT_S1} stroke={Colors.paper} strokeWidth={0.9} strokeLinecap="round" />
              <Path d={GLINT_S2} stroke={Colors.paper} strokeWidth={0.9} strokeLinecap="round" />
            </>
          )}
          <Path
            d={flameTier >= 4 ? SMUG_SMILE : SMILE}
            stroke={Colors.ink}
            strokeWidth={1.1}
            strokeLinecap="round"
          />
        </Svg>
      </View>

      {/* Blink overlays — the boxes fill solid, exactly like the brand mark. */}
      {flameTier < 4 && (
        <>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, leftEyeStyle]}>
            <Svg width={s} height={s} viewBox="0 0 24 24">
              <Path d={LEFT_EYE} fill={Colors.ink} />
            </Svg>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, rightEyeStyle]}>
            <Svg width={s} height={s} viewBox="0 0 24 24">
              <Path d={RIGHT_EYE} fill={Colors.ink} />
            </Svg>
          </Animated.View>
        </>
      )}

      {/* The sweeping glint — tier 4's blink. */}
      {flameTier >= 4 && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glintStyle]}>
          <Svg width={s} height={s} viewBox="0 0 24 24" fill="none">
            <Path d={GLINT_LONG} stroke={Colors.paper} strokeWidth={1.5} strokeLinecap="round" />
          </Svg>
        </Animated.View>
      )}
    </Animated.View>
  );
}
