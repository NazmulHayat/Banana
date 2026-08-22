import { ProfileStats } from "@/components/profile-stats";
import { SyncStatus } from "@/components/sync-status";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionTitle, SettingsRow } from "@/components/ui/settings-row";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { purgeLocalUserData } from "@/lib/auth/local-purge";
import { useDataStore } from "@/lib/data-store";
import { clearUserMedia, getImageUrl } from "@/lib/media";
import { useOnboarding } from "@/lib/onboarding-context";
import { describeReminder, loadReminder, syncReminder } from "@/lib/reminder";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { Href, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
// The build number is what a support email actually needs — "1.0.0" alone
// can't tell two TestFlight builds apart.
const BUILD_NUMBER =
  Constants.expoConfig?.ios?.buildNumber ??
  (Constants.expoConfig?.android?.versionCode != null
    ? String(Constants.expoConfig.android.versionCode)
    : null);
const SUPPORT_EMAIL = "nazmulhayat588@gmail.com";

/**
 * The uploaded avatar's storage path, read defensively off the account DTO.
 *
 * Editing (and therefore `avatarPath`) lands in a separate slice, so this
 * screen must compile and behave correctly both before and after that field
 * exists on the store's profile — hence the shape check rather than a cast.
 */
function readAvatarPath(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const value = (profile as { avatarPath?: unknown }).avatarPath;
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface ProfileAvatarProps {
  /** Storage object path of the uploaded photo, or null for none. */
  path: string | null;
  /** Letter drawn when there's no photo — or when one fails to load. */
  initial: string;
  /** True while the account itself is still loading, so `path` isn't known yet. */
  pending?: boolean;
}

/**
 * The identity circle: a photo when there is one, the letter otherwise. The
 * signed URL is fetched per path, so there's a beat with neither — that shows
 * a spinner rather than a letter that would flip to a photo a moment later.
 */
function ProfileAvatar({ path, initial, pending }: ProfileAvatarProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      setResolving(false);
      return;
    }
    setResolving(true);
    void (async () => {
      const signed = await getImageUrl(path);
      if (cancelled) return;
      setUrl(signed);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Spinner while we don't yet know the answer — showing the letter first
  // would flip to a photo a beat later.
  if (pending || (path && resolving)) {
    return (
      <View style={styles.avatar}>
        <ActivityIndicator size="small" color={Colors.textSecondary} />
      </View>
    );
  }

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.avatarImage}
        // A URL that has gone stale falls back to the letter rather than
        // leaving an empty hole where a face was.
        onError={() => setUrl(null)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitial}>{initial}</Text>
    </View>
  );
}

/**
 * Profile hub. Identity + a free stats peek (taps into the analysis), plus
 * navigation into the Habits and Security spoke pages. Account actions and the
 * About links live at the bottom; Habits / Security details moved to their own
 * screens (app/habits, app/security).
 */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { resetOnboarding } = useOnboarding();
  const dataStore = useDataStore();
  const [refreshing, setRefreshing] = useState(false);

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  // Why the last attempt stopped — shown inside the dialog, which stays open.
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const username = dataStore.profile?.username ?? null;
  const habits = dataStore.habits;
  // `||`, not `&&`: if habits resolve first, the identity card would render
  // without a username and pop it in a beat later.
  const loading = !dataStore.habitsReady || !dataStore.profileReady;

  // The reminder lives entirely on-device, so the row's subtitle reads the
  // local preference rather than anything from the store. Coming back here is
  // also the moment to reconcile: if the last habit was just deleted, a
  // scheduled reminder has nothing left to point at and gets cancelled.
  const habitsReady = dataStore.habitsReady;
  const hasHabits = habits.length > 0;
  const [reminderSubtitle, setReminderSubtitle] = useState("Off");
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const pref = await loadReminder();
        if (cancelled) return;
        setReminderSubtitle(describeReminder(pref));
        if (habitsReady) await syncReminder(pref, hasHabits);
      })();
      return () => {
        cancelled = true;
      };
    }, [habitsReady, hasHabits]),
  );

  const avatarInitial = (username ?? user?.email ?? "·").charAt(0).toUpperCase();
  const avatarPath = readAvatarPath(dataStore.profile);
  // Typed routes haven't regenerated for app/profile/edit yet — same `as Href`
  // cast every other push on this screen uses.
  const goToEdit = () => router.push("/profile/edit" as Href);
  const joinedLabel = useMemo(() => {
    const createdAt = dataStore.profile?.created_at;
    if (!createdAt) return null;
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return `Joined ${d.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  }, [dataStore.profile?.created_at]);

  // Contact Support: a device with no mail client rejects the mailto:, so
  // check first and fall back to the clipboard rather than doing nothing.
  const [supportNote, setSupportNote] = useState<string | null>(null);
  const openSupport = async () => {
    const url = `mailto:${SUPPORT_EMAIL}`;
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (canOpen) {
      try {
        await Linking.openURL(url);
        setSupportNote(null);
        return;
      } catch {
        // fall through to the clipboard
      }
    }
    await Clipboard.setStringAsync(SUPPORT_EMAIL);
    setSupportNote("No mail app here — the address is on your clipboard.");
  };

  // Stats live in <ProfileStats/>, which self-loads a 12-month log window.
  // Bump this token on pull-to-refresh to force a reload.
  const [statsRefresh, setStatsRefresh] = useState(0);

  const onRefresh = async () => {
    setRefreshing(true);
    const now = new Date();
    try {
      await Promise.all([
        dataStore.refreshHabits(),
        dataStore.refreshProfile(),
        dataStore.refreshEntries(now.getFullYear(), now.getMonth() + 1),
      ]);
      setStatsRefresh((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  };

  // ============ ACCOUNT: DELETE ACCOUNT ============
  // One paper dialog with a type-DELETE guard replaces the old three-step
  // native Alert → Alert → Alert.prompt chain. The safety (you must type the
  // word) and the order of operations below are unchanged.
  const handleConfirmDeleteAccount = async () => {
    setDeletingAccount(true);
    setDeleteError(null);
    try {
      // Supabase blocks direct DELETE from storage.objects in SECURITY
      // DEFINER, so clean up media client-side BEFORE the RPC that drops the
      // auth.users row.
      if (!user?.id) {
        setDeleteError(
          "We couldn't confirm who you are, so nothing was deleted. Sign in again and retry.",
        );
        return;
      }

      // D9: the sweep now pages through the whole bucket and reports how far it
      // got. Anything short of a complete sweep aborts here — once the RPC drops
      // the auth.users row we lose the credentials to reach those objects, and a
      // deleted user's photos left in storage is a privacy failure, not clutter.
      const cleanup = await clearUserMedia(user.id);
      if (cleanup.status !== "complete") {
        setDeleteError(
          "Some of your photos couldn't be deleted, so we stopped before touching anything else. Your account is untouched. Check your connection and try again.",
        );
        return;
      }

      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        if (__DEV__) console.warn("[profile] delete_my_account:", error.message);
        setDeleteError(
          "Something went wrong on our side, so your account is still here and untouched. Check your connection and try again.",
        );
        return;
      }

      // D10: only now — the backend row is confirmed gone. Wipe every local
      // trace (decrypted month caches, the durable write queue, the master key
      // in SecureStore) before ending the session.
      await purgeLocalUserData(user.id);
      await signOut();
      setShowDeleteConfirm(false);
    } catch (e) {
      if (__DEV__) console.warn("[profile] delete account threw:", e);
      setDeleteError(
        "Something went wrong, so we stopped. Your account is still here. Check your connection and try again.",
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleConfirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setShowSignOutConfirm(false);
    }
  };

  return (
    <PaperBackground>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.ink} />
        }
      >
        {/* No page title — the tab bar already says "Profile". This is purely
            the safe-area spacer that title block used to provide. */}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]} />

        {/* The same one-line sync truth the Tracker shows. Whether your work
            has reached the server is account information; it belongs here. */}
        <SyncStatus
          pendingCount={dataStore.pendingWriteCount}
          onRetry={() => void dataStore.flushPendingWrites()}
        />

        {/* Identity — the way into editing your username and photo. */}
        <PaperCard style={styles.userCard}>
          {/* The slot is what's absolutely placed: PressableScale styles its
              inner animated view, so positioning must sit on a wrapper. */}
          <View style={styles.editSlot}>
            <PressableScale
              style={styles.editPill}
              hitSlop={10}
              onPress={goToEdit}
              accessibilityLabel="Edit profile"
              accessibilityHint="Opens your username and photo"
            >
              <Text style={styles.editPillText}>Edit</Text>
            </PressableScale>
          </View>
          <PressableScale
            scaleTo={0.96}
            onPress={goToEdit}
            accessibilityLabel="Profile photo"
            accessibilityHint="Opens your username and photo"
          >
            <ProfileAvatar
              path={avatarPath}
              initial={avatarInitial}
              pending={loading && !dataStore.profileFailed}
            />
          </PressableScale>
          {loading && dataStore.profileFailed ? (
            // A failed read used to leave this spinning forever. Say so, and
            // give them a way out.
            <PressableScale
              onPress={() => void dataStore.refreshProfile()}
              accessibilityRole="button"
              accessibilityLabel="Retry loading your profile"
              style={styles.userLoading}
            >
              <Text style={styles.loadingText}>
                Couldn&apos;t load your profile · tap to retry
              </Text>
            </PressableScale>
          ) : loading ? (
            <View style={styles.userLoading}>
              <ActivityIndicator size="small" color={Colors.ink} />
              <Text style={styles.loadingText}>Loading profile...</Text>
            </View>
          ) : (
            <>
              {username && <Text style={styles.username}>@{username}</Text>}
              <Text style={styles.email}>{user?.email}</Text>
              {joinedLabel && <Text style={styles.joinedText}>{joinedLabel}</Text>}
            </>
          )}
        </PaperCard>

        {/* Stats peek → analysis */}
        <View style={styles.section}>
          <SectionTitle>Your stats</SectionTitle>
          <ProfileStats habits={habits} refreshToken={statsRefresh} />
        </View>

        {/* Manage — spoke pages */}
        <View style={styles.section}>
          <SectionTitle>Manage</SectionTitle>
          <PaperCard style={styles.rowGroup}>
            {/* No "Stats & analysis" row here on purpose: the momentum card
                above carries the only entrance, as a button. Two doors one
                scroll apart read as two different destinations. */}
            <SettingsRow
              icon="checklist"
              title="Habits"
              subtitle={`${habits.length} habit${habits.length === 1 ? "" : "s"}`}
              onPress={() => router.push("/habits" as Href)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="bell"
              title="Daily reminder"
              subtitle={reminderSubtitle}
              onPress={() => router.push("/reminder" as Href)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="mappin.and.ellipse"
              title="Location"
              subtitle="Tag entries with where you wrote them"
              onPress={() => router.push("/location" as Href)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="square.and.arrow.down"
              title="Download my journal"
              subtitle="Keep a copy you can read without us"
              onPress={() => router.push("/export" as Href)}
            />
            {/* Dev only. `__DEV__` compiles to `false` in a release build and
                the whole branch is dropped, so this can't reach a user. It
                lives here rather than hidden behind a gesture — a dev door
                nobody can find is a dev door nobody uses. */}
            {__DEV__ ? (
              <>
                <View style={styles.rowDivider} />
                <SettingsRow
                  icon="flame"
                  title="Streak preview (dev)"
                  subtitle="Watch the flame grow without waiting 100 days"
                  onPress={() => router.push("/analysis/streak-preview" as Href)}
                />
              </>
            ) : null}
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="lock.fill"
              title="Security & recovery"
              subtitle="Recovery key, change password"
              onPress={() => router.push("/security" as Href)}
            />
          </PaperCard>
        </View>

        {/* About */}
        <View style={styles.section}>
          <SectionTitle>About</SectionTitle>
          <PaperCard style={styles.rowGroup}>
            <SettingsRow
              icon="hand.raised.fill"
              title="Privacy Policy"
              onPress={() => router.push("/legal/privacy" as Href)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="doc.text"
              title="Terms of Service"
              onPress={() => router.push("/legal/terms" as Href)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="questionmark.circle"
              title="Contact Support"
              subtitle={SUPPORT_EMAIL}
              onPress={() => void openSupport()}
            />
          </PaperCard>
          {supportNote ? (
            <Text style={styles.supportNote}>{supportNote}</Text>
          ) : null}
          <View style={styles.versionRow}>
            <Text style={styles.versionText}>
              Aight Bet {APP_VERSION}
              {BUILD_NUMBER ? ` (${BUILD_NUMBER})` : ""}
            </Text>
            <Text style={styles.versionText}>
              End-to-end encrypted · your key never leaves this device
            </Text>
          </View>
        </View>

        {/* Account actions */}
        <View style={styles.section}>
          <PressableScale style={styles.signOutButton} onPress={() => setShowSignOutConfirm(true)}>
            <IconSymbol name="rectangle.portrait.and.arrow.right" size={18} color={Colors.ink} />
            <Text style={styles.signOutText}>Sign out</Text>
          </PressableScale>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => {
              setDeleteError(null);
              setShowDeleteConfirm(true);
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Text style={styles.deleteText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* Dev only — a normal section, not a dashed box wedged mid-list. */}
        {__DEV__ && (
          <View style={styles.section}>
            <SectionTitle>Developer</SectionTitle>
            <PaperCard style={styles.rowGroup}>
              <SettingsRow
                icon="arrow.counterclockwise"
                title="Reset onboarding"
                subtitle="Debug builds only"
                onPress={() => {
                  void (async () => {
                    await resetOnboarding();
                    router.replace("/onboarding/welcome" as Href);
                  })();
                }}
              />
            </PaperCard>
          </View>
        )}

        <View style={{ height: insets.bottom + 60 }} />
      </ScrollView>

      <ConfirmDialog
        visible={showSignOutConfirm}
        title="Sign out?"
        message="You'll need your password to unlock your encrypted journal again."
        confirmLabel="Sign out"
        destructive
        loading={signingOut}
        onConfirm={handleConfirmSignOut}
        onCancel={() => setShowSignOutConfirm(false)}
      />

      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete your account?"
        message={
          deleteError ??
          "This permanently deletes your account, every journal entry, your habits, and your encryption keys. It cannot be undone. Type DELETE to confirm."
        }
        confirmLabel="Delete forever"
        confirmPhrase="DELETE"
        loading={deletingAccount}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  userCard: { marginHorizontal: 16, marginVertical: 12, alignItems: "center", paddingVertical: 24 },
  editSlot: { position: "absolute", top: 12, right: 12 },
  editPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Hairline.outline,
    backgroundColor: Scrim.accent,
  },
  editPillText: { fontSize: 13, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Hairline.outline,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: `${Colors.accent}33`,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarInitial: { fontSize: 28, fontWeight: "800", color: Colors.ink, fontFamily: Fonts.handwriting },
  username: { fontSize: 20, fontWeight: "700", color: Colors.ink, fontFamily: Fonts.handwriting, marginBottom: 4 },
  email: { fontSize: 14, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  joinedText: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwriting, marginTop: 4 },
  userLoading: { alignItems: "center", gap: 8, paddingVertical: 8 },
  loadingText: { fontSize: 13, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  rowGroup: { paddingVertical: 4, paddingHorizontal: 18 },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Hairline.base,
    marginLeft: 38,
  },
  versionRow: { alignItems: "center", paddingVertical: 16, gap: 4 },
  versionText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
  supportNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    marginTop: 10,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    marginBottom: 8,
  },
  signOutText: { fontSize: 15, color: Colors.ink, fontFamily: Fonts.handwriting, fontWeight: "600" },
  deleteButton: { height: 48, backgroundColor: "transparent", borderRadius: 12, justifyContent: "center", alignItems: "center" },
  deleteText: { fontSize: 14, color: Colors.danger, fontFamily: Fonts.handwriting, fontWeight: "600" },
});
