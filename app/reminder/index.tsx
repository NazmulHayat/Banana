import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SectionTitle } from "@/components/ui/settings-row";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import {
  DEFAULT_REMINDER,
  describeReminder,
  formatReminderTime,
  loadReminder,
  MAX_REMINDERS,
  MESSAGE_MAX_LENGTH,
  minutesOfDay,
  type ReminderPref,
  type ReminderStatus,
  type ReminderTime,
  reminderBody,
  requestReminderPermission,
  saveReminder,
  STANDARD_MESSAGE,
  syncReminder,
  tidyMessage,
  tidyTimes,
} from "@/lib/reminder";
import * as Haptics from "expo-haptics";
import { Href, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  type LayoutChangeEvent,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The time steps in 15-minute nudges — fine enough to matter, coarse enough to be one tap. */
const STEP_MINUTES = 15;
/** Guard on the collision walk below: 1440 / 15 slots in a day. */
const SLOTS_PER_DAY = 1440 / STEP_MINUTES;

/**
 * Wait for the keyboard's inset to land before scrolling to the field. Without
 * it the scroll runs against the old content size and stops short, leaving the
 * input under the keyboard — the exact thing it's there to prevent.
 */
const KEYBOARD_SETTLE_MS = 120;

/**
 * Where a second or third reminder lands by default: morning, midday, then
 * evening. Anything already taken is skipped, so "add" never produces a
 * duplicate the list would silently collapse.
 */
const NEW_TIME_CANDIDATES: ReminderTime[] = [
  { hour: 9, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 20, minute: 0 },
  { hour: 7, minute: 30 },
  { hour: 22, minute: 0 },
];

/**
 * Nudge one time, stepping over any slot another reminder already holds.
 * Without the walk, pressing + into a neighbour would make this row vanish
 * when the list de-duplicates.
 */
function stepTimeAt(
  times: ReminderTime[],
  index: number,
  direction: 1 | -1,
): ReminderTime[] {
  const taken = new Set(
    times.filter((_, i) => i !== index).map(minutesOfDay),
  );
  let minutes = minutesOfDay(times[index]);
  for (let guard = 0; guard < SLOTS_PER_DAY; guard++) {
    minutes = (minutes + direction * STEP_MINUTES + 1440) % 1440;
    if (!taken.has(minutes)) break;
  }
  const next = times.map((t, i) =>
    i === index
      ? { hour: Math.floor(minutes / 60), minute: minutes % 60 }
      : t,
  );
  // Sorted, so the list always reads earliest-first even mid-edit.
  return tidyTimes(next);
}

function addTime(times: ReminderTime[]): ReminderTime[] {
  const taken = new Set(times.map(minutesOfDay));
  for (const candidate of NEW_TIME_CANDIDATES) {
    if (!taken.has(minutesOfDay(candidate))) {
      return tidyTimes([...times, candidate]);
    }
  }
  for (let m = 0; m < 1440; m += STEP_MINUTES) {
    if (!taken.has(m)) {
      return tidyTimes([
        ...times,
        { hour: Math.floor(m / 60), minute: m % 60 },
      ]);
    }
  }
  return times;
}

/**
 * Reminders (FR-N1). Off until asked for, up to three times a day, local to
 * this device. The copy is the app's own by default and yours if you'd rather.
 */
export default function ReminderScreen() {
  const insets = useSafeAreaInsets();
  const dataStore = useDataStore();
  const hasHabits = dataStore.habits.length > 0;

  const [pref, setPref] = useState<ReminderPref | null>(null);
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  // The message is edited locally and saved on demand: rescheduling three
  // notifications on every keystroke would be absurd, and an explicit Save
  // means you can see the change land.
  const [messageDraft, setMessageDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  /** Y of the "What it says" card inside the scroll content. */
  const editorY = useRef(0);

  // Load the saved preference, then reconcile the OS with it — a reminder can
  // be revoked in Settings while the app is closed, so what's on disk is only
  // an intention until the system agrees.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadReminder();
      if (cancelled) return;
      setPref(saved);
      setMessageDraft(saved.message ?? "");
      const result = await syncReminder(saved, hasHabits);
      if (!cancelled) setStatus(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHabits]);

  const apply = async (next: ReminderPref) => {
    setPref(next);
    saveReminder(next);
    setStatus(await syncReminder(next, hasHabits));
  };

  const handleToggle = async (on: boolean) => {
    if (!pref) return;
    if (!on) {
      await apply({ ...pref, enabled: false });
      return;
    }
    // Only ever ask at the moment someone asks to be reminded.
    const granted = await requestReminderPermission();
    if (!granted) {
      // Leave the switch off — a control that says "on" while nothing is
      // scheduled is a lie. The explainer below says why.
      await apply({ ...pref, enabled: false });
      setStatus("denied");
      return;
    }
    await apply({ ...pref, enabled: true });
  };

  /** Empty, or the standard copy typed out by hand, both mean "use standard". */
  const draftAsMessage = (): string | null => {
    const tidied = tidyMessage(messageDraft);
    return tidied.length === 0 || tidied === STANDARD_MESSAGE ? null : tidied;
  };

  const saveMessage = () => {
    if (!pref) return;
    const next = draftAsMessage();
    setMessageDraft(next ?? "");
    Keyboard.dismiss();
    if (next === pref.message) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void apply({ ...pref, message: next });
  };

  // The keyboard covers the bottom half of the screen, so bring the field up
  // to meet it rather than leaving you typing blind.
  const handleMessageFocus = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(editorY.current - 16, 0),
        animated: true,
      });
    }, KEYBOARD_SETTLE_MS);
  };

  const current = pref ?? DEFAULT_REMINDER;
  const editable = current.enabled && status === "scheduled";
  const canAdd = editable && current.times.length < MAX_REMINDERS;
  const usingStandard = current.message === null;
  const dirty = pref !== null && draftAsMessage() !== pref.message;

  return (
    <PaperBackground>
      <ScreenHeader title="Daily reminder" />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Gives the content somewhere to scroll to once the keyboard is up.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <View style={styles.section}>
          <PaperCard style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.rowTitle}>Remind me</Text>
                <Text style={styles.rowSubtitle}>
                  {status === "scheduled" ? describeReminder(current) : "Off"}
                </Text>
              </View>
              <Switch
                value={current.enabled}
                onValueChange={(on) => void handleToggle(on)}
                disabled={pref === null || !hasHabits}
                trackColor={{ false: Hairline.wash, true: Colors.accent }}
                thumbColor={Colors.card}
                ios_backgroundColor={Hairline.wash}
                accessibilityLabel="Daily reminder"
                accessibilityHint="Schedules gentle notifications on this device"
              />
            </View>

            {current.times.map((time, index) => {
              const label = formatReminderTime(time.hour, time.minute);
              return (
                <View key={minutesOfDay(time)}>
                  <View style={styles.divider} />
                  <View style={styles.timeRow}>
                    <Text
                      style={[styles.rowTitle, !editable && styles.muted]}
                      accessibilityLabel={`Reminder ${index + 1}, ${label}`}
                    >
                      {label}
                    </Text>
                    <View style={styles.stepper}>
                      <IconButton
                        size={40}
                        disabled={!editable}
                        onPress={() =>
                          void apply({
                            ...current,
                            times: stepTimeAt(current.times, index, -1),
                          })
                        }
                        accessibilityLabel={`Move ${label} earlier`}
                      >
                        <IconSymbol name="minus" size={18} color={Colors.ink} />
                      </IconButton>
                      <IconButton
                        size={40}
                        disabled={!editable}
                        onPress={() =>
                          void apply({
                            ...current,
                            times: stepTimeAt(current.times, index, 1),
                          })
                        }
                        accessibilityLabel={`Move ${label} later`}
                      >
                        <IconSymbol name="plus" size={18} color={Colors.ink} />
                      </IconButton>
                      {/* The last remaining time can't be removed — that's what
                          the switch above is for. */}
                      {current.times.length > 1 ? (
                        <IconButton
                          size={40}
                          disabled={!editable}
                          onPress={() =>
                            void apply({
                              ...current,
                              times: current.times.filter((_, i) => i !== index),
                            })
                          }
                          accessibilityLabel={`Remove the ${label} reminder`}
                        >
                          <IconSymbol
                            name="trash"
                            size={16}
                            color={Colors.textSecondary}
                          />
                        </IconButton>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })}

            <View style={styles.divider} />
            <View style={styles.addRow}>
              <PressableScale
                containerStyle={styles.selfStart}
                disabled={!canAdd}
                onPress={() =>
                  void apply({ ...current, times: addTime(current.times) })
                }
                style={[styles.addButton, !canAdd && styles.addButtonOff]}
                accessibilityLabel="Add another time"
                accessibilityHint={
                  current.times.length >= MAX_REMINDERS
                    ? `Three a day is the most this app will send`
                    : undefined
                }
              >
                <Text
                  style={[styles.addButtonText, !canAdd && styles.muted]}
                >
                  {current.times.length >= MAX_REMINDERS
                    ? "Three a day is the most"
                    : "Add another time"}
                </Text>
              </PressableScale>
            </View>
          </PaperCard>
        </View>

        {/* Why nothing is scheduled — calm, specific, never blaming. */}
        {!hasHabits ? (
          <View style={styles.section}>
            <PaperCard style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                There&apos;s nothing to come back to yet. Add a habit and the
                reminder will be here waiting.
              </Text>
              <PressableScale
                containerStyle={styles.selfStart}
                style={styles.noticeButton}
                onPress={() => router.push("/habits" as Href)}
                accessibilityLabel="Add a habit"
              >
                <Text style={styles.noticeButtonText}>Add a habit</Text>
              </PressableScale>
            </PaperCard>
          </View>
        ) : status === "denied" ? (
          <View style={styles.section}>
            <PaperCard style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                Notifications are turned off for Aight Bet in your phone&apos;s
                settings. You can turn them on whenever you like — nothing here
                depends on it.
              </Text>
              <PressableScale
                containerStyle={styles.selfStart}
                style={styles.noticeButton}
                onPress={() => void Linking.openSettings()}
                accessibilityLabel="Open Settings"
                accessibilityHint="Opens Aight Bet's notification settings"
              >
                <Text style={styles.noticeButtonText}>Open Settings</Text>
              </PressableScale>
            </PaperCard>
          </View>
        ) : null}

        <View
          style={styles.section}
          onLayout={(e: LayoutChangeEvent) => {
            editorY.current = e.nativeEvent.layout.y;
          }}
        >
          <SectionTitle>What it says</SectionTitle>
          <PaperCard style={styles.card}>
            <Text style={styles.preview}>{reminderBody(current)}</Text>
            <Text style={styles.previewNote}>
              {usingStandard
                ? "The standard nudge. No streak counts, no habit names, no catching up on what you missed."
                : "Your own words, sent exactly as written."}
            </Text>

            <View style={styles.divider} />

            <View style={styles.editorBlock}>
              <Text style={styles.editorLabel}>Write your own</Text>
              <TextInput
                value={messageDraft}
                onChangeText={setMessageDraft}
                onFocus={handleMessageFocus}
                onSubmitEditing={saveMessage}
                placeholder={STANDARD_MESSAGE}
                placeholderTextColor={Colors.textSecondary}
                maxLength={MESSAGE_MAX_LENGTH}
                returnKeyType="done"
                style={styles.input}
                accessibilityLabel="Custom reminder message"
                accessibilityHint="Leave empty to use the standard message"
              />
              <View style={styles.editorFooter}>
                {/* It lands on a lock screen, so say so before they type
                    something they'd rather nobody read over their shoulder. */}
                <Text style={styles.editorHint}>
                  Shows on your lock screen.
                </Text>
                <Text style={styles.editorCount}>
                  {tidyMessage(messageDraft).length}/{MESSAGE_MAX_LENGTH}
                </Text>
              </View>
              {/* Save while there's an unsaved edit; otherwise the way back to
                  the standard copy. Never both — one action per state. */}
              {dirty ? (
                <PressableScale
                  containerStyle={styles.selfStart}
                  style={styles.saveButton}
                  onPress={saveMessage}
                  accessibilityLabel="Save this message"
                >
                  <Text style={styles.saveButtonText}>Save</Text>
                </PressableScale>
              ) : !usingStandard ? (
                <PressableScale
                  containerStyle={styles.selfStart}
                  style={styles.resetButton}
                  onPress={() => {
                    setMessageDraft("");
                    Keyboard.dismiss();
                    void apply({ ...current, message: null });
                  }}
                  accessibilityLabel="Use the standard message"
                >
                  <Text style={styles.resetButtonText}>
                    Use the standard one
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </PaperCard>
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  /**
   * Goes on PressableScale's `containerStyle`, never its `style`.
   * `style` lands on the inner animated view, so shrinking the
   * button there leaves the outer Pressable stretched full width —
   * a tap target far wider than anything the user can see.
   */
  selfStart: { alignSelf: "flex-start" },
  section: { marginBottom: 22 },
  card: { paddingHorizontal: 18, paddingVertical: 6 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  toggleText: { flex: 1, paddingRight: 12 },
  rowTitle: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  rowSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
  muted: { color: Colors.textSecondary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Hairline.base },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2 },
  addRow: { paddingVertical: 12 },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  addButtonOff: { borderColor: Hairline.raised, opacity: 0.6 },
  addButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  noticeCard: { paddingHorizontal: 18, paddingVertical: 18 },
  noticeText: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  noticeButton: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  noticeButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  preview: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    paddingTop: 14,
  },
  previewNote: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
    marginBottom: 14,
  },
  editorBlock: { paddingTop: 14, paddingBottom: 16 },
  editorLabel: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 8,
  },
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
  editorFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  editorHint: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  editorCount: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  saveButton: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.ink,
  },
  saveButtonText: {
    fontSize: 14,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  resetButton: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  resetButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
});
