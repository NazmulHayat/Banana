// Onboarding completion — per user, never per device.
//
// This used to be one global `@onboarding_completed` flag with no user scoping
// and no reset on sign-out, so signing into a *different* account on the same
// phone skipped onboarding entirely and dropped that account on an empty
// tracker with no explanation. The flag is now keyed by the signed-in user id.
//
// New protocol string, new suffix — existing `banana_*` keys are never renamed.
// The old global flag is migrated to the first account that signs in after the
// upgrade (so today's users are not sent back through onboarding) and then
// consumed, so the next account on the device starts clean.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useAuth } from "./auth-context";

/** Per-user completion flag: `banana_onboarding_v1:<userId>`. */
const KEY_PREFIX = "banana_onboarding_v1:";
/** Pre-v1, device-wide flag. Read once per device, then migrated away. */
const LEGACY_GLOBAL_KEY = "@onboarding_completed";
/**
 * Ceiling on the routing hold below. A check that never reports back (screen
 * torn down mid-flight, network wedged) must not strand the app on a blank
 * frame, so the hold expires on its own.
 */
const ACCOUNT_CHECK_TIMEOUT_MS = 8000;

const keyFor = (userId: string): string => `${KEY_PREFIX}${userId}`;

/**
 * Read the flag for one account, migrating the pre-v1 global flag on the first
 * read after an upgrade. Never throws — a storage failure just means "not
 * onboarded yet", which costs a re-run of onboarding, not data.
 */
async function readCompleted(userId: string): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(keyFor(userId));
    if (value !== null) return value === "true";

    const legacy = await AsyncStorage.getItem(LEGACY_GLOBAL_KEY);
    if (legacy === "true") {
      await AsyncStorage.setItem(keyFor(userId), "true");
      // Consumed: the next account to sign in on this device gets its own
      // answer instead of inheriting this one.
      await AsyncStorage.removeItem(LEGACY_GLOBAL_KEY);
      return true;
    }
    return false;
  } catch (err) {
    if (__DEV__) console.warn("[onboarding] status read failed:", err);
    return false;
  }
}

interface OnboardingContextType {
  /** `null` = not resolved yet (or signed out). */
  hasCompletedOnboarding: boolean | null;
  /**
   * Mark onboarding done. `userId` is only passed during the sign-in handover,
   * before the new session has reached this provider.
   */
  completeOnboarding: (userId?: string) => Promise<void>;
  /** Replay onboarding for the signed-in account (Profile → dev tools). */
  resetOnboarding: () => Promise<void>;
  /** Read one account's flag without touching provider state. */
  hasCompletedOnboardingFor: (userId: string) => Promise<boolean>;
  /**
   * Pause the routing gate while the sign-in screen works out whether this
   * account already has data (an existing user on a new device must not be
   * re-onboarded). The gate keys off `loading`, so nothing routes until
   * `releaseAccountCheck` runs — or the hold times out.
   */
  holdForAccountCheck: () => void;
  releaseAccountCheck: () => void;
  loading: boolean;
}

const OnboardingContext = createContext<OnboardingContextType>({
  hasCompletedOnboarding: null,
  completeOnboarding: async () => {},
  resetOnboarding: async () => {},
  hasCompletedOnboardingFor: async () => false,
  holdForAccountCheck: () => {},
  releaseAccountCheck: () => {},
  loading: true,
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<
    boolean | null
  >(null);
  const [resolving, setResolving] = useState(true);
  const [holding, setHolding] = useState(false);

  // Re-resolve whenever the signed-in account changes. Signing out clears the
  // answer rather than leaving the previous user's behind.
  useEffect(() => {
    if (!userId) {
      setHasCompletedOnboarding(null);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    void readCompleted(userId).then((done) => {
      if (cancelled) return;
      setHasCompletedOnboarding(done);
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // The hold's safety net. One timer, cleared the moment the hold ends or the
  // provider unmounts — nothing ever fires against a dead tree.
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setHolding(false), ACCOUNT_CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [holding]);

  // These are `useCallback`ed for referential stability, not speed: the
  // sign-in screen lists them in effect deps, and a fresh identity on every
  // render would restart the account check mid-flight.
  const completeOnboarding = useCallback(
    async (forUserId?: string) => {
      const target = forUserId ?? userId;
      if (!target) {
        // No account to key it to (shouldn't happen) — don't block the user.
        if (__DEV__) console.warn("[onboarding] complete with no user id");
        setHasCompletedOnboarding(true);
        return;
      }
      try {
        await AsyncStorage.setItem(keyFor(target), "true");
      } catch (err) {
        if (__DEV__) console.warn("[onboarding] status write failed:", err);
      }
      setHasCompletedOnboarding(true);
    },
    [userId],
  );

  const resetOnboarding = useCallback(async () => {
    if (userId) {
      try {
        await AsyncStorage.removeItem(keyFor(userId));
      } catch (err) {
        if (__DEV__) console.warn("[onboarding] status reset failed:", err);
      }
    }
    setHasCompletedOnboarding(false);
  }, [userId]);

  const hasCompletedOnboardingFor = useCallback(
    (target: string) => readCompleted(target),
    [],
  );

  const holdForAccountCheck = useCallback(() => setHolding(true), []);
  const releaseAccountCheck = useCallback(() => setHolding(false), []);

  return (
    <OnboardingContext.Provider
      value={{
        hasCompletedOnboarding,
        completeOnboarding,
        resetOnboarding,
        hasCompletedOnboardingFor,
        holdForAccountCheck,
        releaseAccountCheck,
        loading: resolving || holding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export const useOnboarding = () => useContext(OnboardingContext);
