// Onboarding draft — the starter habits and first highlight the user has typed
// but not yet saved (D19).
//
// Onboarding can be interrupted: the app gets backgrounded mid-signup, or a
// save fails while offline. Neither may cost the user their choices, so the
// in-progress selection is mirrored to AsyncStorage the same way the month
// caches are: an in-memory copy is the source of truth, disk is the backup.
//
// This is local-only scratch data (a habit name, a sentence) that never leaves
// the device un-encrypted — it is cleared the moment onboarding completes.

import AsyncStorage from "@react-native-async-storage/async-storage";

// New protocol string, new suffix — existing `banana_*` keys are never renamed.
const STORAGE_KEY = "banana_onboarding_draft_v1";

/** The one survey answer, step 2. Copy downstream adapts to it. */
export type PriorExperience = "never" | "fell_off" | "doing_it";

/** The mood tap that seeds the first entry, step 3. */
export type MoodId = "rough" | "flat" | "good" | "great";

export interface OnboardingDraft {
  /** Starter habit names picked on step 1. */
  habits: string[];
  /** First highlight typed on step 3. */
  highlight: string;
  /** Survey answer from step 2, null until tapped. */
  priorExperience: PriorExperience | null;
  /** Mood tapped on step 3, null until tapped. */
  mood: MoodId | null;
}

const EMPTY: OnboardingDraft = {
  habits: [],
  highlight: "",
  priorExperience: null,
  mood: null,
};

let cached: OnboardingDraft | null = null;

/** Read the draft — memory first, then disk. Never throws. */
export async function loadOnboardingDraft(): Promise<OnboardingDraft> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
      cached = {
        habits: Array.isArray(parsed.habits)
          ? parsed.habits.filter((h): h is string => typeof h === "string")
          : [],
        highlight: typeof parsed.highlight === "string" ? parsed.highlight : "",
        priorExperience:
          parsed.priorExperience === "never" ||
          parsed.priorExperience === "fell_off" ||
          parsed.priorExperience === "doing_it"
            ? parsed.priorExperience
            : null,
        mood:
          parsed.mood === "rough" ||
          parsed.mood === "flat" ||
          parsed.mood === "good" ||
          parsed.mood === "great"
            ? parsed.mood
            : null,
      };
      return cached;
    }
  } catch (e) {
    if (__DEV__) console.warn("[onboarding] draft read failed:", e);
  }
  cached = { ...EMPTY };
  return cached;
}

/**
 * Merge a patch into the draft. Synchronous for the caller (the memory copy is
 * updated immediately); the disk write is fire-and-forget.
 */
export function saveOnboardingDraft(patch: Partial<OnboardingDraft>): void {
  cached = { ...(cached ?? EMPTY), ...patch };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
}

/** Drop the draft once onboarding is finished (or explicitly skipped). */
export async function clearOnboardingDraft(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}
