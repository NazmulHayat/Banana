import { Motion } from "@/constants/motion";
import { Colors } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Line, Path, Pattern, Rect } from "react-native-svg";
import {
  HandwrittenWordmark,
  WORDMARK_TOTAL_MS,
} from "./handwritten-wordmark";
import { PaperBackground } from "./ui/paper-background";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

// ─── Story ───────────────────────────────────────────────────────
// Five boxes sketch themselves in a row. They tick one by one — the
// crosshatch sweeps in like pen shading. Then two of them drift
// together and open up (hatch clears) to become the eyes, the rest
// melt away, the deep ink smile draws itself, the face blinks hello
// and floats while the name writes in. A long beat — then the whole
// page slowly scrolls up into the app.

const BLOCK = 44;
const ROW_XS = [-116, -58, 0, 58, 116];
const EYES: Record<number, { x: number; y: number; r: number }> = {
  1: { x: -29, y: -14, r: -3 },
  3: { x: 29, y: -14, r: 2 },
};

// ─── Timeline (ms) — slow, with room to breathe ─────────────────
const DRAW_START_MS = 400;
const DRAW_STAGGER_MS = 140;
const DRAW_MS = 520;
const TICK_AT_MS = [2000, 2400, 2800, 3200, 3600];
const FORM_AT_MS = 4400;
const SMILE_AT_MS = 5600;
const BLINK_AT_MS = 6500;
// Name finishes writing ~9s; hold a comfortable beat, then drift
// down to the login screen.
const EXIT_AT_MS = 11000;
const EXIT_MS = 1700;
// Storyboard beats. These are one-off cinematography, not part of the app's
// UI motion scale, so they're named here instead of bloating `Motion`. The
// beats that ARE shared with BrandMark (blink, float) come from `Motion`.
const TICK_FADE_MS = 120;
const TICK_WIPE_MS = 420;
const TICK_PRESS_MS = 110;
const TICK_SPRING = { damping: 13, stiffness: 190 };
const EYE_TRAVEL_MS = 900;
const MELT_MS = 600;
const HATCH_CLEAR_DELAY_MS = 300;
const SMILE_DRAW_MS = 680;
const FLOURISH_MS = 420;
const FLOURISH_DELAY_MS = 100;
/** Skipped or Reduce-Motion exits: get out of the way, don't perform. */
const SKIP_EXIT_MS = 480;
const SKIP_HOLD_MS = 350;
const REDUCED_HOLD_MS = 700;

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

// Box outline geometry (sketch-in stroke)
const BOX_INSET = 2;
const BOX_SIDE = BLOCK - BOX_INSET * 2;
const BOX_PERIMETER = BOX_SIDE * 4;

// Smile: same small shallow curve as the BrandMark logo
const SMILE_D = "M10 8 C 34 27, 66 27, 90 8";
const SMILE_DASH = 110;
const SMILE_W = 80;

// Underline flourish drawn after the name finishes writing
const FLOURISH_DASH = 100;

interface AnimatedSplashProps {
  /** Called once the splash has scrolled away. Unmount it then. */
  onDone: () => void;
}

export function AnimatedSplash({ onDone }: AnimatedSplashProps) {
  const [tickPhase, setTickPhase] = useState(0);
  const [formed, setFormed] = useState(false);
  const [showName, setShowName] = useState(false);
  const [blinkCount, setBlinkCount] = useState(0);
  const [floating, setFloating] = useState(false);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finishedRef = useRef(false);

  const overlayY = useSharedValue(0);
  const smileProgress = useSharedValue(0);
  const flourishProgress = useSharedValue(0);
  const faceBob = useSharedValue(0);
  const faceSway = useSharedValue(0);

  // Once the face is alive, the whole thing hovers like a cartoon
  useEffect(() => {
    if (!floating) return;
    faceBob.value = withRepeat(
      withSequence(
        withTiming(-4, {
          duration: Motion.float.bob,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(4, {
          duration: Motion.float.bob,
          easing: Easing.inOut(Easing.sin),
        }),
      ),
      -1,
      true,
    );
    faceSway.value = withDelay(
      Motion.float.swayDelay,
      withRepeat(
        withSequence(
          withTiming(-1.4, {
            duration: Motion.float.sway,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(1.4, {
            duration: Motion.float.sway,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating]);

  const clearTimers = () => {
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  };

  const finish = (slow: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    clearTimers();
    const height = Dimensions.get("window").height;
    overlayY.value = withTiming(
      -height,
      {
        duration: slow ? EXIT_MS : SKIP_EXIT_MS,
        easing: slow ? Easing.inOut(Easing.sin) : Easing.inOut(Easing.cubic),
      },
      (done) => {
        if (done) runOnJS(onDone)();
      },
    );
  };

  const showFinalFrame = () => {
    setTickPhase(ROW_XS.length);
    setFormed(true);
    setShowName(true);
    setFloating(true);
    smileProgress.value = 1;
    flourishProgress.value = 1;
  };

  const skip = () => {
    if (finishedRef.current) return;
    clearTimers();
    showFinalFrame();
    timeouts.current.push(setTimeout(() => finish(false), SKIP_HOLD_MS));
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => setReduceMotion(!!enabled))
      .catch(() => setReduceMotion(false));
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;

    if (reduceMotion) {
      showFinalFrame();
      timeouts.current.push(setTimeout(() => finish(false), REDUCED_HOLD_MS));
      return clearTimers;
    }

    TICK_AT_MS.forEach((at, i) => {
      timeouts.current.push(
        setTimeout(() => {
          setTickPhase(i + 1);
          void Haptics.selectionAsync();
        }, at),
      );
    });

    timeouts.current.push(setTimeout(() => setFormed(true), FORM_AT_MS));

    timeouts.current.push(
      setTimeout(() => {
        smileProgress.value = withTiming(1, {
          duration: SMILE_DRAW_MS,
          easing: EASE_OUT,
        });
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, SMILE_AT_MS),
    );

    timeouts.current.push(
      setTimeout(() => {
        setBlinkCount((c) => c + 1);
        setShowName(true);
        setFloating(true);
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // Pen flourish under the name once the last letter is inked
        flourishProgress.value = withDelay(
          WORDMARK_TOTAL_MS + FLOURISH_DELAY_MS,
          withTiming(1, { duration: FLOURISH_MS, easing: EASE_OUT }),
        );
      }, BLINK_AT_MS),
    );

    timeouts.current.push(setTimeout(() => finish(true), EXIT_AT_MS));

    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: overlayY.value }],
  }));
  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: faceBob.value },
      { rotate: `${faceSway.value}deg` },
    ],
  }));
  const smileProps = useAnimatedProps(() => ({
    strokeDashoffset: SMILE_DASH * (1 - smileProgress.value),
  }));
  const flourishProps = useAnimatedProps(() => ({
    strokeDashoffset: FLOURISH_DASH * (1 - flourishProgress.value),
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
    >
      <PaperBackground>
        {/* The splash is pure drawing — announce it as one thing, and say
            it's skippable, since nothing else on screen is. */}
        <Pressable
          style={styles.fill}
          onPress={skip}
          accessibilityRole="button"
          accessibilityLabel="Aight Bet"
          accessibilityHint="Double tap to skip the intro"
        >
          <View style={styles.center}>
            <Animated.View style={[styles.faceArea, faceStyle]}>
              {ROW_XS.map((x, i) => (
                <RowBlock
                  key={i}
                  index={i}
                  x={x}
                  eye={EYES[i]}
                  ticked={i < tickPhase}
                  formed={formed}
                  blinkCount={blinkCount}
                  instant={reduceMotion === true}
                />
              ))}
              {/* Deep ink smile, drawn under the eyes */}
              <Svg
                width={SMILE_W}
                height={SMILE_W * 0.34}
                viewBox="0 0 100 34"
                style={styles.smile}
              >
                <AnimatedPath
                  d={SMILE_D}
                  stroke={Colors.ink}
                  strokeWidth={8}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${SMILE_DASH}`}
                  animatedProps={smileProps}
                />
              </Svg>
            </Animated.View>

            <View style={styles.nameBlock}>
              {showName && (
                <HandwrittenWordmark
                  width={230}
                  instant={reduceMotion === true}
                />
              )}
              {showName && (
                <Svg
                  width={190}
                  height={14}
                  viewBox="0 0 100 10"
                  style={styles.flourish}
                >
                  <AnimatedPath
                    d="M3 6 C 30 2, 68 9, 97 4"
                    stroke={Colors.ink}
                    strokeWidth={2.6}
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={`${FLOURISH_DASH}`}
                    animatedProps={flourishProps}
                  />
                </Svg>
              )}
            </View>
          </View>
        </Pressable>
      </PaperBackground>
    </Animated.View>
  );
}

function RowBlock({
  index,
  x,
  eye,
  ticked,
  formed,
  blinkCount,
  instant,
}: {
  index: number;
  x: number;
  eye?: { x: number; y: number; r: number };
  ticked: boolean;
  formed: boolean;
  blinkCount: number;
  instant: boolean;
}) {
  const isEye = !!eye;

  const borderProgress = useSharedValue(instant ? 1 : 0);
  const opacity = useSharedValue(instant && !isEye ? 0 : 1);
  const tx = useSharedValue(instant && eye ? eye.x : x);
  const ty = useSharedValue(instant && eye ? eye.y : 0);
  const rot = useSharedValue(instant && eye ? eye.r : 0);
  const scale = useSharedValue(1);
  // Pen-shading wipe: hatch slides in from the left inside the box
  const hatchWipe = useSharedValue(-BLOCK);
  const hatchOpacity = useSharedValue(0);
  const blinkFill = useSharedValue(0);

  // The box sketches its own outline
  useEffect(() => {
    if (instant) return;
    borderProgress.value = withDelay(
      DRAW_START_MS + index * DRAW_STAGGER_MS,
      withTiming(1, { duration: DRAW_MS, easing: EASE_OUT }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instant]);

  // Tick: the crosshatch sweeps in like pen shading, with a soft press
  useEffect(() => {
    if (!ticked || instant) return;
    hatchOpacity.value = withTiming(1, { duration: TICK_FADE_MS });
    hatchWipe.value = withTiming(0, { duration: TICK_WIPE_MS, easing: EASE_OUT });
    scale.value = withSequence(
      withTiming(0.94, { duration: TICK_PRESS_MS }),
      withSpring(1, TICK_SPRING),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticked]);

  // The face forms: eyes drift together and OPEN (hatch clears);
  // the other boxes melt away.
  useEffect(() => {
    if (!formed || instant) return;
    if (eye) {
      tx.value = withTiming(eye.x, { duration: EYE_TRAVEL_MS, easing: EASE_OUT });
      ty.value = withTiming(eye.y, { duration: EYE_TRAVEL_MS, easing: EASE_OUT });
      rot.value = withTiming(eye.r, { duration: EYE_TRAVEL_MS, easing: EASE_OUT });
      hatchOpacity.value = withDelay(
        HATCH_CLEAR_DELAY_MS,
        withTiming(0, { duration: MELT_MS, easing: EASE_OUT }),
      );
    } else {
      opacity.value = withTiming(0, { duration: MELT_MS, easing: EASE_OUT });
      ty.value = withTiming(22, { duration: MELT_MS });
      scale.value = withTiming(0.9, { duration: MELT_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formed]);

  // Blink hello: cartoon snap shut, beat, ease back open
  useEffect(() => {
    if (!isEye || blinkCount === 0) return;
    blinkFill.value = withSequence(
      withTiming(1, {
        duration: Motion.blink.shut,
        easing: Easing.in(Easing.quad),
      }),
      withDelay(
        Motion.blink.hold,
        withTiming(0, {
          duration: Motion.blink.open,
          easing: Easing.out(Easing.cubic),
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinkCount]);

  const blockStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${rot.value}deg` },
      { scale: scale.value },
    ],
  }));
  const borderProps = useAnimatedProps(() => ({
    strokeDashoffset: BOX_PERIMETER * (1 - borderProgress.value),
  }));
  const hatchStyle = useAnimatedStyle(() => ({
    opacity: hatchOpacity.value,
    transform: [{ translateX: hatchWipe.value }],
  }));
  const blinkStyle = useAnimatedStyle(() => ({
    opacity: blinkFill.value,
  }));

  return (
    <Animated.View style={[styles.block, blockStyle]}>
      {/* Self-sketching outline */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox={`0 0 ${BLOCK} ${BLOCK}`}
      >
        <AnimatedRect
          x={BOX_INSET}
          y={BOX_INSET}
          width={BOX_SIDE}
          height={BOX_SIDE}
          stroke={Colors.ink}
          strokeWidth={3}
          fill="transparent"
          strokeDasharray={`${BOX_PERIMETER}`}
          animatedProps={borderProps}
        />
      </Svg>
      {/* Crosshatch (tick sweep / blink fill) */}
      <View style={styles.hatchClip}>
        <Animated.View style={[StyleSheet.absoluteFill, hatchStyle]}>
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <Defs>
              <Pattern
                id="splash-hatch-a"
                patternUnits="userSpaceOnUse"
                width={6}
                height={6}
              >
                <Line
                  x1="0"
                  y1="0"
                  x2="6"
                  y2="6"
                  stroke={Colors.completed}
                  strokeWidth="2.5"
                />
              </Pattern>
              <Pattern
                id="splash-hatch-b"
                patternUnits="userSpaceOnUse"
                width={6}
                height={6}
              >
                <Line
                  x1="6"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke={Colors.completed}
                  strokeWidth="2.5"
                />
              </Pattern>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#splash-hatch-a)" />
            <Rect width="100%" height="100%" fill="url(#splash-hatch-b)" />
          </Svg>
        </Animated.View>
      </View>
      {/* Blink: the box fills solid for a beat, like the sketch */}
      <Animated.View style={[styles.blinkFill, blinkStyle]} />
    </Animated.View>
  );
}

const FACE_W = 300;
const FACE_H = 220;

const styles = StyleSheet.create({
  overlay: {
    zIndex: 1000,
    elevation: 1000,
  },
  fill: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  faceArea: {
    width: FACE_W,
    height: FACE_H,
    alignItems: "center",
    justifyContent: "center",
  },
  block: {
    position: "absolute",
    left: FACE_W / 2 - BLOCK / 2,
    top: FACE_H / 2 - BLOCK / 2,
    width: BLOCK,
    height: BLOCK,
  },
  hatchClip: {
    position: "absolute",
    top: BOX_INSET + 2,
    left: BOX_INSET + 2,
    right: BOX_INSET + 2,
    bottom: BOX_INSET + 2,
    overflow: "hidden",
  },
  blinkFill: {
    position: "absolute",
    top: BOX_INSET + 2,
    left: BOX_INSET + 2,
    right: BOX_INSET + 2,
    bottom: BOX_INSET + 2,
    backgroundColor: Colors.ink,
  },
  smile: {
    position: "absolute",
    left: FACE_W / 2 - SMILE_W / 2,
    top: FACE_H / 2 + 30,
  },
  nameBlock: {
    alignItems: "center",
    minHeight: 64,
    marginTop: -34,
  },
  flourish: {
    marginTop: 4,
  },
});
