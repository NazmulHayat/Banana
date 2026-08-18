import { Colors } from "@/constants/theme";
import {
  WORDMARK_H,
  WORDMARK_LETTERS,
  WORDMARK_W,
} from "@/constants/wordmark-paths";
import { useEffect } from "react";
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// ─── Pen schedule ────────────────────────────────────────────────
// Trace time scales with each letter's real outline length; the next
// letter starts while the previous ink is still drying (60% overlap),
// and the pen takes a breath before the second word.
const TRACE_MS = WORDMARK_LETTERS.map((l) =>
  Math.min(520, Math.max(230, l.length * 0.4)),
);
/** Breath between "Aight" and "Bet" — the pen lifting off the page. */
const WORD_GAP_MS = 220;
const DELAYS_MS: number[] = [];
{
  let t = 0;
  WORDMARK_LETTERS.forEach((l, i) => {
    if (l.char === "B") t += WORD_GAP_MS; // word gap
    DELAYS_MS.push(t);
    t += TRACE_MS[i] * 0.6;
  });
}
const FILL_MS = 320;
const LAST = WORDMARK_LETTERS.length - 1;

/** When the whole wordmark is fully written + inked, from mount. */
export const WORDMARK_TOTAL_MS =
  DELAYS_MS[LAST] + TRACE_MS[LAST] + FILL_MS;

function TracedLetter({
  index,
  instant,
}: {
  index: number;
  instant: boolean;
}) {
  const letter = WORDMARK_LETTERS[index];
  const trace = useSharedValue(instant ? 1 : 0);
  const ink = useSharedValue(instant ? 1 : 0);

  useEffect(() => {
    if (instant) return;
    const delay = DELAYS_MS[index];
    // Pen traces the outline…
    trace.value = withDelay(
      delay,
      withTiming(1, {
        duration: TRACE_MS[index],
        easing: Easing.inOut(Easing.quad),
      }),
    );
    // …and the ink floods in just before the outline completes
    ink.value = withDelay(
      delay + TRACE_MS[index] * 0.55,
      withTiming(1, { duration: FILL_MS, easing: Easing.out(Easing.quad) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instant]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: letter.length * (1 - trace.value),
    fillOpacity: ink.value,
  }));

  return (
    <AnimatedPath
      d={letter.d}
      stroke={Colors.ink}
      strokeWidth={1.1}
      fill={Colors.ink}
      strokeDasharray={`${letter.length}`}
      animatedProps={animatedProps}
    />
  );
}

/**
 * "Aight Bet" written by an invisible pen: each letter's true Shantell
 * Sans outline traces itself, then floods with ink — overlapping like
 * real handwriting, with a breath between the words.
 */
export function HandwrittenWordmark({
  width = 230,
  instant = false,
}: {
  width?: number;
  instant?: boolean;
}) {
  return (
    <Svg
      width={width}
      height={(width * WORDMARK_H) / WORDMARK_W}
      viewBox={`0 0 ${WORDMARK_W} ${WORDMARK_H}`}
    >
      {WORDMARK_LETTERS.map((_, i) => (
        <TracedLetter key={i} index={i} instant={instant} />
      ))}
    </Svg>
  );
}
