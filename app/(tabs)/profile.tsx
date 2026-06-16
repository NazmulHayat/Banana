import { ProfileStats } from "@/components/profile-stats";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { keyring } from "@/lib/crypto";
import { useDataStore } from "@/lib/data-store";
import { Habit, saveHabits } from "@/lib/db";
import { clearUserMedia } from "@/lib/media";
import { useOnboarding } from "@/lib/onboarding-context";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { Href, router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
const PRIVACY_URL = "https://aightbet-app.example.com/privacy"; // TODO: replace with real URL
const TERMS_URL = "https://aightbet-app.example.com/terms";
const SUPPORT_EMAIL = "support@aightbet-app.example.com";

interface SettingsRowProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}

function SettingsRow({ icon, title, subtitle, onPress }: SettingsRowProps) {
  return (
    <TouchableOpacity
      style={settingsRowStyles.row}
      onPress={onPress}
      activeOpacity={0.6}
    >
      <IconSymbol
        name={icon as any}
        size={20}
        color={Colors.ink}
        style={settingsRowStyles.icon}
      />
      <View style={settingsRowStyles.text}>
        <Text style={settingsRowStyles.title}>{title}</Text>
        {subtitle ? (
          <Text style={settingsRowStyles.subtitle}>{subtitle}</Text>
        ) : null}
      </View>
      <IconSymbol
        name="chevron.right"
        size={14}
        color={Colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

/** Section header with the same accent-dot stamp as the feed date rows. */
function SectionTitle({
  children,
  inline,
}: {
  children: string;
  /** Skip the bottom margin when used inside a header row. */
  inline?: boolean;
}) {
  return (
    <View style={[sectionTitleStyles.row, inline && { marginBottom: 0 }]}>
      <View style={sectionTitleStyles.dot} />
      <Text style={sectionTitleStyles.text}>{children}</Text>
    </View>
  );
}

const sectionTitleStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.accent,
  },
  text: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
});

const settingsRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  icon: {
    marginRight: 14,
    width: 24,
  },
  text: { flex: 1 },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { resetOnboarding } = useOnboarding();
  const dataStore = useDataStore();
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [habitName, setHabitName] = useState("");

  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  // Sign-out confirmation (reusable ConfirmDialog drives the confirm step)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

  const username = dataStore.profile?.username ?? null;
  const habits = dataStore.habits;
  const loading = !dataStore.habitsReady && !dataStore.profileReady;

  const avatarInitial = (username ?? user?.email ?? "·")
    .charAt(0)
    .toUpperCase();
  const joinedLabel = useMemo(() => {
    const createdAt = dataStore.profile?.created_at;
    if (!createdAt) return null;
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return null;
    return `Joined ${d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })}`;
  }, [dataStore.profile?.created_at]);

  // Stats live in <ProfileStats/>, which self-loads a 12-month log window from
  // the data store. Bump this token on pull-to-refresh to force a reload.
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

  // ============ HABITS ============
  const handleOpenHabitModal = (habit?: Habit) => {
    if (habit) {
      setEditingHabit(habit);
      setHabitName(habit.name);
    } else {
      setEditingHabit(null);
      setHabitName("");
    }
    setShowHabitModal(true);
  };

  const handleSaveHabit = async () => {
    const name = habitName.trim();
    if (!name) {
      Alert.alert("Required", "Please enter a habit name.");
      return;
    }
    if (name.length > 20) {
      Alert.alert("Too long", "Habit name must be 20 characters or less.");
      return;
    }
    let updated: Habit[];
    if (editingHabit) {
      updated = habits.map((h) =>
        h.id === editingHabit.id ? { ...h, name } : h,
      );
    } else {
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      updated = [
        ...habits,
        { id, name, createdAt: new Date().toISOString() },
      ];
    }
    dataStore.updateHabits(updated);
    try {
      await saveHabits(updated);
    } catch (e) {
      console.error("[profile] save habit failed:", e);
      Alert.alert("Save failed", "Could not save habit. Please try again.");
      await dataStore.refreshHabits();
    }
    setEditingHabit(null);
    setHabitName("");
  };

  const handleDeleteHabit = (habit: Habit) => {
    Alert.alert(
      "Delete habit",
      `Are you sure you want to delete "${habit.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const updated = habits.filter((h) => h.id !== habit.id);
            dataStore.updateHabits(updated);
            try {
              await saveHabits(updated);
            } catch (e) {
              console.error("[profile] delete habit failed:", e);
              Alert.alert("Delete failed", "Could not delete habit.");
              await dataStore.refreshHabits();
            }
            setEditingHabit(null);
            setHabitName("");
            setShowHabitModal(false);
          },
        },
      ],
    );
  };

  // ============ SECURITY: SHOW RECOVERY KEY ============
  const handleOpenRecoveryModal = () => {
    setRecoveryPassword("");
    setRecoveryKey("");
    setRecoveryError("");
    setShowRecoveryModal(true);
  };

  const handleRevealRecoveryKey = async () => {
    if (!recoveryPassword || !user) return;
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      // Re-derive KEK + unwrap master key — this is the only way to confirm
      // the user knows the encryption password (not just the Supabase password,
      // which can differ after a recovery flow).
      try {
        await keyring.unlock(user.id, recoveryPassword);
      } catch {
        setRecoveryError("Incorrect password.");
        return;
      }
      const key = await keyring.getRecoveryKey(user.id);
      setRecoveryKey(key);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRecoveryError(msg);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleCopyRecovery = async () => {
    if (!recoveryKey) return;
    await Clipboard.setStringAsync(recoveryKey);
    Alert.alert("Copied", "Recovery key copied to clipboard.");
  };

  const handleRegenerateRecoveryKey = () => {
    Alert.alert(
      "Regenerate recovery key?",
      "Your old recovery key will stop working immediately. Make sure to save the new one.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Regenerate",
          style: "destructive",
          onPress: async () => {
            if (!user) return;
            try {
              const newKey = await keyring.regenerateRecoveryKey(user.id);
              setRecoveryKey(newKey);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert("Failed", msg);
            }
          },
        },
      ],
    );
  };

  // ============ SECURITY: CHANGE PASSWORD ============
  const handleChangePassword = async () => {
    if (!user) return;
    if (!oldPassword || !newPassword || !confirmNewPassword) {
      Alert.alert("Required", "Please fill all fields.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      Alert.alert("Passwords don't match", "New passwords must match.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Too short", "New password must be at least 8 characters.");
      return;
    }
    setChangePasswordLoading(true);
    try {
      // Verify old password by re-deriving the encryption KEK (also proves
      // the user can decrypt their data — stronger than Supabase signIn).
      try {
        await keyring.unlock(user.id, oldPassword);
      } catch {
        Alert.alert("Incorrect password", "Your current password is wrong.");
        setChangePasswordLoading(false);
        return;
      }

      // CRITICAL ORDER: update Supabase password FIRST (recoverable via email
      // reset if it succeeds and the next step fails), THEN re-wrap encryption.
      // If we did it the other way and Supabase update failed, the user would
      // have: old Supabase password → can sign in but can't decrypt; new
      // Supabase password → doesn't exist anywhere. Recovery becomes ugly.
      const { error: upErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (upErr) {
        Alert.alert(
          "Password change failed",
          "Supabase could not update your password: " + upErr.message,
        );
        setChangePasswordLoading(false);
        return;
      }

      // Now re-wrap. If this fails, the user can sign in with the new
      // Supabase password and use "Change Password" again from Settings.
      try {
        await keyring.setPassword(user.id, newPassword);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(
          "Almost done",
          "Your sign-in password was updated, but re-wrapping your encryption " +
            "failed: " + msg + ". Sign in with your new password and try " +
            "Change Password again.",
        );
        setChangePasswordLoading(false);
        return;
      }

      setShowChangePasswordModal(false);
      setOldPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      Alert.alert("Password changed", "Use your new password next time.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Error", msg);
    } finally {
      setChangePasswordLoading(false);
    }
  };

  // ============ ACCOUNT: DELETE ACCOUNT ============
  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account, all journal entries, habits, and encryption keys. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Permanently",
          style: "destructive",
          onPress: () => confirmDeleteAccount(),
        },
      ],
    );
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      "One more time",
      "Type the word DELETE on the next screen to confirm.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "I understand",
          onPress: () => promptDeleteConfirmation(),
        },
      ],
    );
  };

  const promptDeleteConfirmation = () => {
    Alert.prompt(
      "Type DELETE to confirm",
      "This is your final confirmation.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async (value?: string) => {
            if ((value ?? "").trim().toUpperCase() !== "DELETE") {
              Alert.alert("Confirmation failed", "You didn't type DELETE.");
              return;
            }
            try {
              // Supabase blocks direct DELETE from storage.objects from
              // SECURITY DEFINER, so we must clean up media client-side
              // BEFORE calling the RPC that drops the auth.users row.
              if (user?.id) {
                await clearUserMedia(user.id);
              }
              const { error } = await supabase.rpc("delete_my_account");
              if (error) {
                Alert.alert("Delete failed", error.message);
                return;
              }
              await signOut();
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              Alert.alert("Error", msg);
            }
          },
        },
      ],
      "plain-text",
    );
  };

  const handleSignOut = () => {
    setShowSignOutConfirm(true);
  };

  const handleConfirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      // signOut typically unmounts this screen; reset defensively in case it
      // returns without navigating away.
      setSigningOut(false);
      setShowSignOutConfirm(false);
    }
  };

  return (
    <PaperBackground>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.ink}
          />
        }
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* User Info */}
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
              {joinedLabel && (
                <Text style={styles.joinedText}>{joinedLabel}</Text>
              )}
            </>
          )}
        </PaperCard>

        {/* Stats — real per-habit + overall stats from the merged engine,
            computed over the last 12 months of habit logs. */}
        <View style={styles.section}>
          <SectionTitle>Your stats</SectionTitle>
          <ProfileStats habits={habits} refreshToken={statsRefresh} />
        </View>

        {/* Habits */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <SectionTitle inline>{`Habits (${habits.length})`}</SectionTitle>
            {!loading && habits.length > 0 && (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleOpenHabitModal()}
                activeOpacity={0.7}
              >
                <IconSymbol name="pencil" size={14} color={Colors.accent} />
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
          {loading ? (
            <View style={styles.loadingSection}>
              <ActivityIndicator size="small" color={Colors.ink} />
            </View>
          ) : habits.length > 0 ? (
            <View style={styles.habitsContainer}>
              {habits.map((habit) => (
                <PressableScale
                  key={habit.id}
                  style={styles.habitChip}
                  onPress={() => handleOpenHabitModal(habit)}
                  scaleTo={0.94}
                >
                  <Text style={styles.habitChipText}>{habit.name}</Text>
                </PressableScale>
              ))}
              <PressableScale
                style={styles.addHabitChip}
                onPress={() => handleOpenHabitModal()}
                scaleTo={0.94}
              >
                <IconSymbol name="plus" size={14} color={Colors.accent} />
                <Text style={styles.addHabitChipText}>Add</Text>
              </PressableScale>
            </View>
          ) : (
            <PaperCard style={styles.emptyCard}>
              <IconSymbol
                name="sparkles"
                size={32}
                color={Colors.accent}
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.emptyTitle}>No habits yet</Text>
              <Text style={styles.emptyHint}>
                Start building your routine
              </Text>
              <PressableScale
                style={styles.primaryCta}
                onPress={() => handleOpenHabitModal()}
              >
                <IconSymbol name="plus" size={16} color={Colors.paper} />
                <Text style={styles.primaryCtaText}>Add Your First Habit</Text>
              </PressableScale>
            </PaperCard>
          )}
        </View>

        {/* Security */}
        <View style={styles.section}>
          <SectionTitle>Security</SectionTitle>
          <PaperCard style={styles.securityCard}>
            <View style={styles.securityHeader}>
              <IconSymbol name="lock.fill" size={20} color={Colors.ink} />
              <Text style={styles.securityTitle}>End-to-end encrypted</Text>
            </View>
            <Text style={styles.securityDesc}>
              Your journal text and habits are encrypted on this device before
              upload — only your password (or recovery key) can unlock them.
              Photo attachments are stored privately but not yet client-side
              encrypted in v1.
            </Text>
          </PaperCard>

          <PaperCard style={styles.rowGroup}>
            <SettingsRow
              icon="key.fill"
              title="View Recovery Key"
              subtitle="Used if you forget your password"
              onPress={handleOpenRecoveryModal}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="lock.rotation"
              title="Change Password"
              subtitle="Re-encrypts your master key"
              onPress={() => setShowChangePasswordModal(true)}
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
              onPress={() => Linking.openURL(PRIVACY_URL)}
            />
            <View style={styles.rowDivider} />
            <SettingsRow
              icon="doc.text"
              title="Terms of Service"
              onPress={() => Linking.openURL(TERMS_URL)}
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
          <PressableScale style={styles.signOutButton} onPress={handleSignOut}>
            <IconSymbol
              name="rectangle.portrait.and.arrow.right"
              size={18}
              color={Colors.ink}
            />
            <Text style={styles.signOutText}>Sign out</Text>
          </PressableScale>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
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

      {/* ============ HABIT MODAL ============ */}
      <Modal
        visible={showHabitModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHabitModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowHabitModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editingHabit ? "Edit Habit" : "Add Habit"}
            </Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView
            style={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.formLabel}>Habit Name</Text>
            <TextInput
              style={styles.modalInput}
              value={habitName}
              onChangeText={setHabitName}
              placeholder="e.g. Exercise, Read, Meditate"
              placeholderTextColor={Colors.textSecondary}
              maxLength={20}
              autoFocus
            />
            <Text style={styles.modalCharCount}>{habitName.length}/20</Text>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSaveHabit}
              activeOpacity={0.7}
            >
              <Text style={styles.saveButtonText}>
                {editingHabit ? "Save Changes" : "Add Habit"}
              </Text>
            </TouchableOpacity>

            {editingHabit && (
              <TouchableOpacity
                style={styles.deleteModalButton}
                onPress={() => handleDeleteHabit(editingHabit)}
                activeOpacity={0.7}
              >
                <Text style={styles.deleteModalText}>Delete Habit</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ============ RECOVERY KEY MODAL ============ */}
      <Modal
        visible={showRecoveryModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRecoveryModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowRecoveryModal(false)}>
              <Text style={styles.modalCancel}>Done</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Recovery Key</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView
            style={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {!recoveryKey ? (
              <>
                <Text style={styles.modalDesc}>
                  Enter your password to reveal your recovery key.
                </Text>
                <Text style={styles.formLabel}>Password</Text>
                <TextInput
                  style={styles.modalInput}
                  value={recoveryPassword}
                  onChangeText={setRecoveryPassword}
                  placeholder="Your current password"
                  placeholderTextColor={Colors.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                />
                {recoveryError ? (
                  <Text style={styles.errorText}>{recoveryError}</Text>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    recoveryLoading && styles.buttonDisabled,
                  ]}
                  onPress={handleRevealRecoveryKey}
                  disabled={recoveryLoading}
                  activeOpacity={0.7}
                >
                  <Text style={styles.saveButtonText}>
                    {recoveryLoading ? "Verifying..." : "Reveal Key"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.modalDesc}>
                  Keep this somewhere safe. If you forget your password, only
                  this key can restore access.
                </Text>
                <View style={styles.keyBox}>
                  <Text style={styles.keyText} selectable>
                    {recoveryKey}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={handleCopyRecovery}
                  activeOpacity={0.7}
                >
                  <IconSymbol
                    name="doc.on.doc"
                    size={16}
                    color={Colors.ink}
                  />
                  <Text style={styles.copyButtonText}>Copy to Clipboard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.regenerateButton}
                  onPress={handleRegenerateRecoveryKey}
                  activeOpacity={0.7}
                >
                  <Text style={styles.regenerateButtonText}>
                    Regenerate Recovery Key
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============ CHANGE PASSWORD MODAL ============ */}
      <Modal
        visible={showChangePasswordModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowChangePasswordModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setShowChangePasswordModal(false)}
            >
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Change Password</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView
            style={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalDesc}>
              Your encryption master key will be re-wrapped with the new
              password.
            </Text>
            <Text style={styles.formLabel}>Current Password</Text>
            <TextInput
              style={styles.modalInput}
              value={oldPassword}
              onChangeText={setOldPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
            />
            <Text style={styles.formLabel}>New Password</Text>
            <TextInput
              style={styles.modalInput}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
            />
            <Text style={styles.formLabel}>Confirm New Password</Text>
            <TextInput
              style={styles.modalInput}
              value={confirmNewPassword}
              onChangeText={setConfirmNewPassword}
              placeholder="Re-enter new password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[
                styles.saveButton,
                changePasswordLoading && styles.buttonDisabled,
              ]}
              onPress={handleChangePassword}
              disabled={changePasswordLoading}
              activeOpacity={0.7}
            >
              <Text style={styles.saveButtonText}>
                {changePasswordLoading ? "Changing..." : "Change Password"}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* ============ SIGN OUT CONFIRM ============ */}
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
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  userCard: {
    marginHorizontal: 16,
    marginVertical: 12,
    alignItems: "center",
    paddingVertical: 24,
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
  avatarInitial: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  joinedText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
  },
  userLoading: { alignItems: "center", gap: 8, paddingVertical: 8 },
  loadingText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  username: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  editButton: { flexDirection: "row", alignItems: "center", gap: 4 },
  editButtonText: {
    fontSize: 13,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
  loadingSection: { paddingVertical: 24, alignItems: "center" },
  habitsContainer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  habitChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  habitChipText: {
    fontSize: 13,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "500",
  },
  addHabitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "transparent",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderStyle: "dashed",
  },
  addHabitChipText: {
    fontSize: 13,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
  emptyCard: {
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 16,
    textAlign: "center",
  },
  primaryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    backgroundColor: Colors.ink,
    borderRadius: 10,
  },
  primaryCtaText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  securityCard: { padding: 14, marginBottom: 8 },
  securityHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  securityTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  securityDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 18,
  },
  rowGroup: {
    paddingVertical: 4,
    paddingHorizontal: 18,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(26, 26, 26, 0.08)",
    marginLeft: 38,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.shadow,
  },
  rowIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.shadow,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  rowSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
  versionRow: { alignItems: "center", paddingVertical: 16 },
  versionText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
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
  signOutText: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
  deleteButton: {
    height: 48,
    backgroundColor: "transparent",
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteText: {
    fontSize: 14,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },
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
  devButton: {
    padding: 10,
    backgroundColor: Colors.shadow,
    borderRadius: 8,
    alignItems: "center",
  },
  devButtonText: {
    fontSize: 12,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "600",
  },

  // Modal styles
  modalContainer: { flex: 1, backgroundColor: Colors.paper },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.shadow,
  },
  modalCancel: {
    fontSize: 16,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    minWidth: 60,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  modalContent: { flex: 1, padding: 16 },
  modalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  modalInput: {
    height: 50,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 8,
  },
  modalCharCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "right",
    marginTop: 4,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  saveButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  deleteModalButton: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  deleteModalText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
  },
  keyBox: {
    backgroundColor: Colors.card,
    borderWidth: 2,
    borderColor: Colors.ink,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  keyText: {
    fontSize: 15,
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
    justifyContent: "center",
    gap: 8,
    height: 44,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 10,
    marginBottom: 12,
  },
  copyButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  regenerateButton: {
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  regenerateButtonText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
});
