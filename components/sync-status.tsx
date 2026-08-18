import { Colors, Fonts } from "@/constants/theme";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface SyncStatusProps {
  /**
   * Writes sitting in the durable retry queue — the store's
   * `pendingWriteCount`. Anything above zero means "saved locally, not yet on
   * the server."
   */
  pendingCount: number;
  /** True while a write is in flight. */
  syncing?: boolean;
  /** Set when the last write came back `failed`, i.e. the work is at risk. */
  failed?: boolean;
  /** Retry handler. Only reachable in the `failed` state. */
  onRetry?: () => void;
}

/**
 * One quiet line of sync truth for the Tracker.
 *
 * A journal shouldn't feel like a dashboard, so this is a single line of
 * secondary-ink handwriting — no badges, no colour alarm. The row is a fixed
 * height and always rendered, so moving between states never nudges the layout
 * underneath it.
 */
export function SyncStatus({
  pendingCount,
  syncing,
  failed,
  onRetry,
}: SyncStatusProps) {
  if (failed) {
    return (
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onRetry}
          activeOpacity={0.85}
          disabled={!onRetry}
          accessibilityRole="button"
          accessibilityLabel="Couldn't save. Tap to retry."
          accessibilityState={{ disabled: !onRetry }}
        >
          <Text style={[styles.label, !onRetry && styles.labelDisabled]}>
            Couldn&apos;t save · tap to retry
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const label = syncing
    ? "Syncing…"
    : pendingCount > 0
      ? "Waiting for connection"
      : "Saved";

  return (
    <View style={styles.row}>
      <Text
        style={styles.label}
        accessibilityRole="text"
        accessibilityLabel={`Sync status: ${label}`}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    // A floor rather than a fixed height: every state is still the same size
    // at normal text sizes (so the composer below never jumps), but at large
    // Dynamic Type the line grows instead of being clipped.
    minHeight: 18,
    justifyContent: "center",
    alignItems: "flex-end",
    marginHorizontal: 16,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  labelDisabled: {
    opacity: 0.5,
  },
});
