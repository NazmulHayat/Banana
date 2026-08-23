import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { signupTransient } from "@/lib/auth/signup-transient";
import { supabase } from "@/lib/supabase";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Let the screen transition settle before stealing focus. */
const FOCUS_DELAY_MS = 100;
/** Seconds before the code can be resent. */
const RESEND_COOLDOWN_S = 60;

export default function VerifyScreen() {
  const insets = useSafeAreaInsets();
  const { email, isNewUser } = useLocalSearchParams<{
    email: string;
    isNewUser: string;
  }>();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_S);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Focus after the screen transition settles — cleared on unmount so the
    // callback can never fire against a dead ref.
    const timer = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  /**
   * Six digits in the box (typed or pasted from the email) submit themselves —
   * nobody should have to type a code AND find a button.
   */
  const handleCodeChange = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && !loading) {
      void handleVerify(digits);
    }
  };

  const handleVerify = async (submitted?: string) => {
    const cleanCode = (submitted ?? code).trim();
    if (!cleanCode || cleanCode.length < 6) {
      Alert.alert(
        "Invalid code",
        "Please enter the verification code from your email.",
      );
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email!,
        token: cleanCode,
        type: "signup",
      });

      if (error) {
        if (__DEV__) console.warn("[verify] otp failed:", error.message);
        Alert.alert(
          "That code didn't work",
          "Double-check the code from your email, or send yourself a new one.",
        );
        setLoading(false);
        return;
      }
      if (!data.session) {
        Alert.alert("Error", "No session created. Please try again.");
        setLoading(false);
        return;
      }

      if (isNewUser === "true") {
        router.replace({
          pathname: "/auth/recovery-setup",
          params: { source: "signup" },
        });
      } else {
        // Re-verification for an existing user — they need to sign in
        // afresh so we can re-derive the keyring from their password.
        await supabase.auth.signOut();
        router.replace("/auth/signin");
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email!,
      });
      if (error) {
        if (__DEV__) console.warn("[verify] resend failed:", error.message);
        Alert.alert(
          "Couldn't resend the code",
          "Give it a moment and try again.",
        );
      } else {
        Alert.alert(
          "Code sent",
          "A new verification code has been sent to your email.",
        );
        setResendCooldown(RESEND_COOLDOWN_S);
      }
    } catch {
      Alert.alert("Error", "Failed to resend code.");
    }
  };

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.content, { paddingTop: insets.top + 20 }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              signupTransient.clear();
              router.back();
            }}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>
            We sent a verification code to{"\n"}
            <Text style={styles.email}>{email}</Text>
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Verification Code</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={code}
              onChangeText={handleCodeChange}
              placeholder="6-digit code"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={() => handleVerify()}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>
                {loading ? "Verifying..." : "Verify Email"}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleResend}
            disabled={resendCooldown > 0}
            activeOpacity={0.7}
            style={styles.resendButton}
          >
            <Text
              style={[
                styles.resend,
                resendCooldown > 0 && styles.resendDisabled,
              ]}
            >
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : "Resend code"}
            </Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            Can&apos;t find the email? Check your spam folder.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24 },
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
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 32,
    lineHeight: 24,
  },
  email: { color: Colors.ink, fontWeight: "600" },
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
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 28,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 20,
    textAlign: "center",
    letterSpacing: 4,
  },
  button: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  resendButton: { marginTop: 24, alignSelf: "center" },
  resend: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
  resendDisabled: { color: Colors.textSecondary, textDecorationLine: "none" },
  hint: {
    marginTop: 16,
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
});
