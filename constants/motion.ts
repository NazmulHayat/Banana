/**
 * Motion tokens — one rhythm for the whole app.
 * Durations in ms; springs are reanimated configs (damping/stiffness)
 * with core-Animated equivalents (friction/tension) noted where used.
 */
export const Motion = {
  /** Faster than `fast` — dismissals and opacity flips that shouldn't linger. */
  quick: 120,
  /** Micro-interactions: press states, small fades. */
  fast: 150,
  /** Standard enter/transition. */
  base: 250,
  /** Larger content transitions. */
  slow: 350,
  /** Standard spring — settles quickly, no overshoot drama. */
  spring: { damping: 15, stiffness: 180 },
  /** Celebratory spring — save success, ticks. */
  springBouncy: { damping: 12, stiffness: 220 },
  /**
   * Page-level travel — a whole screen of content moving sideways (the feed's
   * month pages). Deliberately flat: overshoot reads as lively on a button and
   * as wobbly on a page, and `overshootClamping` guarantees it can't bounce no
   * matter how fast the gesture was released.
   */
  springPage: { damping: 30, stiffness: 220, overshootClamping: true },
  /**
   * Press feedback. Deliberately much stiffer than `spring`: the scale has to
   * settle under the thumb, not after it. This is the old inline
   * `friction: 6, tension: 140` converted to the physical model, so the feel
   * is unchanged — core `Animated.spring` accepts damping/stiffness too.
   */
  springPress: { damping: 19, stiffness: 592 },
  /** Per-item delay for staggered list entrances. */
  stagger: 40,
  /**
   * Beat between elements of a hero entrance (the onboarding welcome). Much
   * longer than `stagger`: a list wants to arrive as one block, a hero wants
   * each piece read before the next lands.
   */
  heroBeat: 110,
  /** Max items that get a stagger delay (rest enter together). */
  staggerCap: 8,
  /** Skeleton pulse — one half-cycle (breathe in, breathe out). */
  pulse: 800,
  /** How long a snackbar stays up before it retreats on its own. */
  snackbar: 2400,
  /** Cartoon blink, shared by BrandMark and the splash face. */
  blink: { shut: 80, hold: 140, open: 210 },
  /** Idle hover on the brand face: a slow bob with a slower sway behind it. */
  float: { bob: 1600, sway: 2300, swayDelay: 400 },
};
