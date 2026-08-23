// Two ways back into an account, and both of them now end somewhere.
//
// The reset email used to be sent with no `redirectTo`, so the link opened a
// web page and the flow died there. It now points at `aightbet://auth/reset-
// password` — the screen that turns the link into a session and hands over to
// the recovery-key screen.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { isEmailShaped } from "@/lib/email";
import { supabase } from "@/lib/supabase";
import * as Linking from "expo-linking";
import { Href, router } from "expo-router";
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

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);


  const handleSendReset = async () => {
    const clean = email.trim().toLowerCase();
    if (!isEmailShaped(clean)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      // Bring the link back into the app rather than dead-ending on the web.
      const { error } = await supabase.auth.resetPasswordForEmail(clean, {
        redirectTo: Linking.createURL("/auth/reset-password"),
      });
      if (error) {
        if (__DEV__) console.warn("[forgot] reset email failed:", error.message);
        Alert.alert(
          "Couldn't send the email",
          "We couldn't send your reset link just now. Check your connection and try again.",
        );
        setLoading(false);
        return;
      }
      setSent(true);
    } catch {
      Alert.alert(
        "Couldn't send the email",
        "We couldn't send your reset link just now. Check your connection and try again.",
      );
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
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              // Reachable from a fresh stack (deep link, recovery screens), so
              // "Back" always needs a real destination.
              if (router.canGoBack()) router.back();
              else router.replace("/auth/signin");
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Recover your account</Text>
          <Text style={styles.subtitle}>
            There are two ways to regain access. Pick the one that fits.
          </Text>

          {/* Option 1: Password reset email */}
          <View style={styles.optionCard}>
            <View style={styles.optionHeader}>
              <View style={styles.optionIcon}>
                <IconSymbol name="envelope.fill" size={18} color={Colors.paper} />
              </View>
              <Text style={styles.optionTitle}>Reset by email</Text>
            </View>
            <Text style={styles.optionDesc}>
              We&apos;ll email you a link. Open it on this phone and it comes
              back into the app, where you set a new password. Have your
              recovery key to hand: your journal is encrypted with the old
              password, so a new one alone can&apos;t open it.
            </Text>

            {!sent ? (
              <>
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
                />
                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleSendReset}
                  disabled={loading}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Send reset link"
                  accessibilityState={{ disabled: loading }}
                >
                  <Text style={styles.buttonText}>
                    {loading ? "Sending..." : "Send Reset Link"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.sentBlock}>
                <IconSymbol
                  name="checkmark.circle.fill"
                  size={28}
                  color={Colors.success}
                />
                <Text style={styles.sentText}>
                  Check your email for a reset link.
                </Text>
                <Text style={styles.sentHint}>
                  Open it on this phone — it opens Aight Bet, where you&apos;ll
                  enter your recovery key and pick a new password.
                </Text>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() =>
                    // Cast: `reset-password` is new, so the generated route
                    // types don't know it until they're regenerated.
                    router.push(
                      `/auth/reset-password?email=${encodeURIComponent(
                        email.trim().toLowerCase(),
                      )}` as Href,
                    )
                  }
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="The email showed a code instead"
                >
                  <Text style={styles.secondaryButtonText}>
                    My email showed a code
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Option 2: Recovery key (direct restore) */}
          <View style={styles.optionCard}>
            <View style={styles.optionHeader}>
              <View style={styles.optionIcon}>
                <IconSymbol name="key.fill" size={18} color={Colors.paper} />
              </View>
              <Text style={styles.optionTitle}>I have my recovery key</Text>
            </View>
            <Text style={styles.optionDesc}>
              Already set a new sign-in password and just need to unlock your
              encrypted journal? Use this. You&apos;ll need to be signed in —
              the reset email above is how you get there.
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push("/auth/recover-with-key")}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Use recovery key"
            >
              <Text style={styles.secondaryButtonText}>Use Recovery Key</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 },
  backButton: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 20,
  },
  optionCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.ink,
    justifyContent: "center",
    alignItems: "center",
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  optionDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 18,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  input: {
    width: "100%",
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.paper,
    marginBottom: 12,
  },
  button: {
    width: "100%",
    height: 48,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  secondaryButton: {
    width: "100%",
    height: 48,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  sentBlock: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  sentText: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  sentHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
  },
});
