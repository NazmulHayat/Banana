import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts, Scrim } from "@/constants/theme";
import { signupTransient } from "@/lib/auth/signup-transient";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";
import { useState } from "react";
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
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const validateEmail = (e: string): boolean =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const validateUsername = (value: string): string | null => {
    const clean = value.toLowerCase().trim();
    if (clean.length < 3) return "At least 3 characters";
    if (clean.length > 20) return "Max 20 characters";
    if (!/^[a-z0-9_]+$/.test(clean))
      return "Only letters, numbers, underscores";
    return null;
  };

  const validatePassword = (pass: string): string | null => {
    if (pass.length < 8) return "At least 8 characters";
    if (!/[A-Z]/.test(pass)) return "Include an uppercase letter";
    if (!/[a-z]/.test(pass)) return "Include a lowercase letter";
    if (!/[0-9]/.test(pass)) return "Include a number";
    return null;
  };

  const checkUsernameAvailability = async (value: string) => {
    const clean = value.toLowerCase().trim();
    const validationError = validateUsername(clean);
    if (validationError) {
      setUsernameError(validationError);
      setUsernameAvailable(false);
      return;
    }

    setCheckingUsername(true);
    setUsernameError("");

    try {
      const { data, error } = await supabase.rpc("username_available", {
        check_username: clean,
      });

      if (error) {
        // Best effort — let signup attempt handle the real check
        setUsernameError("");
        setUsernameAvailable(true);
        return;
      }
      if (data === false) {
        setUsernameError("Username taken");
        setUsernameAvailable(false);
      } else {
        setUsernameError("");
        setUsernameAvailable(true);
      }
    } finally {
      setCheckingUsername(false);
    }
  };

  const handleSignup = async () => {
    if (!username.trim()) {
      setUsernameError("Username is required");
      return;
    }
    const usernameValidation = validateUsername(username);
    if (usernameValidation) {
      setUsernameError(usernameValidation);
      return;
    }
    if (!usernameAvailable) {
      Alert.alert(
        "Username unavailable",
        "Please choose a different username.",
      );
      return;
    }
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
      const cleanUsername = username.toLowerCase().trim();

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { username: cleanUsername } },
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

      // Stash password so verify screen can derive the encryption keyring
      signupTransient.set({
        email: cleanEmail,
        username: cleanUsername,
        password,
      });

      if (data.session) {
        // Email confirmation disabled — go straight to keyring setup
        router.replace({
          pathname: "/auth/recovery-setup",
          params: { source: "signup" },
        });
      } else {
        router.push({
          pathname: "/auth/verify",
          params: {
            email: cleanEmail,
            username: cleanUsername,
            isNewUser: "true",
          },
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
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Join Aight Bet and start journaling privately
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.usernameContainer}>
              <Text style={styles.prefix}>@</Text>
              <TextInput
                style={styles.usernameInput}
                value={username}
                onChangeText={(text) => {
                  const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
                  setUsername(clean);
                  setUsernameAvailable(false);
                  setUsernameError("");
                }}
                onBlur={() => {
                  if (username.length >= 3) checkUsernameAvailability(username);
                }}
                placeholder="yourname"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              {checkingUsername && <Text style={styles.checking}>...</Text>}
              {usernameAvailable && !checkingUsername && (
                <IconSymbol
                  name="checkmark.circle.fill"
                  size={20}
                  color={Colors.success}
                />
              )}
            </View>
            {usernameError ? (
              <Text style={styles.error}>{usernameError}</Text>
            ) : (
              <Text style={styles.hint}>
                3-20 characters: letters, numbers, underscores
              </Text>
            )}

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
                onChangeText={(t) => {
                  setPassword(t);
                  setPasswordError("");
                }}
                placeholder="Create a password"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
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
            <Text style={styles.hint}>
              Min 8 chars, uppercase, lowercase, number
            </Text>

            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setPasswordError("");
              }}
              placeholder="Confirm your password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {passwordError ? (
              <Text style={styles.error}>{passwordError}</Text>
            ) : null}

            <View style={styles.privacyCallout}>
              <IconSymbol name="lock.fill" size={16} color={Colors.ink} />
              <Text style={styles.privacyText}>
                Your password encrypts your data.{" "}
                <Text style={styles.privacyBold}>
                  If you forget it, only your recovery key can restore access.
                </Text>{" "}
                We&apos;ll show it to you next.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={loading || checkingUsername}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>
                {loading ? "Creating account..." : "Create Account"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace("/auth/signin")}>
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
  usernameContainer: {
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
  prefix: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    paddingLeft: 16,
  },
  usernameInput: {
    flex: 1,
    height: "100%",
    paddingHorizontal: 4,
    paddingRight: 12,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
  },
  checking: { fontSize: 14, color: Colors.textSecondary, paddingRight: 12 },
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
  privacyCallout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Scrim.accent,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  privacyText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  privacyBold: { fontWeight: "700" },
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
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
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
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
});
