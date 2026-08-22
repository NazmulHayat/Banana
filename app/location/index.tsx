import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SectionTitle } from "@/components/ui/settings-row";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useDataStore } from "@/lib/data-store";
import { PlaceEditor } from "@/components/place-editor";
import type { EntryPlace, SavedPlace } from "@/lib/db";
import {
  hasLocationPermission,
  loadLocationPref,
  requestLocationPermission,
  saveLocationPref,
} from "@/lib/location";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Manage → Location. Off until asked for. Turning it on tags new entries with
 * the name of where they were written, and this is also where the names you've
 * given places live, so you can forget them.
 */
export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const { places, placesReady, loadPlaces, savePlaces } = useDataStore();

  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedPlace | null>(null);
  const [editing, setEditing] = useState<SavedPlace | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pref = await loadLocationPref();
      if (cancelled) return;
      // On disk it's an intention; the OS has the final say, and permission
      // can be revoked in Settings while the app is closed.
      const granted = pref.enabled ? await hasLocationPermission() : false;
      if (cancelled) return;
      setEnabled(pref.enabled && granted);
      setDenied(pref.enabled && !granted);
      setReady(true);
      await loadPlaces();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlaces]);

  const handleToggle = async (on: boolean) => {
    if (!on) {
      setEnabled(false);
      setDenied(false);
      saveLocationPref({ enabled: false });
      return;
    }
    // Only ever ask at the moment someone asks for the feature.
    const granted = await requestLocationPermission();
    if (!granted) {
      // Leave it off — a switch that says "on" while nothing is tagged is a lie.
      setEnabled(false);
      setDenied(true);
      saveLocationPref({ enabled: false });
      return;
    }
    setEnabled(true);
    setDenied(false);
    saveLocationPref({ enabled: true });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  /**
   * Rename a saved place. Nothing else has to be touched: entries resolve
   * their label against this list at render time, so every entry here is
   * relabelled the moment this write lands.
   */
  const renamePlace = async (next: EntryPlace) => {
    const target = editing;
    if (!target) return;
    setSavingPlace(true);
    let failed = false;
    try {
      const outcome = await savePlaces(
        places.map((p) =>
          p.id === target.id
            ? { ...p, heading: next.heading, address: next.address }
            : p,
        ),
      );
      failed = outcome.status === "failed";
    } finally {
      setSavingPlace(false);
    }
    if (failed) {
      // Keep the sheet open on failure: closing it would read as success.
      setSaveError("Couldn't rename that place. Try again in a moment.");
      return;
    }
    setSaveError(null);
    setEditing(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const forgetPlace = async (place: SavedPlace) => {
    setForgetting(true);
    let failed = false;
    try {
      const outcome = await savePlaces(places.filter((p) => p.id !== place.id));
      failed = outcome.status === "failed";
    } finally {
      setForgetting(false);
    }
    if (failed) {
      // Keep the dialog up on failure — dismissing it would read as done.
      setSaveError("Couldn't forget that place. Try again in a moment.");
      return;
    }
    setSaveError(null);
    setPendingDelete(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <PaperBackground>
      <ScreenHeader title="Location" />
      <ScrollView
        showsVerticalScrollIndicator={false}
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
                <Text style={styles.rowTitle}>Auto location</Text>
                <Text style={styles.rowSubtitle}>
                  {enabled
                    ? "New entries get the name of the place"
                    : "Off — entries are untagged"}
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(on) => void handleToggle(on)}
                disabled={!ready}
                trackColor={{ false: Hairline.wash, true: Colors.accent }}
                thumbColor={Colors.card}
                ios_backgroundColor={Hairline.wash}
                accessibilityLabel="Tag entries with where you wrote them"
              />
            </View>
          </PaperCard>

          <Text style={styles.footnote}>
            Only checked while you&apos;re writing. The tag is encrypted with
            your entry.
          </Text>
        </View>

        {denied ? (
          <View style={styles.section}>
            <PaperCard style={styles.noticeCard}>
              <Text style={styles.noticeText}>
                Location is turned off for Aight Bet in your phone&apos;s
                settings. You can turn it on whenever you like — nothing here
                depends on it.
              </Text>
              <PressableScale
                containerStyle={styles.selfStart}
                style={styles.noticeButton}
                onPress={() => void Linking.openSettings()}
                accessibilityLabel="Open Settings"
              >
                <Text style={styles.noticeButtonText}>Open Settings</Text>
              </PressableScale>
            </PaperCard>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionTitle>Your names for places</SectionTitle>
          <PaperCard style={styles.card}>
            {!placesReady ? (
              /* Never claim "nothing named yet" before the list has loaded —
                 that empty state is a statement of fact, not a placeholder. */
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={Colors.ink} />
              </View>
            ) : places.length === 0 ? (
              <Text style={styles.emptyText}>
                Nothing named yet. Tap the place on an entry to rename it, and
                it&apos;ll be remembered here.
              </Text>
            ) : (
              places.map((place, index) => (
                <View key={place.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.placeRow}>
                    <View style={styles.placeText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {place.heading}
                      </Text>
                      <Text style={styles.rowSubtitle} numberOfLines={1}>
                        {place.address}
                      </Text>
                    </View>
                    <IconButton
                      size={40}
                      onPress={() => setEditing(place)}
                      accessibilityLabel={`Rename ${place.heading}`}
                      accessibilityHint="Renaming updates every entry at this place"
                    >
                      <IconSymbol
                        name="pencil"
                        size={16}
                        color={Colors.textSecondary}
                      />
                    </IconButton>
                    <IconButton
                      size={40}
                      onPress={() => setPendingDelete(place)}
                      accessibilityLabel={`Forget ${place.heading}`}
                    >
                      <IconSymbol
                        name="trash"
                        size={16}
                        color={Colors.textSecondary}
                      />
                    </IconButton>
                  </View>
                </View>
              ))
            )}
          </PaperCard>
          {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
        </View>
      </ScrollView>

      {/* `canRemember` off: this list IS the remembered name, so offering to
          remember it again would be a checkbox that does nothing. */}
      <PlaceEditor
        place={
          editing
            ? {
                heading: editing.heading,
                address: editing.address,
                latitude: editing.latitude,
                longitude: editing.longitude,
              }
            : null
        }
        canRemember={false}
        onSave={(next) => void renamePlace(next)}
        onCancel={() => setEditing(null)}
        saving={savingPlace}
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={`Forget "${pendingDelete?.heading ?? ""}"?`}
        message="Entries you've already written keep the name they were given. Only future ones change."
        confirmLabel="Forget"
        destructive
        loading={forgetting}
        onConfirm={() => {
          if (pendingDelete) void forgetPlace(pendingDelete);
        }}
        onCancel={() => {
          if (forgetting) return;
          setPendingDelete(null);
        }}
      />
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
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
    marginHorizontal: 4,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Hairline.base },
  placeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  placeText: { flex: 1, paddingRight: 12 },
  loadingRow: { paddingVertical: 22, alignItems: "center" },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    paddingVertical: 16,
  },
  errorText: {
    fontSize: 13,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    marginTop: 10,
    marginHorizontal: 4,
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
});
