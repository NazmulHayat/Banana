/**
 * Motion tokens — one rhythm for the whole app.
 * Durations in ms; springs are reanimated configs (damping/stiffness)
 * with core-Animated equivalents (friction/tension) noted where used.
 */
export const Motion = {
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
  /** Per-item delay for staggered list entrances. */
  stagger: 40,
  /** Max items that get a stagger delay (rest enter together). */
  staggerCap: 8,
};
