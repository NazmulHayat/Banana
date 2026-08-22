// Runs immediately after signup (or post-verify). Creates the accounts row,
// sets up the encryption keyring, explains the recovery key BEFORE showing it,
// and reveals it once behind a saved-it checkbox.
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
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
  /** What a recovery key is, said before we show one. */
  | "primer"
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

  // Username: from the signup form if we still have it, else the copy Supabase
  // kept in user metadata when the account was created.
  const metaUsername = session.user.user_metadata?.username;
  const username =
    pending?.username ??
    (typeof metaUsername === "string" ? metaUsername : null);
  if (!username) {
    return {
      status: "error",
      message: "Sign in again so we can finish setting up your account.",
    };
  }

  // Idempotent by design — a retry re-upserts the same row.
  const { error: accountErr } = await supabase
    .from("accounts")
    .upsert({ id: userId, username }, { onConflict: "id" });
  if (accountErr) {
    if (accountErr.code === "23505") {
      return {
        status: "error",
        message:
          "Someone took this username while you were signing up. Sign in again and pick another.",
      };
    }
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
  const [phase, setPhase] = useState<Phase>("setting-up");
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
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
      setRecoveryKey(outcome.recoveryKey);
      // Explain first; the key itself is one tap away.
      setPhase("primer");
      return;
    }
    if (outcome.status === "need-password") {
      setPhase("need-password");
      return;
    }
    setErrorMsg(outcome.message);
    setPhase("error");
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

  function handleContinue() {
    if (!confirmed) {
      Alert.alert(
        "Confirm you saved it",
        "Tap the checkbox to confirm you've written down or saved your recovery key.",
      );
      return;
    }
    finish();
  }

  function finish() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/onboarding/welcome" as Href);
  }

  if (phase === "setting-up") {
    return (
      <PaperBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="small" color={Colors.ink} />
          <Text style={styles.loadingText}>Setting up your encryption...</Text>
          <Text style={styles.loadingSub}>
            This takes a couple of seconds.
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
            onPress={() => router.replace("/onboarding/welcome" as Href)}
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

  // What the key is, and what happens if it's lost — said while there is still
  // nothing secret on screen, so the user can go and open their password
  // manager before the one-time reveal.
  if (phase === "primer") {
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
          <Text style={styles.title}>Next: your recovery key</Text>
          <Text style={styles.subtitle}>
            Your journal is encrypted with your password, and we never hold a
            copy of it. The recovery key is the spare.
          </Text>

          <View style={styles.tips}>
            <Text style={styles.tipsItem}>
              • It unlocks your journal if you ever forget your password.
            </Text>
            <Text style={styles.tipsItem}>
              • We show it once, on the next screen. We can&apos;t show it again
              or email it to you.
            </Text>
            <Text style={styles.tipsItem}>
              • Lose your password and this key, and no one, including us, can
              read your entries.
            </Text>
          </View>

          <Text style={styles.primerHint}>
            Have your password manager, notes app or a pen ready.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => setPhase("reveal")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Show my recovery key"
          >
            <Text style={styles.primaryButtonText}>Show my recovery key</Text>
          </TouchableOpacity>
        </ScrollView>
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
        <Text style={styles.title}>Save your recovery key</Text>
        <Text style={styles.subtitle}>
          This is the only way back into your encrypted journal if you forget
          your password, and this is the only time we can show it.
        </Text>

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
          <Text style={styles.tipsTitle}>Where to save it:</Text>
          <Text style={styles.tipsItem}>• A password manager (best)</Text>
          <Text style={styles.tipsItem}>• A note in iCloud / Google Drive</Text>
          <Text style={styles.tipsItem}>• Written on paper, somewhere safe</Text>
        </View>

        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setConfirmed(!confirmed)}
          activeOpacity={0.85}
          accessibilityRole="checkbox"
          accessibilityLabel="I've saved my recovery key in a safe place"
          accessibilityState={{ checked: confirmed }}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxOn]}>
            {confirmed && (
              <IconSymbol name="checkmark" size={14} color={Colors.paper} />
            )}
          </View>
          <Text style={styles.checkboxLabel}>
            I&apos;ve saved my recovery key in a safe place
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, !confirmed && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={!confirmed}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !confirmed }}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
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
  primerHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
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
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.card,
  },
  checkboxOn: { backgroundColor: Colors.ink },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
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
