// Runs immediately after signup (or post-verify). Creates the accounts row,
// sets up the encryption keyring, shows the user their recovery key once,
// and requires explicit confirmation that they saved it.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { signupTransient } from "@/lib/auth/signup-transient";
import { keyring } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import { Href, router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Phase = "setting-up" | "reveal" | "error";

export default function RecoverySetupScreen() {
  const insets = useSafeAreaInsets();
  const { markKeyringReady } = useAuth();
  const [phase, setPhase] = useState<Phase>("setting-up");
  const [recoveryKey, setRecoveryKey] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Defined inline (rather than as a component-level function) so the
    // effect has no external deps to track — it should only run once on
    // mount.
    async function runSetup() {
      try {
        const pending = signupTransient.consume();
        if (!pending) {
          setErrorMsg(
            "Your signup session timed out. Please sign in to continue.",
          );
          setPhase("error");
          return;
        }

        // Make sure we have a session (we should — signup created one or
        // verify-OTP did)
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setErrorMsg("No active session. Please sign in.");
          setPhase("error");
          return;
        }
        const userId = session.user.id;

        // Create the accounts row (username, owner = self)
        const { error: accountErr } = await supabase.from("accounts").upsert(
          {
            id: userId,
            username: pending.username,
          },
          { onConflict: "id" },
        );
        if (accountErr) {
          if (accountErr.code === "23505") {
            setErrorMsg(
              "Someone took this username while you were signing up. Please pick another.",
            );
          } else {
            setErrorMsg(`Could not create profile: ${accountErr.message}`);
          }
          setPhase("error");
          return;
        }

        // Build the keyring (master key, wrap with password, wrap with recovery)
        const { recoveryKey } = await keyring.setupNewUser(
          userId,
          pending.password,
        );
        markKeyringReady(true);
        setRecoveryKey(recoveryKey);
        setPhase("reveal");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        setPhase("error");
      }
    }

    void runSetup();
  }, [markKeyringReady]);

  async function handleCopy() {
    await Clipboard.setStringAsync(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleContinue() {
    if (!confirmed) {
      Alert.alert(
        "Confirm you saved it",
        "Tap the checkbox to confirm you've written down or saved your recovery key.",
      );
      return;
    }
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
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={async () => {
              await supabase.auth.signOut();
              router.replace("/auth/login");
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.primaryButtonText}>Back to Sign In</Text>
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
        <Text style={styles.title}>Save your recovery key</Text>
        <Text style={styles.subtitle}>
          This is the ONLY way to recover your encrypted data if you forget
          your password. We can&apos;t show it to you again on this screen.
        </Text>

        <View style={styles.keyBox}>
          <Text style={styles.keyText} selectable>
            {recoveryKey}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.copyButton}
          onPress={handleCopy}
          activeOpacity={0.7}
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
          activeOpacity={0.7}
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
          activeOpacity={0.7}
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
    backgroundColor: "rgba(255, 179, 128, 0.18)",
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
});
