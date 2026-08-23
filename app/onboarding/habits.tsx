// Onboarding step 1 of 3 — pick starter habits.
//
// This screen used to run a scripted demo before letting anyone touch it: a
// timed fake scroll, a "transition" message, and three chained setTimeouts,
// none of which were cleared on unmount — leaving the app to fade, scroll and
// setState against a screen the user had already left. It is now a plain form:
// the controls are live on first paint, Back works, nothing waits on a timer,
// and every animation handle is stopped on unmount.
//
// The selection is mirrored to the onboarding draft, so backgrounding the app
// or a failed save never costs the user their picks.
//
// This step writes to the DRAFT only. Nothing persists to the server here:
// a guest has no account yet, and a signed-in straggler's picks are saved in
// one place, at the end of the flow (see entry.tsx). One save site, not two.
//
// Skip is quiet but real — the flow promises you can leave any step, and an
// empty tracker now has an empty state that invites rather than accuses.

import { HabitCell } from "@/components/ui/habit-cell";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { toDayKey, todayKey } from "@/lib/dates";
import { HabitLimits } from "@/lib/db";
import {
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboarding-draft";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingProgress } from "./_layout";

/**
 * Two is the floor. One habit is a note-to-self, not a tracker — the grid, the
 * streaks and the analytics all need more than a single column to say anything.
 */
const MIN_STARTER_HABITS = 2;
/** Start small — five is plenty to build a rhythm, and the grid stays legible. */
const MAX_STARTER_HABITS = 5;
/** Day rows in the little live preview — today plus the two days before it. */
const PREVIEW_DAYS = 3;
const PREVIEW_CELL_HEIGHT = 44;
const PREVIEW_DAY_COLUMN = 42;

// Names only. Emoji were tofu boxes here (simulator runtimes ship without
// Apple Color Emoji) and glossy multicolour glyphs fight the paper-and-ink
// aesthetic — the same reason the fruit came out of the feed copy.
const HABIT_SUGGESTIONS = [
  "Exercise",
  "Read",
  "Meditate",
  "Journal",
  "Hydrate",
  "Sleep 8hrs",
  "No phone",
  "Walk",
  "Stretch",
  "Vitamins",
];

/**
 * The line above the Continue button. It says what is *needed*, never a bare
 * number — "1 of 5 selected" tells a blocked user nothing about why the button
 * is dead.
 */
function selectionStatus(count: number): string {
  if (count === 0) return `Pick ${MIN_STARTER_HABITS} to get started`;
  const missing = MIN_STARTER_HABITS - count;
  if (missing > 0) {
    return `Pick ${missing} more to continue`;
  }
  if (count >= MAX_STARTER_HABITS) {
    return `${count} chosen · that's the most you can start with`;
  }
  return `${count} chosen · add more, or continue`;
}

/** Today and the two days before it, oldest first — the preview's day column. */
function recentDays(count: number) {
  const now = new Date();
  const today = todayKey();
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (count - 1 - i),
    );
    const key = toDayKey(date);
    return {
      key,
      name: date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
      number: date.getDate(),
      isToday: key === today,
    };
  });
}

interface HabitPillProps {
  name: string;
  selected: boolean;
  /** At the cap and not already picked — inert, and it looks it. */
  blocked: boolean;
  onToggle: () => void;
}

/**
 * One suggestion. PressableScale gives the press; the extra spring here is the
 * *settle* on select — the same "tick landing" reward HabitCell uses, so
 * picking a habit in onboarding feels like ticking one on the tracker.
 */
function HabitPill({ name, selected, blocked, onToggle }: HabitPillProps) {
  const pop = useRef(new Animated.Value(1)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);

  // Nothing here is a timer, but the handle still dies with the screen.
  useEffect(() => () => running.current?.stop(), []);

  function handlePress() {
    running.current?.stop();
    // Deselect eases back from a touch bigger, select from a touch smaller —
    // the same spring, read as "letting go" versus "landing".
    pop.setValue(selected ? 1.04 : 0.92);
    const settle = Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      ...Motion.springBouncy,
    });
    running.current = settle;
    settle.start();
    onToggle();
  }

  return (
    <PressableScale
      // `containerStyle`, not `style`: PressableScale puts `style` on the inner
      // animated view. A `width: 48%` there resolves against an auto-width
      // parent, which collapses the pill and clips its label to a sliver —
      // which is exactly why every suggestion rendered blank.
      containerStyle={styles.pillSlot}
      disabled={blocked}
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected, disabled: blocked }}
    >
      <Animated.View
        style={[
          styles.pill,
          selected && styles.pillSelected,
          blocked && styles.pillBlocked,
          { transform: [{ scale: pop }] },
        ]}
      >
        <Text
          style={[styles.pillText, selected && styles.pillTextSelected]}
          numberOfLines={1}
        >
          {name}
        </Text>
        {/* Absolute so the label stays centred whether or not it's ticked. */}
        {selected && (
          <View style={styles.pillCheck}>
            <IconSymbol name="checkmark" size={13} color={Colors.paper} />
          </View>
        )}
      </Animated.View>
    </PressableScale>
  );
}

interface TrackerPreviewProps {
  habits: string[];
}

/**
 * The live preview, in the tracker's real orientation: habits are columns, days
 * are rows, today is tinted. It used to be a list of the names they'd just
 * tapped, which told them nothing they didn't already know — this shows the
 * grid they're about to live in. Every cell is inert: there is nothing to log
 * yet, and we never draw ticks the user didn't make.
 */
function TrackerPreview({ habits }: TrackerPreviewProps) {
  const days = recentDays(PREVIEW_DAYS);
  const empty = habits.length === 0;
  const columns = empty ? ["Your habit"] : habits;

  return (
    <PaperCard style={styles.preview}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>Your tracker</Text>
        <View style={styles.sectionRule} />
      </View>

      <View
        style={styles.previewGrid}
        accessible
        accessibilityLabel={
          empty
            ? "Tracker preview, no habits chosen yet"
            : `Tracker preview: ${habits.join(", ")}`
        }
      >
        <View style={styles.previewRow}>
          <View style={styles.previewDayCell}>
            <Text style={styles.previewDayHeader}>DAY</Text>
          </View>
          {columns.map((name) => (
            <View key={name} style={styles.previewColumnHead}>
              <Text
                style={[styles.previewName, empty && styles.previewGhostText]}
                numberOfLines={2}
              >
                {name}
              </Text>
            </View>
          ))}
        </View>

        {days.map((day) => (
          <View key={day.key} style={styles.previewRow}>
            <View style={styles.previewDayCell}>
              <Text style={styles.previewWeekday}>{day.name}</Text>
              <Text style={styles.previewDayNumber}>{day.number}</Text>
            </View>
            {columns.map((name) => (
              <View key={name} style={styles.previewCell}>
                {empty ? (
                  <View style={styles.previewGhostCell} />
                ) : (
                  <HabitCell
                    completed={false}
                    onPress={() => {}}
                    isCurrentDay={day.isToday}
                    size={PREVIEW_CELL_HEIGHT}
                    height={PREVIEW_CELL_HEIGHT}
                    // A preview, not a control — dead on purpose.
                    disabled
                    accessibilityLabel={`${name}, ${day.name} ${day.number}, preview`}
                  />
                )}
              </View>
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.previewCaption}>
        {empty
          ? "Pick a couple and they'll show up here as columns."
          : "One square a day. Tap it and it fills in."}
      </Text>
    </PaperCard>
  );
}

export default function OnboardingHabitsScreen() {
  const insets = useSafeAreaInsets();

  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [customHabit, setCustomHabit] = useState("");

  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const entrance = Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: Motion.base,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: Motion.base,
        useNativeDriver: true,
      }),
    ]);
    entrance.start();
    return () => entrance.stop();
    // Animated.Value refs are stable across renders (useRef).
  }, [fade, rise]);

  // Restore anything picked before a background/relaunch.
  useEffect(() => {
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (cancelled || draft.habits.length === 0) return;
      setSelectedHabits(draft.habits.slice(0, MAX_STARTER_HABITS));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Flush on the way to the background as well as on every change, so a
  // process kill while backgrounded can't lose the selection.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") saveOnboardingDraft({ habits: selectedHabits });
    });
    return () => sub.remove();
  }, [selectedHabits]);

  function commitSelection(next: string[]) {
    setSelectedHabits(next);
    saveOnboardingDraft({ habits: next });
  }

  const atLimit = selectedHabits.length >= MAX_STARTER_HABITS;
  const canContinue = selectedHabits.length >= MIN_STARTER_HABITS;

  function toggleHabit(name: string) {
    const isSelected = selectedHabits.includes(name);
    if (!isSelected && atLimit) return;
    // Same haptic grammar as the tracker: a selection tick on the way in, a
    // light tap on the way out.
    if (isSelected) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else {
      void Haptics.selectionAsync();
    }
    commitSelection(
      isSelected
        ? selectedHabits.filter((h) => h !== name)
        : [...selectedHabits, name],
    );
  }

  function addCustomHabit() {
    const name = customHabit.trim().slice(0, HabitLimits.MAX_NAME_LENGTH);
    if (!name || atLimit) return;
    const exists = selectedHabits.some(
      (h) => h.toLowerCase() === name.toLowerCase(),
    );
    if (exists) {
      setCustomHabit("");
      return;
    }
    // A habit typed by hand counts toward the minimum exactly like a tapped
    // suggestion — they all land in the same list.
    void Haptics.selectionAsync();
    commitSelection([...selectedHabits, name]);
    setCustomHabit("");
  }

  function handleContinue() {
    if (selectedHabits.length < MIN_STARTER_HABITS) return;
    // Draft only — the real save happens once, at the end of the flow
    // (entry.tsx for a signed-in user, account setup for a guest).
    saveOnboardingDraft({ habits: selectedHabits });
    router.push("/onboarding/survey" as Href);
  }

  function handleSkip() {
    saveOnboardingDraft({ habits: selectedHabits });
    router.push("/onboarding/survey" as Href);
  }

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            // The action bar below is a sibling, not an overlay — the scroll
            // only needs breathing room, not clearance.
            { paddingTop: insets.top + 16, paddingBottom: 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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

          <Animated.View
            style={{ opacity: fade, transform: [{ translateY: rise }] }}
          >
            <Text style={styles.title} accessibilityRole="header">
              What do you want to track?
            </Text>
            {/* The accent rule under the title is the motif all three steps
                share — the flow's one orange mark. */}
            <View style={styles.titleRule} />
            <Text style={styles.subtitle}>
              Choose at least {MIN_STARTER_HABITS}, up to {MAX_STARTER_HABITS}.
              You can rename, add or remove them any time.
            </Text>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Suggestions</Text>
              <View style={styles.sectionRule} />
            </View>

            <View style={styles.suggestions}>
              {HABIT_SUGGESTIONS.map((habit) => {
                const isSelected = selectedHabits.includes(habit);
                return (
                  <HabitPill
                    key={habit}
                    name={habit}
                    selected={isSelected}
                    blocked={!isSelected && atLimit}
                    onToggle={() => toggleHabit(habit)}
                  />
                );
              })}
            </View>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Or add your own</Text>
              <View style={styles.sectionRule} />
            </View>

            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                value={customHabit}
                onChangeText={setCustomHabit}
                placeholder="Your habit..."
                placeholderTextColor={Colors.textSecondary}
                maxLength={HabitLimits.MAX_NAME_LENGTH}
                onSubmitEditing={addCustomHabit}
                returnKeyType="done"
                editable={!atLimit}
                accessibilityLabel="Your own habit"
              />
              <PressableScale
                style={[
                  styles.addButton,
                  (!customHabit.trim() || atLimit) && styles.disabled,
                ]}
                disabled={!customHabit.trim() || atLimit}
                onPress={addCustomHabit}
                accessibilityLabel="Add this habit"
              >
                <IconSymbol name="plus" size={20} color={Colors.paper} />
              </PressableScale>
            </View>

            <TrackerPreview habits={selectedHabits} />
          </Animated.View>
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
          <Text
            style={styles.countText}
            accessibilityLiveRegion="polite"
            accessibilityLabel={`${selectedHabits.length} of ${MAX_STARTER_HABITS} chosen. ${selectionStatus(
              selectedHabits.length,
            )}`}
          >
            {selectionStatus(selectedHabits.length)}
          </Text>

          <PressableScale
            style={[styles.continueButton, !canContinue && styles.disabled]}
            disabled={!canContinue}
            onPress={handleContinue}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            // A disabled button has to read disabled to VoiceOver — and say
            // what would un-disable it. The hint is about the minimum only;
            // while saving, `busy` is the honest reason it won't respond.
            accessibilityHint={
              selectedHabits.length < MIN_STARTER_HABITS
                ? `Choose at least ${MIN_STARTER_HABITS} habits to continue`
                : undefined
            }
            accessibilityState={{ disabled: !canContinue }}
          >
            <Text style={styles.continueText}>Continue</Text>
          </PressableScale>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Skip picking habits for now"
          >
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </TouchableOpacity>

          <OnboardingProgress step={1} />
        </View>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  title: {
    fontSize: 28,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    lineHeight: 36,
  },
  titleRule: {
    height: 2,
    width: 48,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginTop: 10,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
    marginBottom: 24,
  },
  // Small-caps label + hairline rule: the third tier of the hierarchy, under
  // the question and its helper line.
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: Hairline.base,
    marginLeft: 12,
  },
  suggestions: {
    // Fixed two-column grid: variable-width pills in a wrap layout produced
    // ragged rows and dead space at the end of each line.
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
    marginBottom: 26,
  },
  pillSlot: { width: "48%" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
    paddingVertical: 13,
    // Room on both sides for the tick, so the label never shifts when picked.
    paddingHorizontal: 26,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Colors.ink,
  },
  pillSelected: { backgroundColor: Colors.ink },
  pillBlocked: { opacity: 0.4 },
  pillText: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
  },
  pillTextSelected: { color: Colors.paper },
  pillCheck: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  customRow: { flexDirection: "row", gap: 12, marginBottom: 28 },
  customInput: {
    flex: 1,
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
  },
  addButton: {
    width: 52,
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
  preview: { padding: 16 },
  previewGrid: { marginBottom: 12 },
  previewRow: { flexDirection: "row", gap: 4, marginBottom: 4 },
  previewDayCell: {
    width: PREVIEW_DAY_COLUMN,
    height: PREVIEW_CELL_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  previewDayHeader: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    letterSpacing: 0.5,
  },
  previewWeekday: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    letterSpacing: 0.3,
  },
  previewDayNumber: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  previewColumnHead: {
    flex: 1,
    height: PREVIEW_CELL_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  previewName: {
    fontSize: 11,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  previewGhostText: { color: Colors.textSecondary },
  previewCell: { flex: 1, height: PREVIEW_CELL_HEIGHT },
  // The empty state keeps the frame, so the card reads as a grid waiting to be
  // filled rather than a lonely sentence.
  previewGhostCell: {
    flex: 1,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Hairline.outline,
  },
  previewCaption: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  bottomBar: {
    backgroundColor: Colors.paper,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.shadow,
  },
  countText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginBottom: 10,
  },
  skipButton: { alignItems: "center", paddingVertical: 10 },
  skipLinkText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  continueButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
  },
  continueText: {
    fontSize: 18,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
});
