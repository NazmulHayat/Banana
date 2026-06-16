import { Colors } from "@/constants/theme";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

interface BrandMarkProps {
  /** Side length of each eye box. Defaults to 40. */
  size?: number;
  /** Blink (boxes fill shut) at random intervals while mounted. */
  blink?: boolean;
  /** The whole face hovers with a gentle bob and sway. */
  float?: boolean;
}

/** Open eye box; blinking fills it solid like the sketch. */
function EyeBox({
  size,
  tilt,
  fill,
}: {
  size: number;
  tilt: number;
  fill: SharedValue<number>;
}) {
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <View
      style={[
        eyeStyles.box,
        { width: size, height: size, transform: [{ rotate: `${tilt}deg` }] },
      ]}
    >
      <Animated.View style={[eyeStyles.fill, fillStyle]} />
    </View>
  );
}

const eyeStyles = StyleSheet.create({
  box: {
    borderWidth: 3,
    borderColor: Colors.ink,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.ink,
  },
});

// Cartoon blink: snap shut, hold a beat, ease back open
function blinkOnce(eye: SharedValue<number>) {
  "worklet";
  eye.value = withSequence(
    withTiming(1, { duration: 80, easing: Easing.in(Easing.quad) }),
    withDelay(140, withTiming(0, { duration: 210, easing: Easing.out(Easing.cubic) })),
  );
}

/**
 * The logo, straight from the notebook sketch: two open boxes sitting
 * almost shoulder-to-shoulder, a small shallow smile tucked underneath.
 * Blinks by filling the boxes solid; floats like a cartoon character.
 */
export function BrandMark({
  size = 40,
  blink = false,
  float = false,
}: BrandMarkProps) {
  const leftFill = useSharedValue(0);
  const rightFill = useSharedValue(0);
  const faceBob = useSharedValue(0);
  const faceSway = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!blink) return;

    const fireBlink = () => {
      const wink = Math.random() < 0.15;
      if (wink) {
        blinkOnce(Math.random() < 0.5 ? leftFill : rightFill);
      } else {
        blinkOnce(leftFill);
        blinkOnce(rightFill);
        // Cartoon double-blink, sometimes
        if (Math.random() < 0.25) {
          timer.current.push(
            setTimeout(() => {
              blinkOnce(leftFill);
              blinkOnce(rightFill);
            }, 480),
          );
        }
      }
    };

    const schedule = () => {
      timer.current.push(
        setTimeout(
          () => {
            fireBlink();
            schedule();
          },
          2400 + Math.random() * 2800,
        ),
      );
    };
    schedule();

    return () => {
      timer.current.forEach(clearTimeout);
      timer.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blink]);

  // The whole face hovers: slow bob + a whisper of sway
  useEffect(() => {
    if (!float) return;
    faceBob.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(4, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    faceSway.value = withDelay(
      400,
      withRepeat(
        withSequence(
          withTiming(-1.4, {
            duration: 2300,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(1.4, {
            duration: 2300,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [float]);

  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: faceBob.value },
      { rotate: `${faceSway.value}deg` },
    ],
  }));

  const gap = size * 0.3;
  const smileWidth = size * 1.8;

  return (
    <Animated.View style={[styles.wrap, faceStyle]}>
      <View style={[styles.eyes, { gap }]}>
        <EyeBox size={size} tilt={-3} fill={leftFill} />
        <EyeBox size={size} tilt={2} fill={rightFill} />
      </View>
      <Svg
        width={smileWidth}
        height={smileWidth * 0.34}
        viewBox="0 0 100 34"
        style={styles.smile}
      >
        <Path
          d="M10 8 C 34 27, 66 27, 90 8"
          stroke={Colors.ink}
          strokeWidth={8}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  eyes: {
    flexDirection: "row",
    alignItems: "center",
  },
  smile: {
    marginTop: 10,
  },
});
