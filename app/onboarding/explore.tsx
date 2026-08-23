// The tour — four pages of a filled-in example, for people who want to see
// the product before they touch it.
//
// Everything on these pages is staged sample data and says so: each visual
// carries an "example" tag, and the one interactive piece (the mini habit
// grid) is a sandbox that saves nothing. The pages are built from the same
// primitives the real app uses (PaperCard, HabitCell, StreakFlame), so what
// the tour shows is what the product is, just already lived in.
//
// The narrative runs across the pages: the same three habits and twelve day
// streak appear on the tracker page, in the journal lines, and under the
// analysis stats. One person's good fortnight, seen from three sides, then
// the privacy promise and the way in.
//
// Guest screen — needs no session, saves nothing, can be left at any time.

import { HabitCell } from "@/components/ui/habit-cell";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { StreakFlame } from "@/components/ui/streak-flame";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PAGE_COUNT = 4;

/** The example person's habits — reused on every page so the story holds. */
const DEMO_HABITS = ["Exercise", "Read", "Meditate"];
/** Day labels for the sandbox grid, oldest first. */
const DEMO_DAYS = ["Wed", "Thu", "Fri", "Today"];
/**
 * Pre-ticked cells, [day][habit]. The last row starts empty on purpose: it is
 * the row the visitor gets to tick themselves.
 */
const DEMO_FILLED: boolean[][] = [
  [true, true, false],
  [true, true, true],
  [true, false, true],
  [false, false, false],
];

const DEMO_CELL = 44;
const DEMO_DAY_COLUMN = 52;

/**
 * The heatmap thumbnail on the analysis page: four weeks of intensity, 0 to 3.
 * Hand-tuned to read as "a real month with a strong recent run".
 */
const DEMO_HEAT: number[][] = [
  [1, 0, 2, 1, 0, 1, 2],
  [2, 1, 1, 0, 2, 3, 1],
  [1, 2, 3, 2, 1, 2, 3],
  [3, 2, 3, 3, 2, 3, 3],
];
const HEAT_TINTS = [Hairline.faint, `${Colors.accent}44`, `${Colors.accent}88`, Colors.accent];

/** Small corner tag that keeps the staged data honest. */
function ExampleTag() {
  return (
    <View style={styles.exampleTag}>
      <Text style={styles.exampleTagText}>example</Text>
    </View>
  );
}

/** Page scaffold: header, visual, caption, optional evidence footnote. */
interface TourPageProps {
  width: number;
  title: string;
  caption: string;
  children: React.ReactNode;
  /** A short research line plus its source, when the page has one. */
  evidence?: { line: string; source: string };
}

function TourPage({ width, title, caption, children, evidence }: TourPageProps) {
  return (
    <View style={[styles.page, { width }]}>
      <Text style={styles.pageTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.pageRule} />
      <View style={styles.pageBody}>{children}</View>
      <Text style={styles.pageCaption}>{caption}</Text>
      {evidence && (
        <View style={styles.evidence}>
          <Text style={styles.evidenceLine}>{evidence.line}</Text>
          <Text style={styles.evidenceSource}>{evidence.source}</Text>
        </View>
      )}
    </View>
  );
}

/** Page 1's sandbox: the real HabitCell, wired to throwaway state. */
function DemoGrid() {
  const [filled, setFilled] = useState(DEMO_FILLED);

  function toggle(day: number, habit: number) {
    setFilled((prev) =>
      prev.map((row, d) =>
        d === day ? row.map((v, h) => (h === habit ? !v : v)) : row,
      ),
    );
  }

  return (
    <PaperCard style={styles.demoCard}>
      <ExampleTag />
      <View style={styles.demoHeaderRow}>
        <View style={{ width: DEMO_DAY_COLUMN }} />
        {DEMO_HABITS.map((name) => (
          <Text key={name} style={styles.demoHabitName} numberOfLines={1}>
            {name}
          </Text>
        ))}
      </View>
      {DEMO_DAYS.map((day, d) => (
        <View key={day} style={styles.demoRow}>
          <Text
            style={[styles.demoDay, d === DEMO_DAYS.length - 1 && styles.demoToday]}
          >
            {day}
          </Text>
          {DEMO_HABITS.map((name, h) => (
            <View key={name} style={styles.demoCellWrap}>
              <HabitCell
                completed={filled[d][h]}
                onPress={() => toggle(d, h)}
                isCurrentDay={d === DEMO_DAYS.length - 1}
                size={DEMO_CELL}
                accessibilityLabel={`${name}, ${day}, ${filled[d][h] ? "completed" : "not completed"}`}
              />
            </View>
          ))}
        </View>
      ))}
      <Text style={styles.demoHint}>Go on, tap one. This grid is yours to try.</Text>
    </PaperCard>
  );
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [pageIndex, setPageIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  function handlePageSettle(offsetX: number) {
    const next = Math.round(offsetX / width);
    if (next !== pageIndex) {
      setPageIndex(next);
      void Haptics.selectionAsync();
    }
  }

  function begin() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/onboarding/habits" as Href);
  }

  return (
    <PaperBackground>
      <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={begin}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Skip the tour and get started"
          >
            <Text style={styles.skipText}>Skip to setup</Text>
          </TouchableOpacity>
        </View>

        <Animated.ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false },
          )}
          onMomentumScrollEnd={(e) =>
            handlePageSettle(e.nativeEvent.contentOffset.x)
          }
          scrollEventThrottle={16}
        >
          {/* -------- Page 1: the tracker -------- */}
          <TourPage
            width={width}
            title="Keep your word, one tap at a time"
            caption="Every day you show up, you tick the box. The grid remembers so you don't have to."
            evidence={{
              line: "Across 138 studies, people who tracked their progress reached their goals far more often.",
              source: "Harkin et al. 2016, Psychological Bulletin",
            }}
          >
            <DemoGrid />
          </TourPage>

          {/* -------- Page 2: the journal -------- */}
          <TourPage
            width={width}
            title="One honest line a day"
            caption="Thirty seconds before bed. A year from now it reads like a book about you."
          >
            <PaperCard style={styles.entryCard}>
              <ExampleTag />
              <Text style={styles.entryDate}>Thu, Aug 20</Text>
              <Text style={styles.entryText}>
                Gym at 7am. Nearly bailed, went anyway. Felt great the whole
                day after.
              </Text>
            </PaperCard>
            <PaperCard style={styles.entryCard}>
              <Text style={styles.entryDate}>Fri, Aug 21</Text>
              <Text style={styles.entryText}>
                Finished my book on the train. Quiet day, good one.
              </Text>
              <View style={styles.entryMetaRow}>
                <IconSymbol name="checkmark" size={13} color={Colors.textSecondary} />
                <Text style={styles.entryMeta}>3 of 3 habits kept</Text>
              </View>
            </PaperCard>
          </TourPage>

          {/* -------- Page 3: the analysis -------- */}
          <TourPage
            width={width}
            title="Watch your patterns emerge"
            caption="Streaks, strong days, slow weeks. After a while the app can show you what your days are made of."
            evidence={{
              line: "A new habit takes about 66 days to feel automatic. Missing a single day makes no difference in the long run.",
              source: "Lally et al. 2010, European Journal of Social Psychology",
            }}
          >
            <PaperCard style={styles.analysisCard}>
              <ExampleTag />
              <View style={styles.analysisTopRow}>
                <StreakFlame streak={12} size={44} />
                <View style={styles.analysisStat}>
                  <Text style={styles.analysisNumber}>12 days</Text>
                  <Text style={styles.analysisLabel}>current streak</Text>
                </View>
                <View style={styles.analysisStat}>
                  <Text style={styles.analysisNumber}>86%</Text>
                  <Text style={styles.analysisLabel}>this month</Text>
                </View>
              </View>
              <View style={styles.heatmap}>
                {DEMO_HEAT.map((row, r) => (
                  <View key={r} style={styles.heatRow}>
                    {row.map((v, c) => (
                      <View
                        key={c}
                        style={[styles.heatCell, { backgroundColor: HEAT_TINTS[v] }]}
                      />
                    ))}
                  </View>
                ))}
              </View>
              <Text style={styles.heatCaptionText}>
                Four weeks of Exercise, drawn as a grid
              </Text>
            </PaperCard>
          </TourPage>

          {/* -------- Page 4: the promise, and the door -------- */}
          <TourPage
            width={width}
            title="Yours. Actually yours."
            caption="No feed of strangers, no ads, no one reading over your shoulder. Just you and your days."
          >
            <View style={styles.privacyBlock}>
              <View style={styles.privacyMark}>
                <IconSymbol name="lock.fill" size={30} color={Colors.paper} />
              </View>
              <Text style={styles.privacyLine}>
                Everything you write is encrypted on your phone before it is
                saved.
              </Text>
              <Text style={styles.privacyLine}>
                We cannot read your journal. Nobody can.
              </Text>
            </View>
            <PressableScale
              style={styles.ctaButton}
              onPress={begin}
              accessibilityRole="button"
              accessibilityLabel="Make it yours"
            >
              <Text style={styles.ctaText}>Make it yours</Text>
            </PressableScale>
          </TourPage>
        </Animated.ScrollView>

        {/* Page dots — the active one stretches, like the step dots. */}
        <View style={[styles.dots, { paddingBottom: insets.bottom + 16 }]}>
          {Array.from({ length: PAGE_COUNT }).map((_, i) => {
            const dotWidth = scrollX.interpolate({
              inputRange: [(i - 1) * width, i * width, (i + 1) * width],
              outputRange: [8, 24, 8],
              extrapolate: "clamp",
            });
            const dotOpacity = scrollX.interpolate({
              inputRange: [(i - 1) * width, i * width, (i + 1) * width],
              outputRange: [0.25, 1, 0.25],
              extrapolate: "clamp",
            });
            return (
              <Animated.View
                key={i}
                style={[styles.dot, { width: dotWidth, opacity: dotOpacity }]}
              />
            );
          })}
        </View>
      </View>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 4,
  },
  backButton: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  skipButton: { paddingVertical: 8, paddingHorizontal: 4 },
  skipText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
  page: {
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  pageTitle: {
    fontSize: 26,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    lineHeight: 34,
  },
  pageRule: {
    height: 2,
    width: 48,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginTop: 10,
    marginBottom: 18,
  },
  pageBody: { marginBottom: 16 },
  pageCaption: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 23,
  },
  evidence: {
    marginTop: 14,
    backgroundColor: Scrim.accent,
    borderRadius: 12,
    padding: 14,
  },
  evidenceLine: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    lineHeight: 21,
  },
  evidenceSource: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  exampleTag: {
    position: "absolute",
    top: 10,
    right: 12,
    backgroundColor: Scrim.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    zIndex: 1,
  },
  exampleTagText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  demoCard: { paddingTop: 18 },
  demoHeaderRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8 },
  demoHabitName: {
    flex: 1,
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    textAlign: "center",
  },
  demoRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  demoDay: {
    width: DEMO_DAY_COLUMN,
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  demoToday: { color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  demoCellWrap: { flex: 1, alignItems: "center" },
  demoHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 10,
  },
  entryCard: { marginBottom: 12 },
  entryDate: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  entryText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 25,
  },
  entryMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
  },
  entryMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  analysisCard: { paddingTop: 18 },
  analysisTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
  },
  analysisStat: { flex: 1 },
  analysisNumber: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  analysisLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
  heatmap: { gap: 4, marginBottom: 8 },
  heatRow: { flexDirection: "row", gap: 4 },
  heatCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Hairline.outline,
  },
  heatCaptionText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
  privacyBlock: { alignItems: "center", paddingVertical: 12 },
  privacyMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  privacyLine: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 25,
    marginBottom: 10,
    maxWidth: 300,
  },
  ctaButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 8,
  },
  ctaText: {
    fontSize: 18,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingTop: 12,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.ink,
  },
});
