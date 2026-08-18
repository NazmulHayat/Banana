import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SettingsRow } from "@/components/ui/settings-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { keyring } from "@/lib/crypto";
import { supabase } from "@/lib/supabase";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Security & recovery — view recovery key, change password. These touch the
 * keyring + Supabase auth directly (the existing account-ops exception to the
 * store-only rule); the logic is unchanged from the original profile screen.
 */
export default function SecurityScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);

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
      // Re-derive KEK + unwrap master key — the only way to confirm the user
      // knows the encryption password (not just the Supabase password, which
      // can differ after a recovery flow).
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
      // Verify old password by re-deriving the encryption KEK (also proves the
      // user can decrypt their data — stronger than Supabase signIn).
      try {
        await keyring.unlock(user.id, oldPassword);
      } catch {
        Alert.alert("Incorrect password", "Your current password is wrong.");
        setChangePasswordLoading(false);
        return;
      }

      // CRITICAL ORDER: update Supabase password FIRST (recoverable via email
      // reset if it succeeds and the next step fails), THEN re-wrap encryption.
      const { error: upErr } = await supabase.auth.updateUser({ password: newPassword });
      if (upErr) {
        Alert.alert(
          "Password change failed",
          "Supabase could not update your password: " + upErr.message,
        );
        setChangePasswordLoading(false);
        return;
      }

      // Now re-wrap. If this fails, the user can sign in with the new Supabase
      // password and use "Change Password" again from here.
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

  return (
    <PaperBackground>
      <ScreenHeader title="Security & recovery" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 60 }}
      >
        <PaperCard style={styles.securityCard}>
          <View style={styles.securityHeader}>
            <IconSymbol name="lock.fill" size={20} color={Colors.ink} />
            <Text style={styles.securityTitle}>End-to-end encrypted</Text>
          </View>
          <Text style={styles.securityDesc}>
            Your journal text and habits are encrypted on this device before upload — only your
            password (or recovery key) can unlock them. Photo attachments are stored privately but
            not yet client-side encrypted in v1.
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
      </ScrollView>

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
          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
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
                {recoveryError ? <Text style={styles.errorText}>{recoveryError}</Text> : null}
                <TouchableOpacity
                  style={[styles.saveButton, recoveryLoading && styles.buttonDisabled]}
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
                  Keep this somewhere safe. If you forget your password, only this key can restore
                  access.
                </Text>
                <View style={styles.keyBox}>
                  <Text style={styles.keyText} selectable>
                    {recoveryKey}
                  </Text>
                </View>
                <TouchableOpacity style={styles.copyButton} onPress={handleCopyRecovery} activeOpacity={0.7}>
                  <IconSymbol name="doc.on.doc" size={16} color={Colors.ink} />
                  <Text style={styles.copyButtonText}>Copy to Clipboard</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.regenerateButton}
                  onPress={handleRegenerateRecoveryKey}
                  activeOpacity={0.7}
                >
                  <Text style={styles.regenerateButtonText}>Regenerate Recovery Key</Text>
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
            <TouchableOpacity onPress={() => setShowChangePasswordModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Change Password</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalDesc}>
              Your encryption master key will be re-wrapped with the new password.
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
              style={[styles.saveButton, changePasswordLoading && styles.buttonDisabled]}
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
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  securityCard: { padding: 14, marginTop: 8, marginBottom: 8 },
  securityHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  securityTitle: { fontSize: 15, fontWeight: "700", color: Colors.ink, fontFamily: Fonts.handwriting },
  securityDesc: { fontSize: 13, color: Colors.textSecondary, fontFamily: Fonts.handwriting, lineHeight: 18 },
  rowGroup: { paddingVertical: 4, paddingHorizontal: 18 },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(26, 26, 26, 0.08)",
    marginLeft: 38,
  },
  // modal
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
  modalCancel: { fontSize: 16, color: Colors.accent, fontFamily: Fonts.handwriting, minWidth: 60 },
  modalTitle: { fontSize: 17, fontWeight: "700", color: Colors.ink, fontFamily: Fonts.handwriting },
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
  errorText: { fontSize: 13, color: Colors.danger, fontFamily: Fonts.handwriting, marginBottom: 12 },
  saveButton: {
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { fontSize: 16, fontWeight: "600", color: Colors.paper, fontFamily: Fonts.handwriting },
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
  copyButtonText: { fontSize: 14, fontWeight: "600", color: Colors.ink, fontFamily: Fonts.handwriting },
  regenerateButton: { height: 44, borderRadius: 10, justifyContent: "center", alignItems: "center", backgroundColor: "transparent" },
  regenerateButtonText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: "underline",
  },
});
