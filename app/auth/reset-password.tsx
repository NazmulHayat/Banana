// Where a password-reset email lands.
//
// The reset loop used to have no end: the email was sent with no `redirectTo`,
// nothing in the app listened for the link, and the recovery-key screen refused
// to open without a session — so a forgotten password could not be fixed from
// inside the app at all.
//
// This screen turns a recovery link (or the 6-digit code some mail clients show
// instead) into a session, then hands over to `recover-with-key`, which is the
// only place that can set a new password AND unlock the encrypted journal with
// the recovery key. Setting a new sign-in password alone would leave the
// journal locked: the key wrap is still keyed to the forgotten one.

import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { Colors, Fonts } from "@/constants/theme";
import { takeRecoveryLink } from "@/lib/recovery-link";
import { supabase } from "@/lib/supabase";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

/** The link/code this screen accepts, pulled out of a deep-link URL. */
interface RecoveryLink {
  accessToken?: string;
  refreshToken?: string;
  /** PKCE-style links carry a code to exchange instead of raw tokens. */
  code?: string;
  /** Supabase says why it refused (expired link, already used, …). */
  errorCode?: string;
}

/**
 * Read a recovery link. Supabase puts the tokens in the URL fragment on
 * implicit links and in the query string on PKCE ones, so check both. Nothing
 * from here is ever logged — these are live credentials.
 */
function parseRecoveryLink(url: string): RecoveryLink {
  const out: RecoveryLink = {};
  const scan = (segment: string) => {
    for (const pair of segment.split("&")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const key = decodeURIComponent(pair.slice(0, eq));
      const value = decodeURIComponent(pair.slice(eq + 1));
      if (key === "access_token") out.accessToken = value;
      else if (key === "refresh_token") out.refreshToken = value;
      else if (key === "code") out.code = value;
      else if (key === "error_code" || key === "error") out.errorCode = value;
    }
  };
  const hash = url.indexOf("#");
  if (hash !== -1) scan(url.slice(hash + 1));
  const query = url.indexOf("?");
  if (query !== -1) {
    const end = hash !== -1 && hash > query ? hash : url.length;
    scan(url.slice(query + 1, end));
  }
  return out;
}

type Stage = "checking" | "manual" | "opening";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string }>();

  const [stage, setStage] = useState<Stage>("checking");
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // One handover only, however many URLs arrive.
  const handedOverRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Hand over to the recovery-key screen: it owns the "new password + unlock"
  // order (Supabase password first, re-wrap second) and must not be duplicated.
  const handOver = () => {
    if (handedOverRef.current) return;
    handedOverRef.current = true;
    setStage("opening");
    router.replace("/auth/recover-with-key");
  };

  // A link that arrived while the app was closed, plus any that arrive while
  // this screen is up. The listener is removed on unmount.
  useEffect(() => {
    let cancelled = false;

    const consume = async (url: string | null) => {
      if (!url || cancelled) return;
      const link = parseRecoveryLink(url);

      if (link.errorCode) {
        if (!mountedRef.current) return;
        setStage("manual");
        setMessage(
          "That link has expired or has already been used. Send yourself a new one, or enter the code from the email.",
        );
        return;
      }

      try {
        if (link.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            link.code,
          );
          if (error) throw error;
        } else if (link.accessToken && link.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
          if (error) throw error;
        } else {
          return; // Not a recovery link — leave the manual path on screen.
        }
      } catch {
        // Never log the URL or its tokens — they're live credentials.
        if (__DEV__) console.warn("[reset] link exchange failed");
        if (!mountedRef.current) return;
        setStage("manual");
        setMessage(
          "That link didn't work. It may have expired — send yourself a new one, or enter the code from the email.",
        );
        return;
      }

      if (cancelled || !mountedRef.current) return;
      handOver();
    };

    void (async () => {
      // Already signed in (the link was handled before this screen mounted)?
      // Then there is nothing to exchange.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        handOver();
        return;
      }
      // Warm start: the root layout parks the URL here before routing.
      const stashed = takeRecoveryLink();
      if (stashed) {
        await consume(stashed);
        if (cancelled || !mountedRef.current) return;
      }
      await consume(await Linking.getInitialURL());
      if (cancelled || !mountedRef.current) return;
      setStage((prev) => (prev === "checking" ? "manual" : prev));
    })();

    const sub = Linking.addEventListener("url", (event) => {
      void consume(event.url);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
    // Runs once: `handOver` only touches refs and the router.
  }, []);

  const handleVerifyCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    if (!cleanEmail || !cleanCode) {
      setMessage("Enter the email you signed up with and the code you were sent.");
      return;
    }
    setVerifying(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: "recovery",
      });
      if (error || !data.session) {
        if (__DEV__) console.warn("[reset] otp failed:", error?.message);
        setMessage(
          "That code didn't work. Codes expire after a while — send yourself a new email and try the newest one.",
        );
        return;
      }
      handOver();
    } catch {
      setMessage(
        "We couldn't check that code just now. Check your connection and try again.",
      );
    } finally {
      if (mountedRef.current) setVerifying(false);
    }
  };

  if (stage === "checking" || stage === "opening") {
    return (
      <PaperBackground>
        <View style={[styles.loadingContainer, { paddingTop: insets.top }]}>
          <ActivityIndicator size="small" color={Colors.textSecondary} />
          <Text style={styles.loadingText}>
            {stage === "opening"
              ? "Opening your account…"
              : "Checking your reset link…"}
          </Text>
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
              if (router.canGoBack()) router.back();
              else router.replace("/auth/forgot-password");
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Finish your reset</Text>
          <Text style={styles.subtitle}>
            Open the link from the reset email on this phone and it brings you
            straight back here. If your email showed a 6-digit code instead,
            enter it below.
          </Text>

          {message ? <Text style={styles.message}>{message}</Text> : null}

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
            accessibilityLabel="Email"
          />

          <Text style={styles.label}>Code from the email</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={Colors.textSecondary}
            keyboardType="number-pad"
            autoCorrect={false}
            maxLength={10}
            accessibilityLabel="Code from the email"
          />

          <TouchableOpacity
            style={[styles.button, verifying && styles.buttonDisabled]}
            onPress={handleVerifyCode}
            disabled={verifying}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue"
            accessibilityState={{ disabled: verifying }}
          >
            <Text style={styles.buttonText}>
              {verifying ? "Checking…" : "Continue"}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Next you&apos;ll be asked for your recovery key. Your journal is
            encrypted with your old password, so a new password on its own
            can&apos;t open it.
          </Text>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.replace("/auth/forgot-password")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Send a new reset email"
          >
            <Text style={styles.secondaryButtonText}>
              Send a new reset email
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
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
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
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 22,
    marginBottom: 20,
  },
  message: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
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
  button: {
    width: "100%",
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    fontSize: 16,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  footnote: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
    marginTop: 16,
  },
  secondaryButton: {
    alignSelf: "center",
    marginTop: 20,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
});
