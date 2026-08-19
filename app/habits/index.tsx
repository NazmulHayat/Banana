import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import type { Habit } from "@/lib/db";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
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
 * Habit management — create, rename, delete. Big, obvious tap targets: tap a
 * habit row to rename, the trash icon to remove, and a prominent button to add.
 */
export default function HabitsScreen() {
  const insets = useSafeAreaInsets();
  const dataStore = useDataStore();
  const habits = dataStore.habits;

  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [habitName, setHabitName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Habit | null>(null);
  // Held while the edit sheet animates away, then promoted to `pendingDelete`
  // in the sheet's onDismiss. See handleDeleteHabit.
  const [deleteAfterDismiss, setDeleteAfterDismiss] = useState<Habit | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Failures speak inline, in the app's own voice — never a native Alert.
  // `formError` lives in the sheet, `listError` on the list behind it.
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const openModal = (habit?: Habit) => {
    setEditingHabit(habit ?? null);
    setHabitName(habit?.name ?? "");
    setFormError(null);
    setShowHabitModal(true);
  };

  const handleSaveHabit = async () => {
    const name = habitName.trim();
    if (!name) {
      setFormError("Give it a name first.");
      return;
    }
    if (name.length > 20) {
      setFormError("Twenty characters or fewer, please.");
      return;
    }
    let updated: Habit[];
    if (editingHabit) {
      updated = habits.map((h) => (h.id === editingHabit.id ? { ...h, name } : h));
    } else {
      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      updated = [...habits, { id, name, createdAt: new Date().toISOString() }];
    }
    dataStore.updateHabits(updated);
    setShowHabitModal(false);
    setEditingHabit(null);
    setHabitName("");
    setFormError(null);
    setListError(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The store never throws — `queued` is durable and replays on reconnect,
    // so only `failed` puts the old list back.
    const outcome = await dataStore.saveHabits(updated);
    if (outcome.status === "failed") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setListError(outcome.reason);
      await dataStore.refreshHabits();
    }
  };

  // Destructive confirmations go through ConfirmDialog (the app's own paper
  // dialog with haptics + a double-submit latch), never a native Alert.
  const handleDeleteHabit = (habit: Habit) => {
    setListError(null);
    // On iOS the edit sheet is a real UIKit page sheet. Dismissing it and
    // presenting the confirm dialog in the same batch means the dialog tries
    // to present while the sheet is still animating out — it arrives dead
    // (visible but ignoring taps) or never arrives at all. Park the habit and
    // let the sheet's onDismiss open the dialog once the presentation is
    // genuinely free.
    //
    // onDismiss is iOS-only, so Android — which has no such conflict — opens
    // the dialog directly.
    if (Platform.OS === "ios" && showHabitModal) {
      setDeleteAfterDismiss(habit);
      setShowHabitModal(false);
      return;
    }
    setShowHabitModal(false);
    setPendingDelete(habit);
  };

  const handleConfirmDelete = async () => {
    const habit = pendingDelete;
    if (!habit) return;
    setDeleting(true);
    const updated = habits.filter((h) => h.id !== habit.id);
    dataStore.updateHabits(updated);
    try {
      const outcome = await dataStore.saveHabits(updated);
      if (outcome.status === "failed") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setListError(outcome.reason);
        await dataStore.refreshHabits();
      }
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <PaperBackground>
      <ScreenHeader title="Habits" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
      >
        {listError ? (
          <Text style={styles.listError}>{listError}</Text>
        ) : null}

        {!dataStore.habitsReady && habits.length === 0 ? (
          <View
            style={styles.list}
            accessibilityLabel="Loading your habits"
          >
            <Text style={styles.intro}>Fetching your habits…</Text>
            <Skeleton width="100%" height={62} borderRadius={18} />
            <Skeleton width="100%" height={62} borderRadius={18} />
            <Skeleton width="100%" height={62} borderRadius={18} />
          </View>
        ) : habits.length > 0 ? (
          <>
            <Text style={styles.intro}>
              Tap a habit to rename it — or remove what you&apos;ve outgrown.
            </Text>

            <View style={styles.list}>
              {habits.map((habit) => (
                <PaperCard key={habit.id} style={styles.habitRow}>
                  <TouchableOpacity
                    style={styles.rowTap}
                    activeOpacity={0.6}
                    onPress={() => openModal(habit)}
                  >
                    <Text style={styles.habitName} numberOfLines={1}>
                      {habit.name}
                    </Text>
                    <View style={styles.renameHint}>
                      <IconSymbol name="pencil" size={14} color={Colors.textSecondary} />
                      <Text style={styles.renameText}>Rename</Text>
                    </View>
                  </TouchableOpacity>
                  <IconButton
                    onPress={() => handleDeleteHabit(habit)}
                    style={styles.trashBtn}
                    accessibilityLabel={`Delete habit ${habit.name}`}
                    accessibilityHint="Removes the habit and every day you ticked it"
                  >
                    <IconSymbol name="trash" size={20} color={Colors.danger} />
                  </IconButton>
                </PaperCard>
              ))}
            </View>

            <PressableScale style={styles.addButton} onPress={() => openModal()}>
              <IconSymbol name="plus" size={18} color={Colors.paper} />
              <Text style={styles.addButtonText}>Add a habit</Text>
            </PressableScale>
          </>
        ) : (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <IconSymbol name="sparkles" size={34} color={Colors.accent} />
            </View>
            <Text style={styles.emptyTitle}>No habits yet</Text>
            <Text style={styles.emptyHint}>Add your first habit to start tracking your streaks.</Text>
            <PressableScale style={styles.addButton} onPress={() => openModal()}>
              <IconSymbol name="plus" size={18} color={Colors.paper} />
              <Text style={styles.addButtonText}>Add your first habit</Text>
            </PressableScale>
          </View>
        )}
      </ScrollView>

      {/* ============ ADD / EDIT MODAL ============ */}
      <Modal
        visible={showHabitModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowHabitModal(false)}
        // Fires once the sheet is fully off-screen (iOS). Only now is it safe
        // to present the confirm dialog.
        onDismiss={() => {
          if (deleteAfterDismiss) {
            setPendingDelete(deleteAfterDismiss);
            setDeleteAfterDismiss(null);
          }
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          accessibilityViewIsModal
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setShowHabitModal(false)}
              activeOpacity={0.85}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle} accessibilityRole="header">{editingHabit ? "Edit habit" : "New habit"}</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.formLabel}>Habit name</Text>
            <TextInput
              style={styles.modalInput}
              value={habitName}
              onChangeText={setHabitName}
              placeholder="e.g. Exercise, Read, Meditate"
              placeholderTextColor={Colors.textSecondary}
              maxLength={20}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveHabit}
            />
            <Text style={styles.charCount}>{habitName.length}/20</Text>
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}

            <PressableScale
              style={styles.saveButton}
              onPress={handleSaveHabit}
              accessibilityLabel={editingHabit ? "Save changes" : "Add habit"}
            >
              <Text style={styles.saveButtonText}>
                {editingHabit ? "Save changes" : "Add habit"}
              </Text>
            </PressableScale>

            {editingHabit && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteHabit(editingHabit)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Delete habit ${editingHabit.name}`}
              >
                <IconSymbol name="trash" size={16} color={Colors.danger} />
                <Text style={styles.deleteButtonText}>Delete habit</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete habit?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" and its history will be removed. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteAfterDismiss(null);
        }}
      />
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 18,
  },
  list: { gap: 12 },
  listError: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
    marginTop: 10,
  },
  formError: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    lineHeight: 19,
    marginTop: 10,
  },
  habitRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  rowTap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  habitName: {
    flex: 1,
    fontSize: 18,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginRight: 12,
  },
  renameHint: { flexDirection: "row", alignItems: "center", gap: 4 },
  renameText: { fontSize: 12, color: Colors.textSecondary, fontFamily: Fonts.handwritingMedium },
  trashBtn: { marginLeft: 6 },
  // Add button (prominent)
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    backgroundColor: Colors.ink,
    borderRadius: 16,
    marginTop: 22,
  },
  addButtonText: { fontSize: 17, color: Colors.paper, fontFamily: Fonts.handwritingSemiBold },
  // Empty state
  emptyWrap: { alignItems: "center", paddingTop: 48, paddingHorizontal: 8 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: `${Colors.accent}26`,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 20, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold, marginBottom: 6 },
  emptyHint: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    lineHeight: 20,
    maxWidth: 260,
    marginBottom: 8,
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: Colors.paper },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Hairline.base,
  },
  modalCancel: { fontSize: 16, color: Colors.textSecondary, fontFamily: Fonts.handwritingMedium, minWidth: 60 },
  modalTitle: { fontSize: 19, color: Colors.ink, fontFamily: Fonts.handwritingSemiBold },
  modalContent: { flex: 1, padding: 20 },
  formLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingMedium,
    marginBottom: 10,
    marginTop: 8,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  modalInput: {
    height: 58,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 14,
    paddingHorizontal: 18,
    fontSize: 18,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
  },
  charCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "right",
    marginTop: 8,
  },
  saveButton: {
    height: 56,
    backgroundColor: Colors.ink,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 22,
  },
  saveButtonText: { fontSize: 17, color: Colors.paper, fontFamily: Fonts.handwritingSemiBold },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    marginTop: 14,
  },
  deleteButtonText: { fontSize: 16, color: Colors.danger, fontFamily: Fonts.handwritingSemiBold },
});
