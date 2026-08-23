// Create the account — email and password, nothing else.
//
// This screen sits at the END of onboarding now, not the front: by the time
// someone lands here they have usually picked habits, answered the survey tap
// and written a first line, all riding in the local draft. The copy leans on
// that ("your first entry is written") because it is the honest reason to make
// an account: sealing what they just made.
//
// No username field. Usernames are optional and claimed later from Profile →
// Edit; the accounts row is created without one during setup. The password is
// not just a login credential here — it derives the key that wraps the master
// key (see lib/crypto/keyring.ts), which is why it has real rules.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { signupTransient } from "@/lib/auth/signup-transient";
import { loadOnboardingDraft } from "@/lib/onboarding-draft";
import { supabase } from "@/lib/supabase";
import { Href, router } from "expo-router";
import { useEffect, useState } from "react";
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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Whether a first entry is waiting in the draft — it changes the pitch.
  const [hasDraftEntry, setHasDraftEntry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadOnboardingDraft().then((draft) => {
      if (cancelled) return;
      setHasDraftEntry(draft.highlight.trim().length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const validateEmail = (e: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const validatePassword = (pass: string): string | null => {
    if (pass.length < 8) return "At least 8 characters";
    if (!/[A-Z]/.test(pass)) return "Include an uppercase letter";
    if (!/[a-z]/.test(pass)) return "Include a lowercase letter";
    if (!/[0-9]/.test(pass)) return "Include a number";
    return null;
  };

  const handleSignup = async () => {
    if (!email.trim() || !validateEmail(email)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    const passwordValidation = validatePassword(password);
    if (passwordValidation) {
      setPasswordError(passwordValidation);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setLoading(true);
    setPasswordError("");

    try {
      const cleanEmail = email.trim().toLowerCase();

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (error) {
        if (error.message.toLowerCase().includes("already registered")) {
          Alert.alert(
            "Email in use",
            "This email is already registered. Try signing in instead.",
          );
        } else {
          if (__DEV__) console.warn("[signup] signUp failed:", error.message);
          Alert.alert(
            "Couldn't create your account",
            "Something went wrong on our side. Check your connection and try again.",
          );
        }
        setLoading(false);
        return;
      }

      // Stash password so setup can derive the encryption keyring
      signupTransient.set({ email: cleanEmail, password });

      if (data.session) {
        // Email confirmation disabled — go straight to keyring setup
        router.replace({
          pathname: "/auth/recovery-setup",
          params: { source: "signup" },
        });
      } else {
        router.push({
          pathname: "/auth/verify",
          params: { email: cleanEmail, isNewUser: "true" },
        });
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              // Can be the first screen in the stack (replace from sign-in).
              if (router.canGoBack()) router.back();
              else router.replace("/onboarding/welcome" as Href);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name="chevron.left" size={22} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create your private journal</Text>
          <Text style={styles.subtitle}>
            {hasDraftEntry
              ? "Your first entry is written. An account seals it so only you can ever read it."
              : "Takes about a minute. Private by default."}
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setPasswordError("");
                }}
                placeholder="Create a password"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
              >
                <Text style={styles.eyeText}>
                  {showPassword ? "Hide" : "Show"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>8+ characters, upper, lower, number</Text>

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={(v) => {
                setConfirmPassword(v);
                setPasswordError("");
              }}
              placeholder="Confirm your password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
            />
            {passwordError ? (
              <Text style={styles.error}>{passwordError}</Text>
            ) : null}

            <Text style={styles.privacyNote}>
              Your password also locks your encryption. We never see it and we
              can&apos;t reset it for you, so you&apos;ll get a recovery key
              next.
            </Text>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Create journal"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              <Text style={styles.buttonText}>
                {loading ? "Creating..." : "Create journal"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity
              onPress={() => router.replace("/auth/signin")}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Sign in"
            >
              <Text style={styles.signinLink}>Sign In</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
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
  form: { width: "100%", maxWidth: 400 },
  label: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 8,
    marginTop: 8,
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
    marginBottom: 4,
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
    marginBottom: 4,
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
  eyeText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
  },
  error: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  privacyNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
    marginTop: 12,
  },
  button: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontSize: 16,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  signinContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  signinText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signinLink: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textDecorationLine: "underline",
  },
});
