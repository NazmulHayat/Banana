import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts, Scrim } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { keyring } from "@/lib/crypto";
import { useDataStore } from "@/lib/data-store";
import { useOnboarding } from "@/lib/onboarding-context";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
} from "@/lib/onboarding-draft";
import { persistOnboardingDraft } from "@/lib/onboarding-persist";
import { supabase } from "@/lib/supabase";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
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

export default function SigninScreen() {
  const insets = useSafeAreaInsets();
  const { markKeyringReady, session } = useAuth();
  const dataStore = useDataStore();
  const {
    completeOnboarding,
    hasCompletedOnboardingFor,
    holdForAccountCheck,
    releaseAccountCheck,
  } = useOnboarding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Set when sign-in worked but the encryption wrap didn't open — the id we're
  // repairing the keyring for.
  const [repairUserId, setRepairUserId] = useState<string | null>(null);
  const [previousPassword, setPreviousPassword] = useState("");
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  // Signed in and unlocked; waiting on the "does this account already have
  // data?" check below before we route anywhere.
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  // The check runs once per sign-in, whatever the effect's deps do.
  const checkStartedRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Never leave the routing gate held by a screen that's gone.
      releaseAccountCheck();
    };
  }, [releaseAccountCheck]);

  // An account that already has habits or entries has been through onboarding
  // before — just not on this device. Sending it back through "pick your
  // habits" and "write your first entry" asks for things it already has and
  // creates a SECOND entry for today, so mark onboarding done and go straight
  // in. The routing gate stays held until this lands, so nothing bounces the
  // user to the welcome screen while we're still asking.
  useEffect(() => {
    const userId = pendingUserId;
    if (!userId) return;
    // The store reads for the session it was rendered with, so wait for the
    // new session to reach it before asking.
    if (session?.user.id !== userId) return;
    if (checkStartedRef.current === userId) return;
    checkStartedRef.current = userId;

    void (async () => {
      let hasContent = false;
      try {
        const habits = await dataStore.refreshHabits();
        hasContent = habits.length > 0;
        if (!hasContent) {
          const now = new Date();
          const entries = await dataStore.refreshEntries(
            now.getFullYear(),
            now.getMonth() + 1,
          );
          hasContent = entries.length > 0;
        }
      } catch (e) {
        // Offline or unreadable: treat as a new account. Onboarding is
        // skippable, so the cost is a few taps, never data.
        if (__DEV__) console.warn("[signin] account check failed:", e);
      }

      if (hasContent) await completeOnboarding(userId);
      const done = hasContent || (await hasCompletedOnboardingFor(userId));

      if (!mountedRef.current) return;
      setPendingUserId(null);
      releaseAccountCheck();

      // A guest can write a first entry BEFORE tapping Sign in. For an
      // account that skips onboarding, that draft would die silently here —
      // so offer it. The not-done path needs no offer: the flow they're being
      // sent into restores the draft on its own.
      if (done) {
        const draft = await loadOnboardingDraft();
        const drafted = draft.highlight.trim();
        if (drafted) {
          Alert.alert(
            "Save what you wrote?",
            "You wrote an entry before signing in. Add it to today's journal?",
            [
              {
                text: "Discard",
                style: "destructive",
                onPress: () => {
                  void clearOnboardingDraft();
                  router.replace("/(tabs)");
                },
              },
              {
                text: "Save it",
                isPreferred: true,
                onPress: () => {
                  void (async () => {
                    const result = await persistOnboardingDraft(dataStore);
                    // `queued` still clears — the write is durable. Only a
                    // hard failure keeps the draft for another try.
                    if (result.ok) await clearOnboardingDraft();
                    router.replace("/(tabs)");
                  })();
                },
              },
            ],
          );
          return;
        }
      }

      router.replace(done ? "/(tabs)" : ("/onboarding/welcome" as Href));
    })();
  }, [
    pendingUserId,
    session,
    dataStore,
    completeOnboarding,
    hasCompletedOnboardingFor,
    releaseAccountCheck,
  ]);

  // Signing in, or checking the account right after — either way the form is
  // working and must not accept a second tap.
  const busy = loading || pendingUserId !== null;

  const validateEmail = (e: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSignin = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      Alert.alert("Required", "Please enter your email.");
      return;
    }
    if (!validateEmail(cleanEmail)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    if (!password) {
      Alert.alert("Required", "Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          Alert.alert(
            "Incorrect credentials",
            "Email or password is incorrect.",
          );
        } else if (error.message.includes("Email not confirmed")) {
          const { error: otpError } = await supabase.auth.resend({
            type: "signup",
            email: cleanEmail,
          });
          if (otpError) {
            if (__DEV__) console.warn("[signin] resend failed:", otpError.message);
            Alert.alert(
              "Couldn't send your code",
              "We couldn't email you a new verification code. Try again in a moment.",
            );
          } else {
            router.push({
              pathname: "/auth/verify",
              params: { email: cleanEmail, isNewUser: "false" },
            });
          }
        } else {
          if (__DEV__) console.warn("[signin] sign-in failed:", error.message);
          Alert.alert(
            "Couldn't sign you in",
            "Something went wrong on our side. Check your connection and try again.",
          );
        }
        setLoading(false);
        return;
      }

      if (!data.session) {
        Alert.alert("Error", "No session created. Please try again.");
        setLoading(false);
        return;
      }

      // Unlock encryption keyring with the same password
      try {
        await keyring.unlock(data.session.user.id, password);
        markKeyringReady(true);
      } catch {
        // Supabase accepted the password but the wrapped key didn't open with
        // it. Two ways to get here, and both are recoverable without support:
        //   1. An email password reset — Supabase knows the new password, the
        //      wrap is still keyed to the old one.
        //   2. A password change that died between the Supabase update and the
        //      keyring re-wrap.
        // Either way the previous password still opens the wrap, so offer to
        // finish the job here instead of stranding them at the sign-in screen.
        setRepairUserId(data.session.user.id);
        setLoading(false);
        return;
      }

      // Routing happens in the effect above, once we know whether this account
      // is new to the app or only new to this phone. If that never resolves,
      // the hold expires by itself and the usual routing gate takes over —
      // nothing here can strand the user on this screen.
      holdForAccountCheck();
      setPendingUserId(data.session.user.id);
    } catch (e) {
      if (__DEV__) console.warn("[signin] unexpected error:", e);
      Alert.alert(
        "Something went wrong",
        "We couldn't sign you in just now. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Finish an interrupted password change: unwrap with the password the wrap
  // still knows, then re-wrap to the password Supabase now accepts.
  const handleRepair = async () => {
    if (!repairUserId || repairing) return;
    if (!previousPassword) {
      setRepairError("Enter the password you used before.");
      return;
    }
    setRepairing(true);
    setRepairError(null);
    try {
      await keyring.unlock(repairUserId, previousPassword);
    } catch {
      setRepairing(false);
      setRepairError(
        "That password doesn't unlock your journal either. Try another, or use your recovery key.",
      );
      return;
    }

    try {
      await keyring.setPassword(repairUserId, password);
    } catch {
      // The keyring is open for this session even though the re-wrap didn't
      // land — let them in, and they can retry from Security & recovery.
      if (__DEV__) console.warn("[signin] re-wrap after repair failed");
    }
    markKeyringReady(true);
    setRepairing(false);
    setPreviousPassword("");
    const repaired = repairUserId;
    setRepairUserId(null);
    // Same handover as a plain sign-in: check for existing data before the
    // router can decide this account needs onboarding.
    holdForAccountCheck();
    setPendingUserId(repaired);
  };

  // This screen can be the first thing in the stack (deep link, or a replace
  // from signup), so "Back" needs somewhere to land when there's no history.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/auth/login");
  };

  const handleAbandonRepair = async () => {
    setRepairUserId(null);
    setPreviousPassword("");
    setRepairError(null);
    await supabase.auth.signOut();
  };

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to unlock your encrypted journal
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
                accessibilityState={{ selected: showPassword }}
              >
                <IconSymbol
                  name={showPassword ? "eye.slash" : "eye"}
                  size={20}
                  color={Colors.textSecondary}
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={handleSignin}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.buttonText}>
                {pendingUserId
                  ? "Opening your journal..."
                  : loading
                    ? "Signing in..."
                    : "Sign In"}
              </Text>
            </TouchableOpacity>

            {/* Sign-in worked, the journal didn't open. Finish the handover
                here rather than sending them away. */}
            {repairUserId ? (
              <View style={styles.repairPanel}>
                <Text style={styles.repairTitle}>
                  One last thing to unlock your journal
                </Text>
                <Text style={styles.repairBody}>
                  Your sign-in worked, but your journal is still locked with the
                  password you used before. Enter it once and we&apos;ll finish
                  moving it over.
                </Text>
                <TextInput
                  style={styles.input}
                  value={previousPassword}
                  onChangeText={(t) => {
                    setPreviousPassword(t);
                    setRepairError(null);
                  }}
                  placeholder="Previous password"
                  placeholderTextColor={Colors.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {repairError ? (
                  <Text style={styles.repairError}>{repairError}</Text>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.button,
                    (repairing || !previousPassword) && styles.buttonDisabled,
                  ]}
                  onPress={handleRepair}
                  disabled={repairing || !previousPassword}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock my journal"
                  accessibilityState={{
                    disabled: repairing || !previousPassword,
                  }}
                >
                  <Text style={styles.buttonText}>
                    {repairing ? "Unlocking..." : "Unlock my journal"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.forgotButton}
                  onPress={() => router.push("/auth/recover-with-key")}
                  disabled={repairing}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Use my recovery key instead"
                  accessibilityState={{ disabled: repairing }}
                >
                  <Text style={[styles.forgotText, repairing && styles.dim]}>
                    Use my recovery key instead
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.forgotButton}
                  onPress={handleAbandonRepair}
                  disabled={repairing}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  accessibilityState={{ disabled: repairing }}
                >
                  <Text style={[styles.repairCancel, repairing && styles.dim]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.forgotButton}
              onPress={() => router.push("/auth/forgot-password")}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don&apos;t have an account? </Text>
            <TouchableOpacity
              onPress={() => router.replace("/auth/signup")}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Create account"
            >
              <Text style={styles.signupLink}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  backButton: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 24,
  },
  form: { width: "100%", maxWidth: 400 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  input: {
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
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    backgroundColor: Colors.card,
    marginBottom: 8,
  },
  passwordInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
  },
  eyeButton: { padding: 12 },
  button: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  /** Disabled text links — dead-looking only when they really are dead. */
  dim: { opacity: 0.4 },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  forgotButton: { alignSelf: "center", marginTop: 16 },
  forgotText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
  repairPanel: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.shadow,
    backgroundColor: Scrim.accent,
  },
  repairTitle: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 8,
  },
  repairBody: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 16,
  },
  repairError: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  repairCancel: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signupContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 32,
  },
  signupText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signupLink: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
});
