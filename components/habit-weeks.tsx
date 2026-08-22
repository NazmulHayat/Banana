import { Colors, Fonts, Hairline } from "@/constants/theme";
import { fromDayKey } from "@/lib/dates";
import type { WeeklyTimeline } from "@/lib/stats";
import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// Contribution-graph proportions: small tight squares that read as one
// surface, not a row of buttons. Bigger than GitHub's 11px because this is a
// phone and the squares are tappable.
const CELL = 26;
const GAP = 5;
const COL = CELL + GAP;
/** Pinned label column — fits "Meditate" without truncating. */
const LABEL_W = 76;
const ROW_H = CELL + GAP;
const MONTH_H = 18;

/** Four filled steps of one colour. Darker means more days. Nothing to decode. */
const LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;

interface HabitWeeksProps {
  data: WeeklyTimeline;
  emptyLabel?: string;
  /**
   * The year currently scrolled into view. Lifted out so the section header
   * can show it: once the grid spans more than one year, month landmarks alone
   * stop being enough to say *when* you're looking at.
   */
  onVisibleYearChange?: (year: number) => void;
}

/** The accent at a given strength, as an 8-digit hex the RN style accepts. */
function shade(level: number): string {
  const alpha = Math.round(level * 255)
    .toString(16)
    .padStart(2, "0");
  return `${Colors.accent}${alpha}`;
}

/** 0 done → 0; 7 done → 4. Anything above zero is visibly above zero. */
function levelFor(done: number, eligible: number): number {
  if (eligible === 0 || done === 0) return 0;
  const ratio = done / eligible;
  if (ratio >= 0.99) return 4;
  if (ratio >= 0.7) return 3;
  if (ratio >= 0.4) return 2;
  return 1;
}

function columnLabel(startKey: string, bucket: "week" | "month"): string {
  const start = fromDayKey(startKey);
  if (bucket === "month") {
    return start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** "AUG" above the first week of each month, so the row has landmarks. */
function landmarkFor(
  columns: string[],
  index: number,
  bucket: "week" | "month",
): string | null {
  const at = fromDayKey(columns[index]);
  if (bucket === "month") {
    // Columns are months, so the landmark row marks years instead — repeating
    // the month name above every column would say nothing twice.
    if (index === 0) return String(at.getFullYear());
    const previous = fromDayKey(columns[index - 1]);
    return at.getFullYear() === previous.getFullYear()
      ? null
      : String(at.getFullYear());
  }
  if (index === 0) return at.toLocaleDateString("en-US", { month: "short" });
  const previous = fromDayKey(columns[index - 1]);
  if (at.getMonth() === previous.getMonth()) return null;
  return at.toLocaleDateString("en-US", { month: "short" });
}

/**
 * Habits down the side, weeks across, from the week you started to this one.
 *
 * Rows answer "which habit", columns answer "when". Tapping a week says what
 * actually happened in it, because a shaded square on its own is a feeling,
 * not a number.
 */
export function HabitWeeks({
  data,
  emptyLabel = "Nothing to show yet.",
  onVisibleYearChange,
}: HabitWeeksProps) {
  const scrollRef = useRef<ScrollView>(null);
  const reportedYear = useRef<number | null>(null);

  // Report the year under the left edge of the viewport, and only when it
  // actually changes — this fires on every scroll frame otherwise.
  const reportYear = (offsetX: number) => {
    if (!onVisibleYearChange || data.weeks.length === 0) return;
    const index = Math.min(
      Math.max(Math.round(offsetX / COL), 0),
      data.weeks.length - 1,
    );
    const year = fromDayKey(data.weeks[index]).getFullYear();
    if (reportedYear.current === year) return;
    reportedYear.current = year;
    onVisibleYearChange(year);
  };
  const [selected, setSelected] = useState<{
    row: number;
    week: number;
  } | null>(null);

  // Open on the most recent week — that's what anyone looks at first.
  useEffect(() => {
    if (data.weeks.length === 0) return;
    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
      // The grid opens on the most recent column, so that's the year to show
      // before any scrolling has happened.
      const last = data.weeks[data.weeks.length - 1];
      const year = fromDayKey(last).getFullYear();
      reportedYear.current = year;
      onVisibleYearChange?.(year);
    }, 0);
    return () => clearTimeout(id);
    // `onVisibleYearChange` is intentionally not a dependency: it's a reporting
    // channel, and re-running this would yank the scroll back to the end.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.weeks.length]);

  // A habit removed while a week was selected must not leave a dangling index.
  useEffect(() => {
    setSelected(null);
  }, [data.rows.length, data.weeks.length]);

  if (data.weeks.length === 0 || data.rows.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  const lastWeek = data.weeks.length - 1;
  const picked =
    selected && data.rows[selected.row]
      ? {
          name: data.rows[selected.row].name,
          cell: data.rows[selected.row].cells[selected.week],
          range: columnLabel(data.weeks[selected.week], data.bucket),
        }
      : null;

  return (
    <View>
      <View style={styles.grid}>
        {/* Pinned names — outside the ScrollView so they never slide away. */}
        <View style={styles.labels}>
          <View style={{ height: MONTH_H }} />
          {data.rows.map((row) => (
            <View key={row.habitId} style={styles.labelRow}>
              <Text style={styles.labelText} numberOfLines={1}>
                {row.name}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={(e) => reportYear(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={120}
          contentContainerStyle={styles.weeks}
        >
          <View>
            <View style={styles.monthRow}>
              {data.weeks.map((week, i) => {
                const label = landmarkFor(data.weeks, i, data.bucket);
                return (
                  <View key={`m-${week}`} style={styles.monthCell}>
                    {label ? (
                      <Text style={styles.monthText}>{label}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {data.rows.map((row, rowIndex) => (
              <View key={row.habitId} style={styles.cellRow}>
                {row.cells.map((cell, weekIndex) => {
                  const level = levelFor(cell.done, cell.eligible);
                  const isSelected =
                    selected?.row === rowIndex && selected?.week === weekIndex;
                  const isCurrent = weekIndex === lastWeek;
                  return (
                    <TouchableOpacity
                      key={`${row.habitId}-${data.weeks[weekIndex]}`}
                      activeOpacity={0.7}
                      onPress={() =>
                        setSelected(
                          isSelected
                            ? null
                            : { row: rowIndex, week: weekIndex },
                        )
                      }
                      style={styles.cellSlot}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.name}, ${columnLabel(
                        data.weeks[weekIndex],
                        data.bucket,
                      )}, ${
                        cell.eligible === 0
                          ? "before you started it"
                          : `${cell.done} of ${cell.eligible} days`
                      }`}
                    >
                      <View
                        style={[
                          styles.cell,
                          // Before the habit existed: not a miss, so it must
                          // not look like one.
                          cell.eligible === 0 && styles.cellBefore,
                          cell.eligible > 0 &&
                            level > 0 && {
                              backgroundColor: shade(LEVELS[level]),
                            },
                          isCurrent && styles.cellCurrent,
                          isSelected && styles.cellSelected,
                        ]}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

      </View>

      {/* A shaded square on its own is a feeling; this is the number. */}
      <View style={styles.summary}>
        {picked ? (
          <Text style={styles.summaryText}>
            <Text style={styles.summaryStrong}>{picked.name}</Text> ·{" "}
            {picked.range} ·{" "}
            {picked.cell.eligible === 0
              ? "before you started it"
              : `${picked.cell.done} of ${picked.cell.eligible} days`}
          </Text>
        ) : (
          <Text style={styles.summaryHint}>
            {data.bucket === "month" ? "Each square is a month" : "Each square is a week"} · tap one for the detail
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row" },
  labels: { width: LABEL_W },
  labelRow: { height: ROW_H, justifyContent: "center" },
  labelText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    paddingRight: 8,
  },
  weeks: { paddingRight: 2 },
  monthRow: { flexDirection: "row", height: MONTH_H, alignItems: "flex-end" },
  monthCell: { width: COL },
  monthText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.6,
  },
  cellRow: { flexDirection: "row", height: ROW_H, alignItems: "center" },
  cellSlot: { width: COL, alignItems: "flex-start" },
  cell: {
    width: CELL,
    height: CELL,
    borderRadius: 6,
    // No border. Borders on every square turn the grid into a lattice; the
    // empty state is a wash, exactly like a contribution graph's lightest step.
    backgroundColor: Hairline.track,
  },
  /** Before the habit existed: nothing at all, so it can't read as a miss. */
  cellBefore: { backgroundColor: "transparent" },
  /** This week only — a hairline ring, so "now" is findable after scrolling. */
  cellCurrent: { borderWidth: 1, borderColor: Hairline.raised },
  cellSelected: { borderWidth: 1.5, borderColor: Colors.ink },
  summary: {
    // Fixed height: the line swapping between hint and detail must not make
    // everything below it jump.
    minHeight: 34,
    justifyContent: "center",
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Hairline.base,
    paddingTop: 10,
  },
  summaryText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  summaryStrong: { fontFamily: Fonts.handwritingSemiBold },
  summaryHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  empty: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    paddingVertical: 12,
  },
});
