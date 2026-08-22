import { HabitComparison } from "@/components/habit-comparison";
import { HabitHeatmap } from "@/components/habit-heatmap";
import { HabitWeeks } from "@/components/habit-weeks";
import { JournalStatsCard } from "@/components/journal-stats-card";
import { ProgressChart } from "@/components/progress-chart";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionTitle } from "@/components/ui/settings-row";
import { Skeleton } from "@/components/ui/skeleton";
import { InkIcon } from "@/components/ui/ink-icon";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { todayKey } from "@/lib/dates";
import { type DailyEntry, type Habit, type HabitLog } from "@/lib/db";
import { earlyLine, earlyProgressLine } from "@/lib/encouragement";
import { computeJournalStats } from "@/lib/journal-stats";
import {
  completionForMonth,
  computeAllHabitStats,
  computeHabitStats,
  computeOverallStats,
  habitComparison,
  habitWeeklyTimeline,
  dayIndexOf,
  heatmapCells,
  MIN_PROGRESS_MONTHS,
  progressSeries,
  type ProgressMode,
  monthOverMonthTrend,
  type RatePoint,
  type StatsScope,
} from "@/lib/stats";
import * as Haptics from "expo-haptics";
import { type Href, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface AnalysisContentProps {
  habits: Habit[];
  logs: HabitLog[];
  /** Journal entries for FR-AN1. Omit on the per-habit deep-dive. */
  entries?: DailyEntry[];
  /** Entries are loaded separately, so they get their own flag. */
  entriesLoading?: boolean;
  /** Present = per-habit deep-dive; absent = overall dashboard. */
  habitId?: string;
  loading: boolean;
  /** Months that couldn't be refreshed — drives the offline/error notice. */
  failedMonths?: number;
  /** Retry the months that failed. */
  onRetry?: () => void;
}

// Each range drives BOTH the heatmap window and the trend series, always as
// monthly points.
//
// There is deliberately no "Month" option: a 30-square heatmap shows a shape
// too short to read as a pattern, and its trend series collapsed to a single
// monthly point. Consistency is a question about months, not days — the month
// you're in is already answered by the hero and the Progress delta.
/** Ceiling on the per-habit day calendar. Half a year of squares fits a phone. */
const HABIT_CALENDAR_DAYS = 183;
/**
 * Floor, in whole weeks. A habit three days old would otherwise draw a single
 * column, which reads as broken rather than new.
 */
const MIN_CALENDAR_DAYS = 28;

/**
 * The range the user last picked, remembered for the life of the app session
 * so drilling into a habit and coming back doesn't silently snap to 6 months.
 * A module-level value on purpose: a preference this small doesn't earn a new
 * AsyncStorage key, and components don't own persistence in this codebase.
 */

const pct = (r: number): number => Math.round(r * 100);

// "a", "a and b", "a, b and c" — for the one honest line about what's still
// filling in. Oxford-free, matches the app's spoken tone.
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}


// Drop the leading points from before anything was trackable, so the line
// starts where the user's history does instead of at a fake 0%.
function trimToHistory(points: RatePoint[]): RatePoint[] {
  const first = points.findIndex((p) => p.days > 0);
  return first <= 0 ? points : points.slice(first);
}

/**
 * The analysis surface, shared by the overview and per-habit screens.
 *
 * INFORMATION HIERARCHY (three titled groups, one hero, no nav bar):
 *
 *   hero            current streak · this month %   ← the only place both appear
 *   How it's going  consistency (heatmap) · progress (column chart)
 *   Patterns        by habit (each row opens that habit's deep-dive)
 *   Your journal    FR-AN1 stats
 *
 * Each number lives in exactly ONE place: the current streak is in the hero,
 * and this month's rate is in the hero (Progress leads with the
 * month-over-month delta instead). Personal records were cut on 2026-08-20:
 * "now vs best" restated numbers the hero and Progress already carry.
 *
 * PROGRESSIVE DISCLOSURE: a module that could only say "nothing here yet" is
 * not rendered at all. A new user gets the hero, their story, the heatmap and
 * the habit list — then ONE honest line naming what unlocks as they go, rather
 * than seven identical empty panels.
 *
 * All math comes from the pure `lib/stats` / `lib/gamification` engines; this
 * file only arranges it and picks the right state to render.
 */
export function AnalysisContent({
  habits,
  logs,
  entries = [],
  entriesLoading = false,
  habitId,
  loading,
  failedMonths = 0,
  onRetry,
}: AnalysisContentProps) {
  const [visibleYear, setVisibleYear] = useState<number | null>(null);
  const [progressMode, setProgressMode] = useState<ProgressMode>("month");


  const drillInto = (id: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/analysis/${id}` as Href);
  };

  // 1 — loading.
  if (loading) {
    return (
      <View style={styles.wrap}>
        <Skeleton width="55%" height={26} />
        <View style={{ height: 18 }} />
        <Skeleton width="100%" height={120} borderRadius={10} />
        <View style={{ height: 16 }} />
        <Skeleton width="90%" height={16} />
      </View>
    );
  }

  // 2 — per-habit view but the habit is gone (deleted). A dead end with only a
  // back button is a trap; offer both ways forward.
  const habit = habitId ? habits.find((h) => h.id === habitId) : undefined;
  if (habitId && !habit) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.goneTitle}>This habit was deleted</Text>
        <Text style={styles.gone}>
          Its history went with it. Everything else is still in your overall
          analysis.
        </Text>
        <PressableScale
          style={styles.goneCta}
          onPress={() => router.replace("/analysis")}
          accessibilityLabel="See overall analysis"
        >
          <Text style={styles.goneCtaText}>See overall analysis</Text>
        </PressableScale>
        <PressableScale
          style={[styles.goneCta, styles.goneCtaQuiet]}
          onPress={() => router.push("/habits")}
          accessibilityLabel="Manage habits"
        >
          <Text style={styles.goneCtaQuietText}>Manage habits</Text>
        </PressableScale>
      </View>
    );
  }

  // 3 — nothing to analyse yet.
  if (!habitId && habits.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.gone}>
          Add a habit and this page starts filling in from the first day you
          tick it.
        </Text>
        <PressableScale
          style={styles.goneCta}
          onPress={() => router.push("/habits")}
          accessibilityLabel="Add a habit"
        >
          <Text style={styles.goneCtaText}>Add a habit</Text>
        </PressableScale>
      </View>
    );
  }

  const today = todayKey();
  const [ty, tm] = today.split("-").map(Number);
  const scope: StatsScope = { habitId, habits };

  // Headline streak + record: per-habit stats, or the best across all habits.
  const hs = habitId ? computeHabitStats(habitId, logs, today) : null;
  const overall = habitId
    ? null
    : computeOverallStats(computeAllHabitStats(habits, logs, today), logs, today, habits);
  const currentStreak = hs ? hs.currentStreak : (overall?.bestCurrentStreak ?? 0);
  const totalCompletions = hs
    ? hs.totalCompletions
    : (overall?.totalCompletions ?? 0);

  const month = completionForMonth(logs, ty, tm, today, scope);
  const trend = monthOverMonthTrend(logs, today, scope);
  const progress = progressSeries(logs, today, scope, progressMode);
  // Still trimmed, so the chart never opens on a run of fake zeroes.
  const series = trimToHistory(progress.points);
  const tooEarly = progress.historyMonths < MIN_PROGRESS_MONTHS;
  // The calendar spans this habit's own life, not a flat six months. A habit
  // 20 days old was drawing 183 squares, so ~90% of the grid was "before you
  // started" — a wall of empty boxes that reads as failure rather than as time
  // that was never yours. Rounded up to whole weeks so no column is a stub.
  const habitStartIdx =
    habitId && habit?.createdAt
      ? dayIndexOf(habit.createdAt.slice(0, 10))
      : NaN;
  const habitAgeDays = Number.isNaN(habitStartIdx)
    ? HABIT_CALENDAR_DAYS
    : Math.max(1, dayIndexOf(today) - habitStartIdx + 1);
  const calendarDays = Math.min(
    HABIT_CALENDAR_DAYS,
    Math.ceil(Math.max(MIN_CALENDAR_DAYS, habitAgeDays) / 7) * 7,
  );

  // Days since tracking began — this habit's own life on its page, the oldest
  // habit's on the overview. Drives every "too early to draw" state.
  const oldestStart = habits.reduce((min, h) => {
    const idx = dayIndexOf(h.createdAt.slice(0, 10));
    return Number.isNaN(idx) ? min : Math.min(min, idx);
  }, Number.POSITIVE_INFINITY);
  const daysTracked = habitId
    ? habitAgeDays
    : Number.isFinite(oldestStart)
      ? Math.max(0, dayIndexOf(today) - oldestStart + 1)
      : 0;
  const early = earlyLine(daysTracked);

  const cells = heatmapCells(logs, today, calendarDays, {
    habitId,
    habits,
    totalHabits: habits.length || 1,
  });
  // Overview only — the window runs from the week you started, so it takes no
  // range and ignores the control the Progress chart still uses.
  const weeklyTimeline = habitId
    ? { weeks: [], rows: [], bucket: "week" as const }
    : habitWeeklyTimeline(habits, logs, today);

  const journal = habitId ? null : computeJournalStats(entries, today);
  const comparison = habitId ? [] : habitComparison(habits, logs, today);

  const trendUp = trend.delta >= 0;
  const activeDays = overall?.activeDays ?? hs?.totalCompletions ?? 0;

  // --- Progressive disclosure -------------------------------------------
  // Render a module only when it has something to say; collect what's still
  // locked into one honest line instead of a column of empty panels.
  const showProgress = series.length > 1;
  const showJournal = !habitId && (entriesLoading || (journal?.totalEntries ?? 0) > 0);

  const locked: string[] = [];
  if (!showProgress) locked.push("your trend line, after a few more days");
  if (!showJournal && !habitId) locked.push("your journal, from the first highlight you write");

  return (
    <View style={styles.wrap}>
      {/* Offline / partial-load notice — honest, calm, retryable. */}
      {failedMonths > 0 && (
        <TouchableOpacity
          onPress={onRetry}
          activeOpacity={0.85}
          disabled={!onRetry}
          style={styles.notice}
          accessibilityRole="button"
          accessibilityLabel="Some months couldn't be refreshed. Tap to try again."
          accessibilityState={{ disabled: !onRetry }}
        >
          <Text style={styles.noticeText}>
            {totalCompletions > 0
              ? "Some months couldn't be refreshed — showing what's saved on this device."
              : "Couldn't reach your history just now."}
            {onRetry ? " Tap to try again." : ""}
          </Text>
        </TouchableOpacity>
      )}

      {/* ---- Hero band ---- */}
      {/* Each stat is one VoiceOver stop — a label and a bare number read as
          two unrelated fragments otherwise. */}
      <View style={styles.heroRow}>
        {/* "Current streak" everywhere — never "best streak". On
            the overview it's the best LIVE streak across habits, which is
            still the user's current streak in every sense that matters. */}
        <View
          accessible
          accessibilityLabel={`Current streak, ${currentStreak} day${
            currentStreak === 1 ? "" : "s"
          }`}
        >
          <Text style={styles.heroLabel}>current streak</Text>
          <View style={styles.heroValueRow}>
            <InkIcon name="flame" size={22} />
            <Text style={styles.heroValue}>{currentStreak}</Text>
          </View>
        </View>
        <View
          style={styles.heroRight}
          accessible
          accessibilityLabel={
            month.days > 0
              ? `This month, ${pct(month.rate)} percent`
              : "This month, nothing to score yet"
          }
        >
          <Text style={styles.heroLabel}>this month</Text>
          <Text style={styles.heroValue}>{month.days > 0 ? `${pct(month.rate)}%` : "—"}</Text>
        </View>
      </View>

      {/* 4 — habits, but nothing logged yet. 5 — exactly one day in. */}
      {totalCompletions === 0 ? (
        <Text style={styles.firstRun}>
          Nothing logged yet. Tick a habit today and this page starts filling in.
        </Text>
      ) : activeDays === 1 ? (
        <Text style={styles.firstRun}>
          One day in. The shapes below get more honest with every day you add.
        </Text>
      ) : null}


      {/* ================= HOW IT'S GOING ================= */}
      <View style={styles.group}>
        <SectionTitle>How it&apos;s going</SectionTitle>

        {/* Consistency.
            The overview shows habits × weeks: rows say which habit, columns
            say when. The old aggregated day heatmap could show that a stretch
            went badly but never which habit did, and months of single days
            never fit a phone at a readable size. The range control went with
            it — the window runs from the week you started to this one, so
            there is nothing left to pick.

            The per-habit page keeps the day calendar: with one habit there is
            no "which", and the day-by-day rhythm is the whole point there. */}
        <View style={[styles.section, styles.sectionFirst]}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              Consistency
            </Text>
            {/* Which year you're looking at, updated as the grid scrolls. Month
                landmarks alone stop being enough the moment the history spans a
                new year — "Jan" could be any of them. */}
            {!habitId && visibleYear !== null ? (
              <Text style={styles.yearBadge}>{visibleYear}</Text>
            ) : null}
          </View>
          {habitId ? (
            <>
              {/* Tapping shows the date on the square itself — the heatmap
                  owns that. It used to open the day sheet, which on a
                  single-habit page had nothing to show: one habit, one tick. */}
              <HabitHeatmap cells={cells} habitName={habit?.name} />
              {/* While the grid is still thin, say what's coming instead of
                  labelling a ramp that has no range yet. */}
              <Text style={styles.caption}>
                {early ?? "Each square is a day · tap one for the date"}
              </Text>
            </>
          ) : (
            <>
              <HabitWeeks
                data={weeklyTimeline}
                emptyLabel="Add a habit and this fills in as you go."
                onVisibleYearChange={setVisibleYear}
              />
              {early ? <Text style={styles.caption}>{early}</Text> : null}
            </>
          )}
        </View>

        {/* Progress — leads with the delta; the rate itself is in the hero. */}
        {showProgress && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel} accessibilityRole="header">
                Progress
              </Text>
              <View style={styles.segment} accessibilityRole="tablist">
                {(["month", "year"] as const).map((m) => {
                  const on = m === progress.mode;
                  // Yearly needs two calendar years to compare; until then it
                  // stays visible but inert, so the option is discoverable
                  // without pretending it would show anything.
                  const disabled = m === "year" && !progress.yearlyAvailable;
                  return (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setProgressMode(m)}
                      disabled={disabled}
                      activeOpacity={0.85}
                      style={[
                        styles.segItem,
                        on && styles.segItemOn,
                        disabled && styles.segItemOff,
                      ]}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      accessibilityRole="tab"
                      accessibilityLabel={
                        m === "month" ? "Monthly" : "Yearly"
                      }
                      accessibilityHint={
                        disabled ? "Needs a second year of history" : undefined
                      }
                      accessibilityState={{ selected: on, disabled }}
                    >
                      <Text
                        style={[
                          styles.segText,
                          on && styles.segTextOn,
                          disabled && styles.segTextOff,
                        ]}
                      >
                        {m === "month" ? "Monthly" : "Yearly"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <Text
              style={[styles.bigDelta, { color: trendUp ? Colors.success : Colors.danger }]}
              accessibilityLabel={`${trendUp ? "Up" : "Down"} ${Math.abs(
                Math.round(trend.delta),
              )} percent versus last month`}
            >
              {trendUp ? "↑" : "↓"} {Math.abs(Math.round(trend.delta))}% vs last month
            </Text>
            <Text style={styles.caption2}>
              {month.days > 0
                ? `${month.done} of ${month.days} day${month.days === 1 ? "" : "s"} counted so far this month`
                : "This month starts counting from the day you added it"}
            </Text>
            {tooEarly ? (
              // One month is a reading, not a comparison. Say something worth
              // reading instead of "not enough data", which blames the user for
              // being new.
              <Text style={styles.earlyNote}>
                {earlyProgressLine(daysTracked)}
              </Text>
            ) : (
              <>
                <View style={{ marginTop: 14 }}>
                  <ProgressChart
                    points={series.map((p) => ({ label: p.label, rate: p.rate }))}
                  />
                </View>
                <Text style={styles.caption}>
                  {progress.mode === "year"
                    ? `${series.length} years compared`
                    : `Last ${series.length} months`}
                </Text>
              </>
            )}
          </View>
        )}
      </View>

      {/* FR-G3 — stamps. The records board that used to head this group is
          gone (cut 2026-08-20: "now vs best" repeated numbers the hero and
          Progress already carry). Stamps stay as a standalone doorway rather
          than a section, so the wall of what you've already done is still one
          tap away. */}
      {!habitId && (
        // Parked, not hidden: a plain View rather than a disabled button, so
        // there is no tap to swallow and nothing that looks pressable. The
        // chevron goes too — an arrow that leads nowhere is a broken promise.
        <View
          style={[styles.stampsCard, styles.stampsCardSoon]}
          accessible
          accessibilityLabel="Stamps, coming soon. Everything you've already done, kept permanently."
        >
          <View style={styles.stampsRow}>
            <View style={styles.stampsText}>
              <Text style={styles.stampsTitle}>Stamps</Text>
              <Text style={styles.stampsBlurb}>
                Everything you&apos;ve already done, kept permanently.
              </Text>
            </View>
            <Text style={styles.soonTag}>Coming soon</Text>
          </View>
        </View>
      )}

      {/* ================= PATTERNS (overview only) ================= */}
      {!habitId && (
        <View style={styles.group}>
          <SectionTitle>Patterns</SectionTitle>

          {/* FR-AN2 — habit comparison */}
          <View style={[styles.section, styles.sectionFirst]}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              By habit
            </Text>
            <HabitComparison rows={comparison} onSelect={drillInto} />
          </View>
        </View>
      )}

      {/* ================= YOUR JOURNAL (overview only) ================= */}
      {showJournal && (
        <View style={styles.group}>
          <SectionTitle>Your journal</SectionTitle>
          {/* Last section on the screen — `section` pads 18 below itself, which
              on the final card is just dead paper before the scroll ends. */}
          <View
            style={[styles.section, styles.sectionFirst, styles.sectionLast]}
          >
            <JournalStatsCard stats={journal} loading={entriesLoading} />
          </View>
        </View>
      )}

      {/* One honest line about what's still filling in — instead of a stack of
          modules all saying "nothing here yet". */}
      {locked.length > 0 && (
        <Text style={styles.locked}>Still filling in: {listOf(locked)}.</Text>
      )}


    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22 },
  // deleted-habit / no-habits states
  goneTitle: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
    marginTop: 40,
    marginBottom: 8,
  },
  gone: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 24,
  },
  goneCta: {
    height: 50,
    borderRadius: 14,
    backgroundColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  goneCtaText: { fontSize: 16, color: Colors.paper, fontFamily: Fonts.handwritingSemiBold },
  goneCtaQuiet: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    marginTop: 12,
  },
  goneCtaQuietText: { fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  // offline / partial-load notice
  notice: {
    borderWidth: 1,
    borderColor: Hairline.strong,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
  },
  noticeText: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
  },
  // hero band
  heroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingBottom: 6,
  },
  heroRight: { alignItems: "flex-end" },
  heroLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  heroValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroValue: {
    fontSize: 30,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginTop: 2,
  },
  firstRun: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginBottom: 4,
  },
  // per-habit scope note
  // groups + sections: the group title carries the weight, so the first
  // section under it skips the rule and only siblings get one.
  group: { marginTop: 14 },
  section: { paddingVertical: 18, borderTopWidth: 1, borderTopColor: Hairline.strong },
  sectionFirst: { borderTopWidth: 0, paddingTop: 2 },
  sectionLast: { paddingBottom: 0 },
  subSection: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Hairline.base,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  segment: { flexDirection: "row", gap: 6 },
  segItem: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Hairline.raised,
  },
  segItemOn: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  segItemOff: { borderColor: Hairline.faint },
  segText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
  },
  segTextOn: { color: Colors.paper },
  segTextOff: { opacity: 0.45 },
  earlyNote: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    paddingVertical: 10,
  },
  stampsCardSoon: { opacity: 0.55 },
  soonTag: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.2,
    marginLeft: 12,
  },
  yearBadge: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: 0.5,
  },
  sectionLabel: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  subLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  caption: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
    textAlign: "center",
  },
  caption2: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  // segmented range
  // Two ranges now, so the pills can be generous instead of cramped.
  // stamps — a standalone doorway, same card language as the Manage rows
  stampsCard: {
    marginTop: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.card,
    // The app's card outline (PaperCard): a drawn ink box, not a hairline.
    borderWidth: 1.5,
    borderColor: Colors.ink,
  },
  stampsTitle: { fontSize: 17, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  stampsBlurb: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginTop: 3,
  },
  // progress
  // 19, not 24: at 24 the delta was competing with the hero numbers at the top
  // of the screen, and it's a supporting figure, not the headline.
  bigDelta: { fontSize: 19, fontFamily: Fonts.handwritingSemiBold },
  bold: { fontFamily: Fonts.handwritingSemiBold },
  insight: { fontSize: 16, color: Colors.ink, fontFamily: Fonts.handwriting, lineHeight: 24 },
  // what's still filling in
  locked: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginTop: 28,
  },
  // stamps row
  stampsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stampsText: { flex: 1, marginRight: 12 },
});
