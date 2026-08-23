// Runs immediately after signup (or post-verify). Creates the accounts row
// (no username — that's claimed later in Profile), sets up the encryption
// keyring, saves everything the guest onboarding drafted (habit picks, the
// first entry), then reveals the recovery key once with a screenshot-it
// instruction. Continue lands in the app proper.
//
// Setup is resumable. It used to `consume()` the signup password before doing
// any network work, so a dropped connection burned the only copy of it and
// left the account with no keyring and no way to make one. Now the password is
// only peeked at, every step is idempotent (the accounts upsert, and
// `keyring.setupNewUser`, which resumes an existing keyring rather than
// replacing it), the password is cleared only after success, and a failure
// offers a real retry. If the password is gone we ask for it again instead of
// guessing.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts, Scrim } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { signupTransient } from "@/lib/auth/signup-transient";
import { keyring } from "@/lib/crypto";
import { useDataStore } from "@/lib/data-store";
import { useOnboarding } from "@/lib/onboarding-context";
import { clearOnboardingDraft } from "@/lib/onboarding-draft";
import { persistOnboardingDraft } from "@/lib/onboarding-persist";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Phase =
  | "setting-up"
  | "reveal"
  | "need-password"
  | "error";

/** How long the "Copied!" confirmation stays up. */
const COPIED_FEEDBACK_MS = 1800;

const GENERIC_FAILURE =
  "We couldn't finish setting up your encryption. Check your connection and try again. Nothing was lost.";

type SetupOutcome =
  | { status: "done"; recoveryKey: string | null; resumed: boolean }
  /** The signup password is gone (timed out or app relaunched) — ask again. */
  | { status: "need-password" }
  | { status: "error"; message: string };

/**
 * The whole setup, outside the component so the mount effect has no function
 * deps and the retry buttons can call exactly the same path.
 *
 * `typedPassword` is supplied only on the re-prompt path; otherwise the
 * in-memory signup password is used (peeked, never consumed until we succeed).
 */
async function runAccountSetup(typedPassword?: string): Promise<SetupOutcome> {
  const pending = signupTransient.peek();
  const password = typedPassword ?? pending?.password;
  if (!password) return { status: "need-password" };

  let session;
  try {
    const result = await supabase.auth.getSession();
    session = result.data.session;
  } catch {
    return { status: "error", message: GENERIC_FAILURE };
  }
  if (!session) {
    return {
      status: "error",
      message: "You're signed out. Sign in again to finish setting up.",
    };
  }
  const userId = session.user.id;

  // The accounts row ships without a username — it's optional now, claimed
  // later from Profile -> Edit. Idempotent by design: a retry re-upserts the
  // same row, and the upsert never overwrites a username that already exists
  // (the row's other columns are untouched on conflict).
  const { error: accountErr } = await supabase
    .from("accounts")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (accountErr) {
    if (__DEV__) console.warn("[setup] accounts upsert failed:", accountErr.message);
    return { status: "error", message: GENERIC_FAILURE };
  }

  try {
    const { recoveryKey, resumed } = await keyring.setupNewUser(
      userId,
      password,
    );
    // Only now is the password safe to drop.
    signupTransient.clear();
    return { status: "done", recoveryKey, resumed };
  } catch (e) {
    // keyring messages are already user-safe copy.
    return {
      status: "error",
      message: e instanceof Error ? e.message : GENERIC_FAILURE,
    };
  }
}

export default function RecoverySetupScreen() {
  const insets = useSafeAreaInsets();
  const { markKeyringReady } = useAuth();
  const { completeOnboarding } = useOnboarding();
  const dataStore = useDataStore();
  const [phase, setPhase] = useState<Phase>("setting-up");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [copied, setCopied] = useState(false);
  // Whether the drafted first entry made it in — the reveal screen says so.
  const [entrySaved, setEntrySaved] = useState(false);
  const [entryQueued, setEntryQueued] = useState(false);
  const [typedPassword, setTypedPassword] = useState("");
  // Blocks a second run while one is in flight (double-tapped retry).
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Applies an outcome. `alive` is the caller's unmount guard.
  function apply(outcome: SetupOutcome, alive: () => boolean) {
    if (!alive() || !mountedRef.current) return;
    if (outcome.status === "done") {
      markKeyringReady(true);
      void finalize(outcome.recoveryKey, alive);
      return;
    }
    if (outcome.status === "need-password") {
      setPhase("need-password");
      return;
    }
    setErrorMsg(outcome.message);
    setPhase("error");
  }

  /**
   * The keyring is up — now everything the guest flow drafted gets written for
   * real: habit picks and the first entry, encrypted, through the store. Then
   * onboarding is marked done (so a kill on the reveal screen reopens into the
   * app, where the key stays viewable under Security), and the reveal shows.
   *
   * A persist failure is near-impossible here (network trouble queues rather
   * than fails), but if it happens the draft is deliberately NOT cleared, the
   * words survive on the device, and setup still completes — the recovery key
   * matters more than re-running a write that will not improve.
   */
  async function finalize(key: string | null, alive: () => boolean) {
    const result = await persistOnboardingDraft(dataStore);
    if (result.ok) {
      await clearOnboardingDraft();
    } else if (__DEV__) {
      console.warn("[setup] draft persist failed:", result.reason);
    }
    await completeOnboarding();
    if (!alive() || !mountedRef.current) return;
    setEntrySaved(result.entrySaved);
    setEntryQueued(result.queued);
    setRecoveryKey(key);
    setPhase("reveal");
  }

  useEffect(() => {
    let mounted = true;
    runningRef.current = true;
    void runAccountSetup()
      .then((outcome) => apply(outcome, () => mounted))
      .finally(() => {
        runningRef.current = false;
      });
    return () => {
      mounted = false;
    };
    // Runs once on mount; `apply` only touches state setters, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any pending "Copied!" reset dies with the screen.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function retrySetup(password?: string) {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("setting-up");
    try {
      const outcome = await runAccountSetup(password);
      apply(outcome, () => true);
    } finally {
      runningRef.current = false;
    }
  }

  async function handleCopy() {
    if (!recoveryKey) return;
    await Clipboard.setStringAsync(recoveryKey);
    // The one moment in the app where "did that work?" really matters.
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }

  function finish() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/(tabs)" as Href);
  }

  if (phase === "setting-up") {
    return (
      <PaperBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="small" color={Colors.ink} />
          <Text style={styles.loadingText}>Sealing your journal...</Text>
          <Text style={styles.loadingSub}>
            Setting up your encryption. A couple of seconds.
          </Text>
        </View>
      </PaperBackground>
    );
  }

  // The password never reached us (or timed out). Ask for it rather than
  // making one up — it is the only thing that can wrap the master key.
  if (phase === "need-password") {
    return (
      <PaperBackground>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.iconCircle}>
            <IconSymbol name="lock.fill" size={32} color={Colors.paper} />
          </View>
          <Text style={styles.title}>One more step</Text>
          <Text style={styles.subtitle}>
            Enter the password you just chose so we can finish encrypting your
            journal. It never leaves this device.
          </Text>

          <TextInput
            style={styles.passwordInput}
            value={typedPassword}
            onChangeText={setTypedPassword}
            placeholder="Your password"
            placeholderTextColor={Colors.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TouchableOpacity
            style={[
              styles.primaryButton,
              !typedPassword && styles.buttonDisabled,
            ]}
            onPress={() => retrySetup(typedPassword)}
            disabled={!typedPassword}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>Finish setup</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={async () => {
              await supabase.auth.signOut();
              router.replace("/auth/login");
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>Back to sign in</Text>
          </TouchableOpacity>
        </ScrollView>
      </PaperBackground>
    );
  }

  if (phase === "error") {
    return (
      <PaperBackground>
        <View style={[styles.errorContainer, { paddingTop: insets.top + 32 }]}>
          <IconSymbol
            name="exclamationmark.triangle.fill"
            size={48}
            color={Colors.ink}
          />
          <Text style={styles.errorTitle}>Setup couldn&apos;t complete</Text>
          <Text style={styles.errorMsg}>{errorMsg}</Text>
          {/* This screen is a `replace` target, so there is no back — say what
              each way out actually does. Retry is safe: every step above is
              idempotent and your password is still here. */}
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => retrySetup()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={async () => {
              await supabase.auth.signOut();
              router.replace("/auth/login");
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Sign out and finish this later"
          >
            <Text style={styles.secondaryButtonText}>
              Sign out and finish this later
            </Text>
          </TouchableOpacity>
          <Text style={styles.errorFootnote}>
            Your account is already created. Signing in again brings you back
            here to finish.
          </Text>
        </View>
      </PaperBackground>
    );
  }

  // Resumed a keyring whose one-time display copy can't be read back. Don't
  // mint a new recovery key here — that would silently void the one they may
  // already have saved.
  if (recoveryKey === null) {
    return (
      <PaperBackground>
        <View style={[styles.errorContainer, { paddingTop: insets.top + 32 }]}>
          <View style={styles.iconCircle}>
            <IconSymbol name="key.fill" size={32} color={Colors.paper} />
          </View>
          <Text style={styles.errorTitle}>You&apos;re already encrypted</Text>
          <Text style={styles.errorMsg}>
            This account already had its encryption set up, so we didn&apos;t
            make a new recovery key. You can view yours any time in Profile →
            Security &amp; recovery.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={finish}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue"
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </PaperBackground>
    );
  }

  return (
    <PaperBackground>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={styles.iconCircle}>
          <IconSymbol name="key.fill" size={32} color={Colors.paper} />
        </View>
        <Text style={styles.title}>One last thing. Your recovery key</Text>
        <Text style={styles.subtitle}>
          If you ever forget your password, this key is the only way back into
          your journal. Take a screenshot now, or copy it somewhere safe.
        </Text>

        {entrySaved && (
          <View style={styles.entrySavedRow}>
            <IconSymbol
              name="checkmark.circle.fill"
              size={18}
              color={Colors.success}
            />
            <Text style={styles.entrySavedText}>
              {entryQueued
                ? "Your first entry is safe on this device. It syncs when you're back online."
                : "Your first entry is encrypted and saved."}
            </Text>
          </View>
        )}

        <View style={styles.keyBox}>
          <Text style={styles.keyText} selectable>
            {recoveryKey}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.copyButton}
          onPress={handleCopy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={
            copied ? "Recovery key copied" : "Copy recovery key to clipboard"
          }
        >
          <IconSymbol
            name={copied ? "checkmark" : "doc.on.doc"}
            size={16}
            color={Colors.ink}
          />
          <Text style={styles.copyText}>
            {copied ? "Copied!" : "Copy to clipboard"}
          </Text>
        </TouchableOpacity>

        <View style={styles.tips}>
          <Text style={styles.tipsTitle}>Anywhere safe works:</Text>
          <Text style={styles.tipsItem}>• A screenshot in your photos</Text>
          <Text style={styles.tipsItem}>• Your password manager</Text>
          <Text style={styles.tipsItem}>• A note, or paper in a drawer</Text>
        </View>

        <Text style={styles.revealFootnote}>
          You can see this key again any time in Profile, under Security.
        </Text>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={finish}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="I saved it, take me to my journal"
        >
          <Text style={styles.primaryButtonText}>I saved it</Text>
        </TouchableOpacity>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
    marginTop: 12,
  },
  loadingSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  errorContainer: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  errorMsg: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 20,
  },
  errorFootnote: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 18,
    maxWidth: 320,
  },
  entrySavedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Scrim.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  entrySavedText: {
    flex: 1,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    lineHeight: 20,
  },
  revealFootnote: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 20,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 360,
  },
  keyBox: {
    width: "100%",
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.ink,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  keyText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 1.5,
    lineHeight: 26,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 10,
    marginBottom: 24,
  },
  copyText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
  tips: {
    width: "100%",
    backgroundColor: Scrim.accent,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  tipsTitle: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "700",
    marginBottom: 6,
  },
  tipsItem: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
  },
  primaryButton: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  secondaryButton: {
    width: "100%",
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  passwordInput: {
    width: "100%",
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 16,
  },
});
