import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import type { EntryPlace } from "@/lib/db";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/** Long enough for a real place name, short enough to sit on one line. */
const HEADING_MAX = 60;
const ADDRESS_MAX = 140;

export interface PlaceEditorProps {
  /** The place being edited, or null when the sheet is closed. */
  place: EntryPlace | null;
  /** Whether "remember this name" is offered — false when already saved. */
  canRemember?: boolean;
  /**
   * The name this spot already has saved, if any. When the typed name matches
   * it there is nothing to remember, so the checkbox stays out of the way.
   */
  savedHeading?: string | null;
  /**
   * Save. `remember` asks for the heading to become this spot's preferred
   * name, so future entries here are called the same thing.
   */
  onSave: (next: EntryPlace, remember: boolean) => void;
  onCancel: () => void;
  /**
   * The write is in flight. The sheet stays open and inert until it lands, so
   * closing is proof the change actually happened rather than a guess.
   */
  saving?: boolean;
}

/**
 * Rename the place on an entry, and optionally teach the app that name.
 *
 * Two fields on purpose: the heading is what shows on the card, the address is
 * what tells two branches of the same chain apart. They start out saying
 * roughly the same thing because that's what the geocoder gives us — the point
 * is that you can shorten the heading to "Home" without losing the detail.
 */
export function PlaceEditor({
  place,
  canRemember = true,
  savedHeading = null,
  onSave,
  onCancel,
  saving = false,
}: PlaceEditorProps) {
  const [heading, setHeading] = useState("");
  const [address, setAddress] = useState("");
  const [remember, setRemember] = useState(true);

  // Re-seed each time the sheet opens on a different place.
  useEffect(() => {
    if (!place) return;
    setHeading(place.heading);
    setAddress(place.address);
    setRemember(true);
  }, [place]);

  if (!place) return null;

  const trimmedHeading = heading.trim();
  const canSave = trimmedHeading.length > 0;
  // Already called this? Then "call it this from now on" is a checkbox that
  // does nothing — it only earns its place once the name actually changes.
  const alreadyNamed = savedHeading !== null && savedHeading === trimmedHeading;
  const offerRemember = canRemember && !alreadyNamed;
  const canSubmit = canSave && !saving;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={saving ? undefined : onCancel}
        >
          {/* Swallow taps on the card so it doesn't dismiss underneath itself. */}
          <Pressable onPress={() => {}} style={styles.cardWrap}>
            <PaperCard style={styles.card}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.title}>Where was this?</Text>

                <Text style={styles.label}>Name</Text>
                <TextInput
                  value={heading}
                  onChangeText={setHeading}
                  editable={!saving}
                  maxLength={HEADING_MAX}
                  placeholder="Home"
                  placeholderTextColor={Colors.textSecondary}
                  style={styles.input}
                  accessibilityLabel="Place name"
                />
                <Text style={styles.hint}>
                  What shows on the entry.
                </Text>

                <Text style={[styles.label, styles.labelSpaced]}>Address</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  editable={!saving}
                  maxLength={ADDRESS_MAX}
                  multiline
                  placeholder="Street, city"
                  placeholderTextColor={Colors.textSecondary}
                  style={[styles.input, styles.inputMultiline]}
                  accessibilityLabel="Place address"
                />

                {offerRemember ? (
                  <Pressable
                    onPress={() => setRemember((r) => !r)}
                    disabled={saving}
                    style={styles.rememberRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: remember }}
                    accessibilityLabel="Remember this name for this place"
                  >
                    <View
                      style={[styles.checkbox, remember && styles.checkboxOn]}
                    >
                      {remember ? <Text style={styles.checkMark}>✓</Text> : null}
                    </View>
                    <Text style={styles.rememberText}>
                      Remember this name for next time
                    </Text>
                  </Pressable>
                ) : null}

                <View style={styles.actions}>
                  <PressableScale
                    style={[
                      styles.secondaryButton,
                      saving && styles.buttonOff,
                    ]}
                    disabled={saving}
                    onPress={onCancel}
                    accessibilityLabel="Cancel"
                  >
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </PressableScale>
                  <PressableScale
                    style={[
                      styles.primaryButton,
                      !canSubmit && styles.buttonOff,
                    ]}
                    disabled={!canSubmit}
                    onPress={() =>
                      onSave(
                        {
                          heading: trimmedHeading,
                          address: address.trim(),
                          latitude: place.latitude,
                          longitude: place.longitude,
                        },
                        offerRemember && remember,
                      )
                    }
                    accessibilityLabel="Save place"
                    accessibilityState={{ disabled: !canSubmit, busy: saving }}
                  >
                    {/* Same width either way, so the row doesn't twitch when
                        the label becomes a spinner. */}
                    {saving ? (
                      <ActivityIndicator size="small" color={Colors.paper} />
                    ) : (
                      <Text style={styles.primaryText}>Save</Text>
                    )}
                  </PressableScale>
                </View>
              </ScrollView>
            </PaperCard>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: Scrim.modal,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cardWrap: { width: "100%" },
  card: { maxHeight: "100%" },
  title: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 6,
  },
  labelSpaced: { marginTop: 16 },
  input: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    borderWidth: 1,
    borderColor: Hairline.raised,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  inputMultiline: { minHeight: 64, textAlignVertical: "top" },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 6,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: Colors.accent },
  checkMark: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  rememberText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 22,
  },
  secondaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  secondaryText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  primaryButton: {
    minWidth: 92,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: Colors.ink,
  },
  buttonOff: { opacity: 0.4 },
  primaryText: {
    fontSize: 14,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
});
