import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts, Scrim } from "@/constants/theme";
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
        {/* Tap-outside-to-cancel. Deliberately NOT an accessibility element:
            giving the backdrop a button role made it an a11y container that
            absorbed its own children, so VoiceOver announced one "Dismiss"
            button and never reached Cancel or Delete inside it. Sighted taps
            are unaffected either way — the innermost pressable wins the
            responder — but the dialog was unusable with VoiceOver on.
            Cancel is the accessible way out; onRequestClose covers hardware
            back and the Esc key. */}
        <Pressable
          style={styles.backdrop}
          onPress={handleCancel}
          accessible={false}
          importantForAccessibility="no"
        >
          {/* Inner Pressable swallows taps so pressing the card doesn't cancel.
              This is where VoiceOver gets trapped instead. */}
          <Pressable onPress={() => {}} accessibilityViewIsModal style={styles.cardHolder}>
            <PaperCard style={styles.card}>
              <Text style={styles.title} accessibilityRole="header">
                {title}
              </Text>
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
                  containerStyle={styles.buttonSlot}
                  style={[styles.button, styles.cancelButton]}
                  accessibilityLabel={cancelLabel}
                  accessibilityHint="Closes without making the change"
                >
                  <Text style={[styles.cancelLabel, loading && styles.disabled]}>
                    {cancelLabel}
                  </Text>
                </PressableScale>

                <PressableScale
                  onPress={handleConfirm}
                  disabled={loading || !phraseSatisfied}
                  containerStyle={styles.buttonSlot}
                  style={[
                    styles.button,
                    styles.confirmButton,
                    { backgroundColor: confirmColor, borderColor: confirmColor },
                    (loading || !phraseSatisfied) && styles.disabled,
                  ]}
                  accessibilityLabel={loading ? `${confirmLabel}, working` : confirmLabel}
                  accessibilityHint={
                    confirmPhrase && !phraseSatisfied
                      ? `Type ${confirmPhrase} above to enable this`
                      : title
                  }
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
    backgroundColor: Scrim.modal,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  // The holder carries the width so the card's `100%` has something definite
  // to resolve against — an auto-sized parent makes that percentage undefined.
  cardHolder: { width: "100%", maxWidth: 360 },
  card: {
    width: "100%",
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
  // `flex` belongs on the Pressable (containerStyle); everything painted
  // belongs on the inner animated view (style). Splitting them is what makes
  // the row divide evenly instead of collapsing.
  buttonSlot: { flex: 1 },
  button: {
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
