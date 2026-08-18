import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export interface ConfirmDialogProps {
  /** Controls visibility. */
  visible: boolean;
  /** Bold heading, e.g. "Delete habit?". */
  title: string;
  /** Optional supporting line under the title. */
  message?: string;
  /** Confirm button label. Default "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Default "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as destructive (danger color). Default true. */
  destructive?: boolean;
  /** When true, confirm shows a spinner + both buttons disable (async in progress). */
  loading?: boolean;
  /**
   * Type-to-confirm guard for the gravest actions (account deletion): the
   * confirm button stays disabled until the user types this word. Matched
   * case-insensitively after trimming. Omit for a normal confirm.
   */
  confirmPhrase?: string;
  /** Called when the user confirms. Parent owns the async work + the `loading` flag. */
  onConfirm: () => void;
  /** Called on cancel or backdrop press. */
  onCancel: () => void;
}

/**
 * Confirmation dialog for destructive actions (delete habit/entry, account
 * deletion, sign out). Backdrop press cancels; confirm fires a warning haptic.
 * Parent owns the async work and toggles `loading` to disable both buttons.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  loading = false,
  confirmPhrase,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  // Type-to-confirm text. Cleared every time the dialog closes so a re-open
  // always starts from an unarmed confirm button.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!visible) setTyped("");
  }, [visible]);

  const phraseSatisfied =
    !confirmPhrase ||
    typed.trim().toLocaleUpperCase() === confirmPhrase.toLocaleUpperCase();

  // Guard against a double-submit: a second tap can land before the parent's
  // `loading` flag propagates back as a prop, so we latch synchronously here.
  // Reset whenever the dialog closes or `loading` clears (e.g. a failed action
  // that keeps the dialog open), so a legitimate retry is still allowed.
  const submittingRef = useRef(false);
  useEffect(() => {
    if (!visible || !loading) submittingRef.current = false;
  }, [visible, loading]);

  const handleConfirm = () => {
    if (loading || submittingRef.current || !phraseSatisfied) return;
    submittingRef.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onConfirm();
  };

  const handleCancel = () => {
    if (loading || submittingRef.current) return;
    onCancel();
  };

  const confirmColor = destructive ? Colors.danger : Colors.ink;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel}>
          {/* Inner Pressable swallows taps so pressing the card doesn't cancel. */}
          <Pressable onPress={() => {}}>
            <PaperCard style={styles.card}>
              <Text style={styles.title}>{title}</Text>
              {message ? <Text style={styles.message}>{message}</Text> : null}

              {confirmPhrase ? (
                <TextInput
                  style={styles.input}
                  value={typed}
                  onChangeText={setTyped}
                  placeholder={confirmPhrase}
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  editable={!loading}
                  accessibilityLabel={`Type ${confirmPhrase} to confirm`}
                />
              ) : null}

              <View style={styles.buttonRow}>
                <PressableScale
                  onPress={handleCancel}
                  disabled={loading}
                  style={[styles.button, styles.cancelButton]}
                >
                  <Text style={[styles.cancelLabel, loading && styles.disabled]}>
                    {cancelLabel}
                  </Text>
                </PressableScale>

                <PressableScale
                  onPress={handleConfirm}
                  disabled={loading || !phraseSatisfied}
                  style={[
                    styles.button,
                    styles.confirmButton,
                    { backgroundColor: confirmColor, borderColor: confirmColor },
                    (loading || !phraseSatisfied) && styles.disabled,
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.card} />
                  ) : (
                    <Text style={styles.confirmLabel}>{confirmLabel}</Text>
                  )}
                </PressableScale>
              </View>
            </PaperCard>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    // Darker overlay alpha is acceptable for a modal scrim (established
    // rgba(26,26,26,…) ink-overlay convention).
    backgroundColor: "rgba(26,26,26,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  card: {
    width: "100%",
    maxWidth: 360,
  },
  title: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 20,
    color: Colors.ink,
  },
  message: {
    fontFamily: Fonts.handwriting,
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 8,
    lineHeight: 22,
  },
  input: {
    marginTop: 16,
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: Fonts.handwriting,
    fontSize: 16,
    color: Colors.ink,
    backgroundColor: Colors.card,
  },
  buttonRow: {
    flexDirection: "row",
    marginTop: 24,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  cancelButton: {
    backgroundColor: Colors.card,
    borderColor: Colors.ink,
  },
  cancelLabel: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 16,
    color: Colors.ink,
  },
  confirmButton: {
    // backgroundColor + borderColor injected inline from the danger/ink token.
  },
  confirmLabel: {
    fontFamily: Fonts.handwritingSemiBold,
    fontSize: 16,
    color: Colors.card,
  },
  disabled: {
    opacity: 0.5,
  },
});
