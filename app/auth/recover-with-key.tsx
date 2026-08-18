// Restore access to encrypted data using the recovery key: unlock the master
// key with the recovery key, then set a new sign-in password and re-wrap.
//
// Prereq: an active session. Two ways to have one — signed in but with a
// journal that won't open (the sign-in screen sends people here), or arriving
// from a password-reset email via `reset-password`, which establishes the
// session and hands over. Without one, the screen now offers both routes to
// getting a session instead of dead-ending.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { keyring, normalizeRecoveryKey } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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

export default function RecoverWithKeyScreen() {
  const insets = useSafeAreaInsets();
  const { markKeyringReady } = useAuth();
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setHasSession(true);
        setUserEmail(session.user.email ?? "");
      } else {
        setHasSession(false);
      }
    })();
  }, []);

  const validatePassword = (pass: string): string | null => {
    if (pass.length < 8) return "At least 8 characters";
    if (!/[A-Z]/.test(pass)) return "Include an uppercase letter";
    if (!/[a-z]/.test(pass)) return "Include a lowercase letter";
    if (!/[0-9]/.test(pass)) return "Include a number";
    return null;
  };

  const handleRecover = async () => {
    const normalized = normalizeRecoveryKey(recoveryKey);
    if (normalized.length < 50) {
      Alert.alert(
        "Invalid recovery key",
        "Please enter your full recovery key. It looks like a long sequence of letters and numbers separated by dashes.",
      );
      return;
    }

    const pwErr = validatePassword(newPassword);
    if (pwErr) {
      Alert.alert("Password requirements", pwErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", "Both fields must be identical.");
      return;
    }

    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert(
          "Not signed in",
          "Sign in first (use 'Reset by email' on the previous screen), then return here.",
        );
        setLoading(false);
        return;
      }

      const userId = session.user.id;

      // Unlock master key using the recovery key
      try {
        await keyring.unlockWithRecoveryKey(userId, recoveryKey);
        markKeyringReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert("Recovery failed", msg);
        setLoading(false);
        return;
      }

      // CRITICAL ORDER: update Supabase password FIRST, then re-wrap. If
      // Supabase update fails, the user can still sign in with whatever
      // password got them this far (probably from the email reset flow) and
      // retry. If we re-wrapped first and Supabase failed, the wrap would be
      // keyed to a password Supabase doesn't accept — infinite loop.
      try {
        const { error: upErr } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (upErr) {
          if (__DEV__) console.warn("[recover] password update:", upErr.message);
          Alert.alert(
            "Couldn't save your new password",
            "Your journal is unlocked, but the new password didn't save. Check your connection and try again.",
          );
          setLoading(false);
          return;
        }
      } catch {
        Alert.alert(
          "Couldn't save your new password",
          "Check your connection and try again — your journal is still unlocked.",
        );
        setLoading(false);
        return;
      }

      try {
        await keyring.setPassword(userId, newPassword);
      } catch {
        // Sign-in password moved but the wrap didn't. Signing in with the new
        // password now offers to finish the handover using the old one.
        Alert.alert(
          "Almost done",
          "Your new password is saved, but we couldn't finish re-locking your journal with it. Sign in with your new password and we'll pick up where we left off.",
        );
        setLoading(false);
        return;
      }

      // The one confirmation that matters here: the password really changed.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "All set",
        "Your data is unlocked and your new password is saved.",
        [{ text: "Continue", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (e) {
      if (__DEV__) console.warn("[recover] unexpected error:", e);
      Alert.alert(
        "Something went wrong",
        "We couldn't finish just now. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (hasSession === null) {
    return (
      <PaperBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="small" color={Colors.ink} />
        </View>
      </PaperBackground>
    );
  }

  if (hasSession === false) {
    return (
      <PaperBackground>
        <View style={[styles.errorContainer, { paddingTop: insets.top + 32 }]}>
          <IconSymbol
            name="exclamationmark.triangle.fill"
            size={48}
            color={Colors.ink}
          />
          <Text style={styles.errorTitle}>Let&apos;s get you in first</Text>
          <Text style={styles.errorMsg}>
            Your recovery key unlocks your journal, but we need to know which
            account it belongs to. Sign in — or, if you&apos;ve forgotten your
            password, email yourself a reset link and open it on this phone.
            You&apos;ll come straight back here.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => router.replace("/auth/signin")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Go to sign in"
          >
            <Text style={styles.primaryButtonText}>Go to sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace("/auth/forgot-password")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Email me a reset link"
          >
            <Text style={styles.secondaryButtonText}>
              Email me a reset link
            </Text>
          </TouchableOpacity>
        </View>
      </PaperBackground>
    );
  }

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              // Arriving from a reset link puts this screen at the root of the
              // stack — "Back" must still land somewhere.
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

          <Text style={styles.title}>Restore with Recovery Key</Text>
          <Text style={styles.subtitle}>
            Signed in as <Text style={styles.email}>{userEmail}</Text>
            {"\n"}Paste your recovery key and choose a new password.
          </Text>

          <Text style={styles.label}>Recovery Key</Text>
          <TextInput
            style={[styles.input, styles.keyInput]}
            value={recoveryKey}
            onChangeText={setRecoveryKey}
            placeholder="XXXX-XXXX-XXXX-XXXX-..."
            placeholderTextColor={Colors.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>New Password</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={Colors.textSecondary}
            secureTextEntry
            autoCapitalize="none"
          />

          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter password"
            placeholderTextColor={Colors.textSecondary}
            secureTextEntry
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleRecover}
            disabled={loading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Restore access"
            accessibilityState={{ disabled: loading }}
          >
            <Text style={styles.primaryButtonText}>
              {loading ? "Restoring..." : "Restore Access"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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
    maxWidth: 320,
  },
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
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 20,
    lineHeight: 20,
  },
  email: { color: Colors.ink, fontWeight: "600" },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
    marginTop: 4,
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
    backgroundColor: Colors.card,
    marginBottom: 14,
  },
  keyInput: {
    height: 84,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: "top",
    letterSpacing: 1,
  },
  primaryButton: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
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
    marginTop: 4,
  },
  secondaryButtonText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
