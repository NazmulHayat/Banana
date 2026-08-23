// Onboarding step 3 of 3 — the first entry.
//
// Nothing here asks for free writing up front. A mood tap seeds a first
// sentence, the chips extend it, and the text box stays fully editable for
// anyone who wants to say it their own way. The opening line adapts to the
// step 2 survey answer, so the screen talks to the person who is actually
// standing in front of it.
//
// Two exits, both real:
//   guest    — the entry (and the habit picks) live in the draft; Save walks
//              into signup, and account setup persists everything after the
//              keyring exists.
//   signed in — an existing account that never finished onboarding lands here
//              too; Save writes habits + entry through the store right now
//              and finishes the flow without ever showing signup.
//
// Deliberately does NOT ask for photo permission: the first thing we do is
// not going to be a permission prompt. Photos are offered later, in the
// composer.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import { fromDayKey, todayKey } from "@/lib/dates";
import { useOnboarding } from "@/lib/onboarding-context";
import type { MoodId } from "@/lib/onboarding-draft";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "@/lib/onboarding-draft";
import { persistOnboardingDraft } from "@/lib/onboarding-persist";
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

const MAX_HIGHLIGHT_LENGTH = 500;

type Stage = "compose" | "saved";

interface MoodOption {
  id: MoodId;
  label: string;
  /** The sentence this mood writes when the page is still blank. */
  seed: string;
}

const MOODS: MoodOption[] = [
  { id: "rough", label: "Rough", seed: "Today was rough." },
  { id: "flat", label: "Okay", seed: "Today was okay, nothing special." },
  { id: "good", label: "Good", seed: "Today was a good one." },
  { id: "great", label: "Great", seed: "Today was a great day." },
];

/** Tappable half-sentences that extend whatever is already written. */
const CHIPS = [
  "One thing on my mind:",
  "Something good:",
  "Tomorrow I want to",
];

/** The line under the title, tuned by the step 2 answer. */
function openingLine(prior: string | null): string {
  if (prior === "fell_off") return "We'll keep it light. No guilt here, ever.";
  if (prior === "doing_it") return "Then let's make it stick this time.";
  if (prior === "never") return "Starting small is the whole trick.";
  return "A line or two is plenty. It's also fine to skip.";
}

export default function FirstEntryScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useOnboarding();
  const { session, keyringReady } = useAuth();
  const dataStore = useDataStore();

  const [stage, setStage] = useState<Stage>("compose");
  const [text, setText] = useState("");
  const [mood, setMood] = useState<MoodId | null>(null);
  const [opening, setOpening] = useState(openingLine(null));
  const [saving, setSaving] = useState(false);
  // User-safe reason from the last failed save — the words stay on screen.
  const [saveError, setSaveError] = useState<string | null>(null);
  // True when the entry is durably queued rather than on the server yet.
  const [queued, setQueued] = useState(false);
  // A second tap while the write is in flight must not create a second entry.
  const submittingRef = useRef(false);
  // The last sentence a mood tap wrote, so switching moods swaps it instead of
  // stacking a second one — but never touches words the user typed.
  const lastSeedRef = useRef<string | null>(null);

  // Signed in with the keyring open: Save can persist right now, no signup.
  const canSaveDirectly = !!session && keyringReady;

  // "Mon, Mar 4" — the day this entry files under, formatted from the same
  // local day key the write uses so the label can't disagree with the entry.
  const todayLabel = fromDayKey(todayKey()).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

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
  }, [fade, rise]);

  // Restore the draft (text, mood, survey answer) after a background/relaunch.
  useEffect(() => {
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (cancelled) return;
      if (draft.highlight) setText(draft.highlight);
      if (draft.mood) setMood(draft.mood);
      setOpening(openingLine(draft.priorExperience));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on the way to the background rather than on every keystroke.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") saveOnboardingDraft({ highlight: text, mood });
    });
    return () => sub.remove();
  }, [text, mood]);

  function tapMood(option: MoodOption) {
    void Haptics.selectionAsync();
    setMood(option.id);
    setSaveError(null);
    const current = text.trim();
    // Blank page, or still exactly a previous mood's sentence: write over it.
    if (current === "" || current === lastSeedRef.current) {
      setText(option.seed);
      lastSeedRef.current = option.seed;
    }
    saveOnboardingDraft({ mood: option.id });
  }

  function tapChip(chip: string) {
    void Haptics.selectionAsync();
    setSaveError(null);
    setText((prev) => {
      const base = prev.trimEnd();
      const next = base === "" ? `${chip} ` : `${base}\n${chip} `;
      return next.slice(0, MAX_HIGHLIGHT_LENGTH);
    });
  }

  /** Persist habits + entry through the store (signed-in path only). */
  async function saveDirectly(): Promise<boolean> {
    // Shared with account setup — one save site for the whole draft. `queued`
    // is durable and replays, so the flow carries on; only `failed` holds the
    // user here with a retry on the same button.
    const result = await persistOnboardingDraft(dataStore);
    if (!result.ok) {
      setSaveError(result.reason ?? "Couldn't save that. Please try again.");
      return false;
    }
    setQueued(result.queued);
    return true;
  }

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      // Keep the words safe before anything else, so a background kill or a
      // failed write can't take them.
      saveOnboardingDraft({ highlight: trimmed, mood });

      if (!canSaveDirectly) {
        // Guest: the entry rides the draft into signup. Account setup encrypts
        // and saves it once the keyring exists.
        router.push("/auth/signup");
        return;
      }

      const ok = await saveDirectly();
      if (!ok) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await clearOnboardingDraft();
      await completeOnboarding();
      setStage("saved");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  async function handleSkip() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      saveOnboardingDraft({ highlight: text.trim(), mood });
      if (!canSaveDirectly) {
        router.push("/auth/signup");
        return;
      }
      // Signed in: still save the habit picks, just no entry.
      saveOnboardingDraft({ highlight: "", mood });
      setSaving(true);
      const ok = await saveDirectly();
      setSaving(false);
      if (!ok) return;
      await clearOnboardingDraft();
      await completeOnboarding();
      router.replace("/(tabs)" as Href);
    } finally {
      submittingRef.current = false;
    }
  }

  if (stage === "saved") {
    return (
      <PaperBackground>
        <View
          style={[
            styles.container,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 },
          ]}
        >
          <View style={styles.savedBody}>
            <View style={styles.savedMark}>
              <IconSymbol name="checkmark" size={36} color={Colors.paper} />
            </View>
            <Text style={styles.savedTitle} accessibilityRole="header">
              That&apos;s your first entry.
            </Text>
            {/* Mark, title, accent rule — the same stack the welcome opens
                with, so the flow closes the way it started. */}
            <View style={styles.savedRule} />
            <Text style={styles.savedSub}>
              {queued
                ? "Saved on this device. It syncs as soon as you're back online."
                : "It's encrypted and saved. Your feed builds from here."}
            </Text>

            <PaperCard style={styles.savedCard}>
              <Text style={styles.savedCardText}>{text.trim()}</Text>
            </PaperCard>
          </View>

          <View>
            <PressableScale
              style={styles.primaryButton}
              onPress={() => router.replace("/(tabs)" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Start tracking"
            >
              <Text style={styles.primaryButtonText}>Start tracking</Text>
            </PressableScale>

            <OnboardingProgress step={3} />
          </View>
        </View>
      </PaperBackground>
    );
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
            styles.container,
            { paddingTop: insets.top + 16, paddingBottom: 32 },
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
              How was today?
            </Text>
            {/* Same accent rule as the other steps — one mark, one flow. */}
            <View style={styles.titleRule} />
            <Text style={styles.subtitle}>{opening}</Text>

            {/* Mood row — the one tap that starts the page. */}
            <View style={styles.moodRow}>
              {MOODS.map((option) => {
                const active = mood === option.id;
                return (
                  <PressableScale
                    key={option.id}
                    style={[styles.moodPill, active && styles.moodPillActive]}
                    onPress={() => tapMood(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Mood: ${option.label}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[styles.moodText, active && styles.moodTextActive]}
                    >
                      {option.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>

            {/* Section label + rule, matching step 1's headings. The date is
                real: this entry files under today, and saying so beats a
                composer that just appears. */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Today</Text>
              <View style={styles.sectionRule} />
              <Text style={styles.sectionMeta}>{todayLabel}</Text>
            </View>

            <View style={styles.inputBox}>
              <TextInput
                style={styles.textInput}
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  setSaveError(null);
                }}
                placeholder="Tap a mood above, or just write"
                placeholderTextColor={Colors.textSecondary}
                maxLength={MAX_HIGHLIGHT_LENGTH}
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* Prompt chips — each one is a sentence the user doesn't have to
                start themselves. */}
            <View style={styles.chipRow}>
              {CHIPS.map((chip) => (
                <TouchableOpacity
                  key={chip}
                  style={styles.chip}
                  onPress={() => tapChip(chip)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Add prompt: ${chip}`}
                >
                  <Text style={styles.chipText}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {saveError ? (
              <Text style={styles.saveError}>
                {saveError} Tap save to try again.
              </Text>
            ) : null}

            <PressableScale
              style={[
                styles.primaryButton,
                (!text.trim() || saving) && styles.disabled,
              ]}
              disabled={!text.trim() || saving}
              onPress={handleSave}
              accessibilityRole="button"
              accessibilityLabel="Save my first entry"
              accessibilityState={{ disabled: !text.trim() || saving }}
            >
              <Text style={styles.primaryButtonText}>
                {saving ? "Saving…" : "Save my first entry"}
              </Text>
            </PressableScale>

            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Skip writing for now"
            >
              <Text style={styles.skipText}>I&apos;ll write later</Text>
            </TouchableOpacity>

            <OnboardingProgress step={3} />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
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
    marginBottom: 20,
  },
  moodRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 24,
  },
  moodPill: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 22,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: Colors.card,
  },
  moodPillActive: { backgroundColor: Colors.ink },
  moodText: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
  },
  moodTextActive: { color: Colors.paper },
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
    marginHorizontal: 12,
  },
  sectionMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  inputBox: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 16,
    padding: 16,
    minHeight: 130,
    marginBottom: 12,
  },
  textInput: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 28,
    flex: 1,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    borderWidth: 1,
    borderColor: Hairline.raised,
    borderRadius: 16,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
  },
  chipText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  saveError: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: Colors.ink,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 18,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  disabled: { opacity: 0.4 },
  skipButton: { alignItems: "center", paddingVertical: 12 },
  skipText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  savedBody: { flex: 1, alignItems: "center", paddingTop: 24 },
  savedMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  savedTitle: {
    fontSize: 26,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  savedRule: {
    height: 2,
    width: 48,
    backgroundColor: Colors.accent,
    borderRadius: 1,
    marginTop: 12,
    marginBottom: 16,
  },
  savedSub: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  savedCard: { width: "100%" },
  savedCardText: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 28,
  },
});
