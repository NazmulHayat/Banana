import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
// UsernameRules only — a pure validation constant (same precedent as
// HabitLimits in app/onboarding/habits.tsx). It is the single source the DB's
// accounts_username_format check mirrors, so the inline messages here can't
// drift from what Postgres will accept. No data functions cross this line;
// every read/write goes through the store.
import { UsernameRules, type UsernameCheck, type WriteOutcome } from "@/lib/db";
import { discardAvatar, getImageUrl, uploadAvatar } from "@/lib/media";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * How long to sit still before asking the server whether a username is free.
 * A network debounce, not an animation — deliberately not a Motion token.
 */
const USERNAME_CHECK_DEBOUNCE_MS = 400;

/** The rule, spelled out the way the user has to satisfy it. */
const USERNAME_RULE_HINT = `${UsernameRules.MIN_LENGTH}–${UsernameRules.MAX_LENGTH} characters · lowercase letters, numbers and underscores`;

/** One line of feedback under a control: a calm note, or a plain error. */
type Feedback = { tone: "note" | "error"; message: string };

/**
 * Turn a store WriteOutcome into a line of copy. `queued` is a SUCCESS — the
 * write is durable and replays later — so it reads as saved, with a note about
 * the sync. Only `failed` is presented as a problem, and its `reason` is
 * already user-safe copy from the store (never a raw server message).
 */
function feedbackFor(outcome: WriteOutcome, done: string): Feedback {
  if (outcome.status === "failed") {
    return { tone: "error", message: outcome.reason };
  }
  return {
    tone: "note",
    message:
      outcome.status === "queued"
        ? `${done} It'll finish syncing when you're back online.`
        : done,
  };
}

/**
 * Edit profile — the profile photo and the username. Everything here goes
 * through `useDataStore()`; the screen only wires state and copy.
 *
 * Email is deliberately read-only (see below), and the photo carries the same
 * v1 disclosure as journal photos: stored privately, not end-to-end encrypted.
 */
export default function EditProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    profile,
    profileReady,
    checkUsername,
    changeUsername,
    setAvatarPath,
  } = useDataStore();

  const currentUsername = profile?.username ?? "";
  const avatarPath = profile?.avatarPath ?? null;

  // ---- username -----------------------------------------------------------
  const [username, setUsername] = useState(currentUsername);
  const seededRef = useRef(profile !== null);
  const [check, setCheck] = useState<UsernameCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usernameFeedback, setUsernameFeedback] = useState<Feedback | null>(
    null,
  );

  // ---- photo --------------------------------------------------------------
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarResolving, setAvatarResolving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState<Feedback | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const candidate = username.trim().toLowerCase();
  const changed = candidate !== currentUsername;
  const localRule = UsernameRules.validate(candidate);

  // Seed the field the first time the profile lands (it loads a beat after the
  // screen mounts). Only once — never stomp what the user has typed since.
  useEffect(() => {
    if (seededRef.current || !profile) return;
    seededRef.current = true;
    setUsername(profile.username);
  }, [profile]);

  // Live availability, debounced. Local rules answer instantly; only a
  // rule-passing, actually-changed name costs a round trip.
  useEffect(() => {
    if (!changed) {
      setCheck(null);
      setChecking(false);
      return;
    }
    if (!localRule.valid) {
      setCheck({
        status: "invalid",
        reason: localRule.error ?? "That username won't work.",
      });
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      void (async () => {
        const result = await checkUsername(candidate);
        if (cancelled) return;
        setCheck(result);
        setChecking(false);
      })();
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, changed, localRule.valid, localRule.error, checkUsername]);

  // Resolve the stored object path to a signed URL for display.
  useEffect(() => {
    if (!avatarPath) {
      setAvatarUrl(null);
      setAvatarResolving(false);
      return;
    }
    let cancelled = false;
    setAvatarResolving(true);
    void (async () => {
      const url = await getImageUrl(avatarPath);
      if (cancelled) return;
      // A null URL isn't fatal — the letter fallback takes over.
      setAvatarUrl(url);
      setAvatarResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [avatarPath]);

  const announce = (feedback: Feedback) => {
    void Haptics.notificationAsync(
      feedback.tone === "error"
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Success,
    );
  };

  const handlePickPhoto = async () => {
    if (photoBusy) return;
    setPhotoFeedback(null);

    // Ask only now, at the moment the user asked for the picker.
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setPermissionBlocked(true);
      return;
    }
    setPermissionBlocked(false);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result || result.canceled) return;
    const uri = result.assets?.[0]?.uri;
    if (!uri || !user) return;

    // Storage first, then the row, then cleanup — the same order the tracker
    // uses for entry photos (D8), so the bucket can never keep an object
    // nothing points at:
    //   upload → record the path → delete the object that is now unreferenced
    //   (the NEW one if recording failed, the OLD one if it succeeded).
    const previous = avatarPath;
    setPhotoBusy(true);
    try {
      const upload = await uploadAvatar(uri, user.id);
      if (upload.status === "failed") {
        const failure: Feedback = { tone: "error", message: upload.reason };
        announce(failure);
        setPhotoFeedback(failure);
        return;
      }

      const outcome = await setAvatarPath(upload.path);
      if (outcome.status === "failed") {
        await discardAvatar(upload.path);
      } else if (previous && previous !== upload.path) {
        await discardAvatar(previous);
      }

      const feedback = feedbackFor(outcome, "Photo updated.");
      announce(feedback);
      setPhotoFeedback(feedback);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async () => {
    const previous = avatarPath;
    setPhotoBusy(true);
    try {
      // Pointer first, object second: a pointer to a deleted object shows a
      // broken photo, while a stray object is invisible and gets swept with
      // the rest of the user's media on account deletion.
      const outcome = await setAvatarPath(null);
      if (outcome.status !== "failed" && previous) {
        await discardAvatar(previous);
      }
      setConfirmRemove(false);
      const feedback = feedbackFor(outcome, "Photo removed.");
      announce(feedback);
      setPhotoFeedback(feedback);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleSaveUsername = async () => {
    setUsernameFeedback(null);
    setSaving(true);
    const outcome = await changeUsername(candidate);
    setSaving(false);
    const feedback = feedbackFor(outcome, "Username saved.");
    announce(feedback);
    // The field keeps the rejected name so it can be edited; `feedback` (which
    // survives until the next keystroke) is the last word on it, and it hides
    // the availability line below so the two can't contradict each other.
    setUsernameFeedback(feedback);
  };

  // Save stays inert until the name is a real, changed, not-known-taken one.
  // A `unknown` check (we couldn't ask) still allows the attempt — the unique
  // index is the authority, and refusing to try would strand a flaky
  // connection.
  const canSave =
    changed &&
    localRule.valid &&
    !checking &&
    !saving &&
    check?.status !== "taken" &&
    check?.status !== "invalid";

  const initial = (currentUsername || user?.email || "·")
    .charAt(0)
    .toUpperCase();

  const availabilityLine = (): Feedback | null => {
    if (!changed) return null;
    if (!localRule.valid) {
      return {
        tone: "error",
        message: localRule.error ?? "That username won't work.",
      };
    }
    if (checking) return { tone: "note", message: "Checking…" };
    if (!check) return null;
    switch (check.status) {
      case "available":
        return { tone: "note", message: `@${candidate} is free.` };
      case "taken":
        return {
          tone: "error",
          message: "That username is already taken. Try another one.",
        };
      case "invalid":
        return { tone: "error", message: check.reason };
      case "unknown":
        return {
          tone: "note",
          message: "We couldn't check that just now — you can still try saving.",
        };
    }
  };

  // A save result outranks the availability line — never show "@x is free"
  // under "that username is already taken".
  const availability = usernameFeedback ? null : availabilityLine();
  const loadingProfile = !profileReady && !profile;

  return (
    <PaperBackground>
      <ScreenHeader title="Edit profile" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 60 },
          ]}
        >
          {/* ---------------- photo ---------------- */}
          <View style={styles.avatarBlock}>
            <PressableScale
              onPress={() => void handlePickPhoto()}
              disabled={photoBusy || loadingProfile}
              style={styles.avatarPress}
              accessibilityLabel={
                avatarPath ? "Change profile photo" : "Add a profile photo"
              }
              accessibilityHint="Opens your photo library"
            >
              <View
                style={[styles.avatar, (photoBusy || loadingProfile) && styles.dimmed]}
              >
                {loadingProfile ? (
                  <Skeleton width={96} height={96} borderRadius={48} />
                ) : photoBusy || avatarResolving ? (
                  <ActivityIndicator color={Colors.textSecondary} />
                ) : avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarInitial}>{initial}</Text>
                )}
              </View>
            </PressableScale>

            <Text style={styles.avatarCaption}>
              {photoBusy ? "Saving your photo…" : "Tap to change your photo"}
            </Text>

            {avatarPath && !photoBusy ? (
              <PressableScale
                onPress={() => setConfirmRemove(true)}
                style={styles.linkButton}
                accessibilityLabel="Remove profile photo"
              >
                <Text style={styles.linkButtonText}>Remove photo</Text>
              </PressableScale>
            ) : null}

            {photoFeedback ? (
              <Text
                style={
                  photoFeedback.tone === "error" ? styles.errorText : styles.noteText
                }
              >
                {photoFeedback.message}
              </Text>
            ) : null}
          </View>

          {/* Photo access was refused — calm, no blame, one way forward. */}
          {permissionBlocked ? (
            <PaperCard style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                Aight Bet doesn&apos;t have access to your photos yet. You can
                turn it on in Settings — nothing else here depends on it.
              </Text>
              <PressableScale
                onPress={() => void Linking.openSettings()}
                style={styles.noticeButton}
                accessibilityLabel="Open Settings"
                accessibilityHint="Opens Aight Bet's photo settings"
              >
                <Text style={styles.noticeButtonText}>Open Settings</Text>
              </PressableScale>
            </PaperCard>
          ) : null}

          {/* ---------------- username ---------------- */}
          <Text style={styles.label}>Username</Text>
          {loadingProfile ? (
            <Skeleton height={50} borderRadius={12} style={styles.fieldSkeleton} />
          ) : (
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={(next) => {
                setUsername(next);
                setUsernameFeedback(null);
              }}
              placeholder="your_username"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={UsernameRules.MAX_LENGTH}
              accessibilityLabel="Username"
              accessibilityHint={USERNAME_RULE_HINT}
            />
          )}
          <Text style={styles.hint}>{USERNAME_RULE_HINT}</Text>
          {availability ? (
            <Text
              style={
                availability.tone === "error" ? styles.errorText : styles.noteText
              }
            >
              {availability.message}
            </Text>
          ) : null}
          {usernameFeedback ? (
            <Text
              style={
                usernameFeedback.tone === "error"
                  ? styles.errorText
                  : styles.noteText
              }
            >
              {usernameFeedback.message}
            </Text>
          ) : null}

          <PressableScale
            onPress={() => void handleSaveUsername()}
            disabled={!canSave}
            style={[styles.saveButton, !canSave && styles.dimmed]}
            accessibilityLabel="Save username"
          >
            <Text style={styles.saveButtonText}>
              {saving ? "Saving…" : "Save username"}
            </Text>
          </PressableScale>

          {/* ---------------- email (read-only) ---------------- */}
          <Text style={styles.label}>Email</Text>
          <PaperCard style={styles.readOnlyCard}>
            <Text style={styles.readOnlyValue} selectable>
              {user?.email ?? "—"}
            </Text>
          </PaperCard>
          <Text style={styles.hint}>
            Changing your email isn&apos;t available yet — it&apos;s tied to
            your sign-in and your encryption keys.
          </Text>

          {/* ---------------- privacy ---------------- */}
          <PaperCard style={styles.privacyCard}>
            <Text style={styles.privacyText}>
              Your photo is stored privately — only you can open it. Like
              journal photos, it isn&apos;t end-to-end encrypted in v1.
            </Text>
          </PaperCard>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={confirmRemove}
        title="Remove your photo?"
        message="Your profile goes back to the letter mark. You can add a new photo whenever you like."
        confirmLabel="Remove"
        loading={photoBusy}
        onConfirm={() => void handleRemovePhoto()}
        onCancel={() => setConfirmRemove(false)}
      />
    </PaperBackground>
  );
}

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  avatarBlock: { alignItems: "center", marginBottom: 20 },
  avatarPress: { borderRadius: AVATAR_SIZE / 2 },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarInitial: {
    fontSize: 36,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  avatarCaption: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
  },
  linkButton: { paddingVertical: 6, paddingHorizontal: 8 },
  linkButtonText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
  label: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginTop: 12,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
  },
  fieldSkeleton: { marginBottom: 0 },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 8,
    lineHeight: 18,
  },
  noteText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 8,
    lineHeight: 19,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    marginTop: 8,
    lineHeight: 19,
  },
  saveButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  saveButtonText: {
    fontSize: 16,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  dimmed: { opacity: 0.6 },
  readOnlyCard: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderColor: Hairline.base,
  },
  readOnlyValue: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  noticeCard: { padding: 14, marginBottom: 16 },
  noticeText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
  },
  noticeButton: {
    height: 40,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  noticeButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  privacyCard: { padding: 14, marginTop: 20 },
  privacyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
  },
});
