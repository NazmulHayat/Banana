import { ProfileStats } from "@/components/profile-stats";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionTitle, SettingsRow } from "@/components/ui/settings-row";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { purgeLocalUserData } from "@/lib/auth/local-purge";
import { useDataStore } from "@/lib/data-store";
import { clearUserMedia } from "@/lib/media";
import { useOnboarding } from "@/lib/onboarding-context";
import { formatReminderTime, loadReminder, syncReminder } from "@/lib/reminder";
import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";
import { Href, router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
const SUPPORT_EMAIL = "nazmulhayat588@gmail.com";

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

  const username = dataStore.profile?.username ?? null;
  const habits = dataStore.habits;
  const loading = !dataStore.habitsReady && !dataStore.profileReady;

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
        setReminderSubtitle(
          pref.enabled
            ? `Every day at ${formatReminderTime(pref.hour, pref.minute)}`
            : "Off",
        );
        if (habitsReady) await syncReminder(pref, hasHabits);
      })();
      return () => {
        cancelled = true;
      };
    }, [habitsReady, hasHabits]),
  );

  const avatarInitial = (username ?? user?.email ?? "·").charAt(0).toUpperCase();
  const joinedLabel = useMemo(() => {
    const createdAt = dataStore.profile?.created_at;
    if (!createdAt) return null;
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return `Joined ${d.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`;
  }, [dataStore.profile?.created_at]);

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
    try {
      // Supabase blocks direct DELETE from storage.objects in SECURITY
      // DEFINER, so clean up media client-side BEFORE the RPC that drops the
      // auth.users row.
      if (!user?.id) {
        Alert.alert(
          "Not signed in",
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
        Alert.alert(
          "Couldn't remove your photos",
          "Some of your photos couldn't be deleted, so we stopped before touching anything else. Your account is untouched. Check your connection and try again.",
        );
        return;
      }

      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        if (__DEV__) console.warn("[profile] delete_my_account:", error.message);
        Alert.alert(
          "Couldn't delete your account",
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
      Alert.alert(
        "Couldn't delete your account",
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
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <Text style={styles.title} accessibilityRole="header">
            Profile
          </Text>
        </View>

        {/* Identity (display only) */}
        <PaperCard style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{avatarInitial}</Text>
          </View>
          {loading ? (
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
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            />
          </PaperCard>
          <View style={styles.versionRow}>
            <Text style={styles.versionText}>Version {APP_VERSION}</Text>
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
            onPress={() => setShowDeleteConfirm(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Text style={styles.deleteText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        {/* Dev only */}
        {__DEV__ && (
          <View style={styles.devSection}>
            <Text style={styles.devTitle}>Developer Tools</Text>
            <TouchableOpacity
              style={styles.devButton}
              onPress={async () => {
                await resetOnboarding();
                router.replace("/onboarding/welcome" as Href);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.devButtonText}>Reset Onboarding</Text>
            </TouchableOpacity>
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
        message="This permanently deletes your account, every journal entry, your habits, and your encryption keys. It cannot be undone. Type DELETE to confirm."
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
  title: { fontSize: 32, fontWeight: "700", color: Colors.ink, fontFamily: Fonts.handwriting },
  userCard: { marginHorizontal: 16, marginVertical: 12, alignItems: "center", paddingVertical: 24 },
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
  versionRow: { alignItems: "center", paddingVertical: 16 },
  versionText: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwriting },
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
  devSection: {
    marginHorizontal: 16,
    marginTop: 24,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.shadow,
    borderRadius: 12,
    borderStyle: "dashed",
  },
  devTitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  devButton: { padding: 10, backgroundColor: Colors.shadow, borderRadius: 8, alignItems: "center" },
  devButtonText: { fontSize: 12, color: Colors.ink, fontFamily: Fonts.handwriting, fontWeight: "600" },
});
