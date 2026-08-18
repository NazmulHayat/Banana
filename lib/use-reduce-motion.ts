import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * True when the system "Reduce Motion" switch is on.
 *
 * Decorative motion — looping shimmers, idle hovers, slide-in entrances —
 * must respect this. Feedback motion (the press scale, the habit tick) stays:
 * it's the only confirmation that a tap landed.
 *
 * Starts `false` so nothing flashes on first frame; the real value arrives a
 * tick later and the change listener keeps it honest if the user flips it
 * while the app is open.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (!cancelled) setReduce(!!on);
      })
      .catch(() => {
        if (!cancelled) setReduce(false);
      });

    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (on) => setReduce(!!on),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduce;
}
