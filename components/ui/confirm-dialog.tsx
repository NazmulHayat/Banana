import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const handleConfirm = () => {
    if (loading) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onConfirm();
  };

  const handleCancel = () => {
    if (loading) return;
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
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        {/* Inner Pressable swallows taps so pressing the card doesn't cancel. */}
        <Pressable onPress={() => {}}>
          <PaperCard style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}

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
                disabled={loading}
                style={[
                  styles.button,
                  styles.confirmButton,
                  { backgroundColor: confirmColor, borderColor: confirmColor },
                  loading && styles.disabled,
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
    </Modal>
  );
}

const styles = StyleSheet.create({
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
