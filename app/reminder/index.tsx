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
  formatReminderTime,
  loadReminder,
  type ReminderPref,
  type ReminderStatus,
  requestReminderPermission,
  saveReminder,
  syncReminder,
} from "@/lib/reminder";
import { Href, router } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The time steps in 15-minute nudges — fine enough to matter, coarse enough to be one tap. */
const STEP_MINUTES = 15;

function step(pref: ReminderPref, direction: 1 | -1): ReminderPref {
  const total = (pref.hour * 60 + pref.minute + direction * STEP_MINUTES + 1440) % 1440;
  return { ...pref, hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * The one reminder setting (FR-N1). Off until asked for, one time a day, local
 * to this device. Deliberately small: a switch, a time, and honest copy about
 * what it will and won't do.
 */
export default function ReminderScreen() {
  const insets = useSafeAreaInsets();
  const dataStore = useDataStore();
  const hasHabits = dataStore.habits.length > 0;

  const [pref, setPref] = useState<ReminderPref | null>(null);
  const [status, setStatus] = useState<ReminderStatus | null>(null);

  // Load the saved preference, then reconcile the OS with it — a reminder can
  // be revoked in Settings while the app is closed, so what's on disk is only
  // an intention until the system agrees.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadReminder();
      if (cancelled) return;
      setPref(saved);
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

  const current = pref ?? DEFAULT_REMINDER;
  const timeLabel = formatReminderTime(current.hour, current.minute);
  const timeEditable = current.enabled && status === "scheduled";

  return (
    <PaperBackground>
      <ScreenHeader title="Daily reminder" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text style={styles.intro}>
          One quiet nudge a day, scheduled on this device. It never leaves your
          phone, and it never mentions what you wrote or how you&apos;re doing.
        </Text>

        <View style={styles.section}>
          <PaperCard style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.rowTitle}>Remind me</Text>
                <Text style={styles.rowSubtitle}>
                  {status === "scheduled"
                    ? `Every day at ${timeLabel}`
                    : "Off"}
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
                accessibilityHint="Schedules one gentle notification a day on this device"
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.timeRow}>
              <Text
                style={[styles.rowTitle, !timeEditable && styles.muted]}
                accessibilityLabel={`Reminder time, ${timeLabel}`}
              >
                {timeLabel}
              </Text>
              <View style={styles.stepper}>
                <IconButton
                  size={44}
                  disabled={!timeEditable}
                  onPress={() => void apply(step(current, -1))}
                  accessibilityLabel="Earlier"
                  accessibilityHint={`Moves the reminder ${STEP_MINUTES} minutes earlier`}
                >
                  <IconSymbol name="minus" size={18} color={Colors.ink} />
                </IconButton>
                <IconButton
                  size={44}
                  disabled={!timeEditable}
                  onPress={() => void apply(step(current, 1))}
                  accessibilityLabel="Later"
                  accessibilityHint={`Moves the reminder ${STEP_MINUTES} minutes later`}
                >
                  <IconSymbol name="plus" size={18} color={Colors.ink} />
                </IconButton>
              </View>
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

        <View style={styles.section}>
          <SectionTitle>What it says</SectionTitle>
          <PaperCard style={styles.card}>
            <Text style={styles.preview}>
              A quiet minute for today, whenever you&apos;re ready.
            </Text>
            <Text style={styles.previewNote}>
              Always this, word for word. No streak counts, no habit names, no
              catching up on what you missed.
            </Text>
          </PaperCard>
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
    marginBottom: 20,
  },
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
    paddingVertical: 6,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  noticeCard: { paddingHorizontal: 18, paddingVertical: 18 },
  noticeText: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  noticeButton: {
    marginTop: 14,
    alignSelf: "flex-start",
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
    paddingBottom: 16,
  },
});
