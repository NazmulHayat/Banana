// Onboarding step 2 of 3 — pick starter habits.
//
// This screen used to run a scripted demo before letting anyone touch it: a
// timed fake scroll, a "transition" message, and three chained setTimeouts,
// none of which were cleared on unmount — leaving the app to fade, scroll and
// setState against a screen the user had already left. It is now a plain form:
// the controls are live on first paint, Back works, nothing waits on a timer,
// and the only animation is one entrance handle that is stopped on unmount.
//
// The selection is mirrored to the onboarding draft, so backgrounding the app
// or a failed save never costs the user their picks.

import { HabitCell } from "@/components/ui/habit-cell";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import type { Habit } from "@/lib/db";
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

/** Start small — five is plenty to build a rhythm, and the grid stays legible. */
const MAX_STARTER_HABITS = 5;
/** Columns in the little live preview grid. */
const PREVIEW_DAYS = 5;
const PREVIEW_CELL_SIZE = 28;

const HABIT_SUGGESTIONS = [
  { name: "Exercise", emoji: "💪" },
  { name: "Read", emoji: "📚" },
  { name: "Meditate", emoji: "🧘" },
  { name: "Journal", emoji: "✍️" },
  { name: "Hydrate", emoji: "💧" },
  { name: "Sleep 8hrs", emoji: "😴" },
  { name: "No phone", emoji: "📵" },
  { name: "Walk", emoji: "🚶" },
  { name: "Stretch", emoji: "🤸" },
  { name: "Vitamins", emoji: "💊" },
];

export default function OnboardingHabitsScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();

  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [customHabit, setCustomHabit] = useState("");
  const [saving, setSaving] = useState(false);
  // User-safe reason from the last failed save; keeps the user on this step.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Second tap while a save is in flight must not start a second write.
  const submittingRef = useRef(false);

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

  function toggleHabit(name: string) {
    const isSelected = selectedHabits.includes(name);
    if (!isSelected && atLimit) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSaveError(null);
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
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    commitSelection([...selectedHabits, name]);
    setCustomHabit("");
  }

  async function handleContinue() {
    if (selectedHabits.length === 0 || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      if (!session) {
        setSaveError("You're signed out. Sign in to save your habits.");
        return;
      }

      // Existing habits come from the store (memory → storage → network), so an
      // offline retry merges against what we already have instead of nothing.
      const existingHabits = await dataStore.refreshHabits();
      const existingNames = new Set(
        existingHabits.map((h) => h.name.toLowerCase()),
      );
      const createdAt = new Date().toISOString();
      const newHabits: Habit[] = selectedHabits
        .filter((name) => !existingNames.has(name.toLowerCase()))
        .map((name, index) => ({
          id: `${Date.now()}${index}`,
          name,
          createdAt,
        }));

      // The store never throws. `queued` means the write is in the durable
      // queue and will replay, so onboarding carries on — only `failed` holds
      // the user here, with the retry on the same button. Either way the draft
      // still holds the selection.
      const outcome = await dataStore.saveHabits([
        ...existingHabits,
        ...newHabits,
      ]);
      if (outcome.status === "failed") {
        setSaveError(outcome.reason);
        return;
      }
      router.push("/onboarding/feed-demo" as Href);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
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
            <Text style={styles.title}>What do you want to track?</Text>
            <Text style={styles.subtitle}>
              Pick up to {MAX_STARTER_HABITS}. You can change them any time —
              or skip and add them later.
            </Text>

            <View style={styles.suggestions}>
              {HABIT_SUGGESTIONS.map((habit) => {
                const isSelected = selectedHabits.includes(habit.name);
                const isBlocked = !isSelected && atLimit;
                return (
                  <PressableScale
                    key={habit.name}
                    style={[
                      styles.pill,
                      isSelected && styles.pillSelected,
                      isBlocked && styles.pillBlocked,
                    ]}
                    disabled={isBlocked}
                    onPress={() => toggleHabit(habit.name)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={habit.name}
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={styles.pillEmoji}>{habit.emoji}</Text>
                    <Text
                      style={[
                        styles.pillText,
                        isSelected && styles.pillTextSelected,
                      ]}
                    >
                      {habit.name}
                    </Text>
                    {isSelected && (
                      <IconSymbol
                        name="checkmark"
                        size={15}
                        color={Colors.paper}
                      />
                    )}
                  </PressableScale>
                );
              })}
            </View>

            <Text style={styles.customLabel}>Or add your own:</Text>
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

            {/* Live preview — updates as they pick, so the grid isn't a
                surprise on day one. */}
            <PaperCard style={styles.preview}>
              <Text style={styles.previewLabel}>Your tracker</Text>
              {selectedHabits.length === 0 ? (
                <Text style={styles.previewEmpty}>
                  Pick a habit and it&apos;ll show up here.
                </Text>
              ) : (
                selectedHabits.map((habit) => (
                  <View key={habit} style={styles.previewRow}>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {habit}
                    </Text>
                    <View style={styles.previewCells}>
                      {Array.from({ length: PREVIEW_DAYS }).map((_, i) => (
                        <HabitCell
                          key={i}
                          completed={false}
                          onPress={() => {}}
                          size={PREVIEW_CELL_SIZE}
                          // A preview, not a control — dead on purpose.
                          disabled
                          accessibilityLabel={`${habit}, preview`}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </PaperCard>
          </Animated.View>
        </ScrollView>

        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}
        >
          <Text style={styles.countText}>
            {selectedHabits.length} of {MAX_STARTER_HABITS} selected
          </Text>

          {saveError ? (
            <Text style={styles.saveError}>
              {saveError} Tap continue to try again.
            </Text>
          ) : null}

          <PressableScale
            style={[
              styles.continueButton,
              (selectedHabits.length === 0 || saving) && styles.disabled,
            ]}
            disabled={selectedHabits.length === 0 || saving}
            onPress={handleContinue}
          >
            <Text style={styles.continueText}>
              {saving ? "Saving…" : "Continue"}
            </Text>
          </PressableScale>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={() => router.push("/onboarding/feed-demo" as Href)}
            disabled={saving}
            activeOpacity={0.85}
          >
            <Text style={[styles.skipText, saving && styles.disabled]}>
              Skip for now
            </Text>
          </TouchableOpacity>

          <View style={styles.progressContainer}>
            <View style={styles.progressDot} />
            <View style={[styles.progressDot, styles.progressDotActive]} />
            <View style={styles.progressDot} />
          </View>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 24,
    marginBottom: 24,
  },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 28,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    gap: 8,
  },
  pillSelected: { backgroundColor: Colors.ink },
  pillBlocked: { opacity: 0.4 },
  pillEmoji: { fontSize: 18 },
  pillText: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
  },
  pillTextSelected: { color: Colors.paper },
  customLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
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
  previewLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  previewEmpty: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 12,
  },
  previewName: {
    flex: 1,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  previewCells: { flexDirection: "row", gap: 4 },
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
  saveError: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginBottom: 10,
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
  skipButton: { alignItems: "center", paddingVertical: 12 },
  skipText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  progressContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingTop: 4,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.shadow,
  },
  progressDotActive: { backgroundColor: Colors.ink, width: 24 },
});
