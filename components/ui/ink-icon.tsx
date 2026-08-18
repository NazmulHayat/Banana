// Hand-drawn ink icons.
//
// These replace emoji. Emoji were rendering as tofu boxes (simulator runtimes
// ship without Apple Color Emoji) and, more importantly, glossy multicolour
// glyphs fight the paper-and-ink aesthetic — the app is warm paper, near-black
// ink and exactly one orange accent.
//
// Drawn with `react-native-svg` (already a dependency) in the same stroke
// language as `stamp-grid` and `habit-heatmap`: 1.5-ish strokes, round caps,
// slightly irregular so they read as pen rather than icon-font.

import Svg, { Path } from "react-native-svg";

import { Colors } from "@/constants/theme";

export type InkIconName = "flame" | "seal" | "chart";

interface InkIconProps {
  /** Which glyph to draw. */
  name: InkIconName;
  /** Rendered square size in points. Default 20. */
  size?: number;
  /** Stroke colour. Defaults to ink. */
  color?: string;
  /** Fill colour for the accent detail, when the glyph has one. */
  accent?: string;
}

/**
 * A single hand-drawn glyph. Decorative by default — these sit next to text
 * that already says the same thing, so they are hidden from screen readers
 * rather than announced twice.
 */
export function InkIcon({
  name,
  size = 20,
  color = Colors.ink,
  accent = Colors.accent,
}: InkIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {name === "chart" ? (
        <>
          {/* Bar chart — the doorway into the analysis. One pen stroke for the
              axis, three bars sitting on it, the tallest one inked in. */}
          <Path
            d="M4.4 3.4 L4 19.4 L20.6 19"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Path
            d="M6.9 19.2 L7.1 14.5 L10.3 14.2 L10.2 19.1"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Tallest bar, filled with the one accent colour. */}
          <Path
            d="M12.2 19.1 L12.4 9.9 L15.6 9.6 L15.5 19"
            fill={accent}
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Path
            d="M17.5 19 L17.7 12.4 L20.7 12.1 L20.6 18.9"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      ) : name === "flame" ? (
        <>
          {/* Outer flame — deliberately asymmetric so it looks drawn. */}
          <Path
            d="M13.2 2.6c.5 2.6-.8 4-2.2 5.5-1.6 1.7-3.4 3.4-3.4 6.3a6.4 6.4 0 0 0 12.8.3c0-2.5-1.1-4.3-2.4-5.8-.3 1-.9 1.7-1.7 2 .3-3.4-1.1-6.2-3.1-8.3Z"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Inner core, in the one accent colour. */}
          <Path
            d="M13.6 13c.9.9 1.4 1.8 1.4 2.8a3 3 0 0 1-6 .1c0-1.3.8-2.2 1.7-3 .1.8.5 1.3 1.1 1.5.1-.6.5-1.1 1.8-1.4Z"
            fill={accent}
          />
        </>
      ) : (
        <>
          {/* Seal / rosette — the "you're at your best" mark. */}
          <Path
            d="M12 2.8c.9 0 1.6 1 2.5 1.2.9.2 2-.3 2.7.3.7.6.5 1.8.9 2.6.4.8 1.5 1.3 1.6 2.2.1.9-.8 1.7-1 2.6-.2.9.3 2-.3 2.7-.6.7-1.8.5-2.6.9-.8.4-1.3 1.5-2.2 1.6-.9.1-1.7-.8-2.6-.8s-1.7.9-2.6.8c-.9-.1-1.4-1.2-2.2-1.6-.8-.4-2-.2-2.6-.9-.6-.7-.1-1.8-.3-2.7-.2-.9-1.1-1.7-1-2.6.1-.9 1.2-1.4 1.6-2.2.4-.8.2-2 .9-2.6.7-.6 1.8-.1 2.7-.3C10.4 3.8 11.1 2.8 12 2.8Z"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {/* Ribbon tails. */}
          <Path
            d="M9.3 17.4 8 22l4-1.9L16 22l-1.3-4.6"
            stroke={color}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* Tick inside, in the accent. */}
          <Path
            d="m9.6 10.4 1.8 1.8 3.2-3.4"
            stroke={accent}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </Svg>
  );
}
