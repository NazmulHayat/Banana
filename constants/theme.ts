export const Colors = {
  paper: '#fbf8e9',
  dotGrid: '#A8C4C4',
  ink: '#1A1A1A',
  card: '#FFFFFF',
  shadow: '#E0DDD8',
  accent: '#FFB380',
  completed: '#1A1A1A',
  textSecondary: '#4A4A4A',
  border: '#A8C4C4',
  danger: '#C62828',
  success: '#2E7D32',
  /**
   * True black — only for the full-screen photo viewer, where the warm paper
   * palette would tint the image. Nothing else in the app is pure black.
   */
  blackout: '#000000',
};

/**
 * Low-alpha ink hairlines. The paper aesthetic rules with translucent ink
 * rather than solid greys — these literals were previously spelled two
 * different ways across 18 files, so name the alpha here instead of writing a
 * fresh `rgba()` in a component. All are `#1A1A1A` (Colors.ink) over paper.
 */
export const Hairline = {
  /** Faintest rule — pre-history heatmap cells, the pressed IconButton wash. */
  faint: 'rgba(26,26,26,0.06)',
  /** Progress-bar and meter tracks. */
  track: 'rgba(26,26,26,0.07)',
  /** Default divider under rows, cards and images. */
  base: 'rgba(26,26,26,0.08)',
  /** Section rule inside stat cards — one notch heavier than `base`. */
  strong: 'rgba(26,26,26,0.09)',
  /** Divider inside a floating surface (popover). */
  popover: 'rgba(26,26,26,0.1)',
  /** Skeleton block wash. */
  wash: 'rgba(26,26,26,0.12)',
  /** Border of a surface that floats above the page. */
  raised: 'rgba(26,26,26,0.15)',
  /** Ink outline on stamps and heatmap cells. */
  outline: 'rgba(26,26,26,0.16)',
  /**
   * Heaviest rule — a divider that has to hold its own between two blocks of
   * content (the columns of the profile stat strip). Everything lighter than
   * this disappears against paper at 1pt.
   */
  divider: 'rgba(26,26,26,0.28)',
};

/** Translucent washes laid over other content — backdrops, frosted bars, tints. */
export const Scrim = {
  /** Modal backdrop: ink over the page. */
  modal: 'rgba(26,26,26,0.45)',
  /** Frosted paper over the blur behind the tab bar. */
  paper: 'rgba(251,248,233,0.55)',
  /** Accent tint behind tips and callouts. */
  accent: 'rgba(255,179,128,0.18)',
  /** Skeleton card surface — card white, softened. */
  card: 'rgba(255,255,255,0.6)',
  /** Control chrome floating over a full-bleed photo. */
  photo: 'rgba(0,0,0,0.5)',
  /** Its hairline border, on the light side. */
  photoBorder: 'rgba(255,255,255,0.3)',
};

export const Fonts = {
  handwriting: 'ShantellSans',
  // Loaded as separate families in app/_layout.tsx — use these instead of
  // fontWeight, which iOS can't synthesize for custom fonts.
  handwritingMedium: 'ShantellSans_500',
  handwritingSemiBold: 'ShantellSans_600',
};