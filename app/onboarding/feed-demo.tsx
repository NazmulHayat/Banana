// Onboarding step 3 of 3 — "One line about today".
//
// The file name is a leftover: renaming the route means regenerating the typed
// route table, so the rename is queued rather than done here. Nothing on this
// screen is a demo — the entry the user writes is their real first entry.
//
// The old version auto-advanced through the composer on a 600ms setTimeout and
// sat on an Animated.delay(1000) before showing the feed, none of it cleared on
// unmount. Now the composer is live immediately, the entry is optional, and
// success is a still card — no timers at all.
//
// Deliberately does NOT ask for photo permission: the first thing we do is not
// going to be a permission prompt. Photos are offered later, in the composer.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import { todayKey } from "@/lib/dates";
import type { DailyEntry } from "@/lib/db";
import { useOnboarding } from "@/lib/onboarding-context";
import {
  clearOnboardingDraft,
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

const MAX_HIGHLIGHT_LENGTH = 500;

type Stage = "compose" | "saved";

export default function FirstHighlightScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useOnboarding();
  const { session } = useAuth();
  const dataStore = useDataStore();

  const [stage, setStage] = useState<Stage>("compose");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // User-safe reason from the last failed save — the words stay on screen.
  const [saveError, setSaveError] = useState<string | null>(null);
  // True when the entry is durably queued rather than on the server yet.
  const [queued, setQueued] = useState(false);
  // A second tap while the write is in flight must not create a second entry.
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

  // Restore a draft written before a background/relaunch.
  useEffect(() => {
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (cancelled || !draft.highlight) return;
      setText(draft.highlight);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on the way to the background rather than on every keystroke.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") saveOnboardingDraft({ highlight: text });
    });
    return () => sub.remove();
  }, [text]);

  async function handleSave() {
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setSaveError(null);

    try {
      if (!session) {
        setSaveError("You're signed out. Sign in to save your first entry.");
        return;
      }

      // Keep the words safe before the write, so a failure (or a background
      // kill mid-write) can't take them.
      saveOnboardingDraft({ highlight: trimmed });

      const entry: DailyEntry = {
        id: `onboarding-${Date.now()}`,
        date: todayKey(),
        text: trimmed,
        mediaPaths: [],
        createdAt: new Date().toISOString(),
      };

      // The store never throws. A `queued` write is durable and replays on
      // reconnect, so onboarding carries on; only `failed` sends the user back
      // to the composer with their words intact.
      const outcome = await dataStore.saveEntry(entry);
      if (outcome.status === "failed") {
        setSaveError(outcome.reason);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setQueued(outcome.status === "queued");
      setStage("saved");
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  async function finish(destination: Href) {
    await clearOnboardingDraft();
    await completeOnboarding();
    router.replace(destination);
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
            <Text style={styles.savedTitle}>That&apos;s your first entry.</Text>
            <Text style={styles.savedSub}>
              {queued
                ? "Saved on this device — it'll sync as soon as you're back online."
                : "It's encrypted and saved. Your Feed builds from here."}
            </Text>

            <PaperCard style={styles.savedCard}>
              <Text style={styles.savedCardText}>{text.trim()}</Text>
            </PaperCard>
          </View>

          <View>
            {/* "Start tracking" used to land on the Feed — saving your first
                entry sent you away from the thing you'd just been set up to
                do. Both ways out of this step now end on the tracker. */}
            <PressableScale
              style={styles.primaryButton}
              onPress={() => finish("/(tabs)" as Href)}
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
            <Text style={styles.title}>One line about today</Text>
            <Text style={styles.subtitle}>
              A highlight, a thought, anything. It&apos;s encrypted before it
              leaves your phone — and it&apos;s optional.
            </Text>

            <View style={styles.inputBox}>
              <TextInput
                style={styles.textInput}
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  setSaveError(null);
                }}
                placeholder="What's on your mind today?"
                placeholderTextColor={Colors.textSecondary}
                maxLength={MAX_HIGHLIGHT_LENGTH}
                multiline
                textAlignVertical="top"
              />
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
              onPress={() => finish("/(tabs)" as Href)}
              disabled={saving}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Skip writing an entry for now"
              accessibilityState={{ disabled: saving }}
            >
              <Text style={[styles.skipText, saving && styles.disabled]}>
                Skip for now
              </Text>
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
  container: { flexGrow: 1, paddingHorizontal: 24 },
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
  inputBox: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
    marginBottom: 20,
  },
  textInput: {
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 28,
    flex: 1,
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
    marginBottom: 8,
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
