import { Motion } from "@/constants/motion";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import type { WriteOutcome } from "@/lib/db";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeInUp,
  FadeOut,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { IconSymbol } from "./ui/icon-symbol";
import { PaperCard } from "./ui/paper-card";
import { PressableScale } from "./ui/pressable-scale";

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Approximate length of the checkmark polyline below (M4 12.5 L9.5 18 L20 6.5)
const CHECK_PATH_LENGTH = 24;

/** How long "Saved" stays on the button before it goes back to "Add". */
const SAVED_BEAT_MS = 1200;

/**
 * Character cap for one highlight. Same number the onboarding composer uses —
 * a highlight is a sentence or two, and the two composers must not disagree
 * about what fits.
 */
export const MAX_HIGHLIGHT_LENGTH = 500;

/** How many characters from the cap the counter appears. */
const COUNTER_VISIBLE_FROM = 60;

/** Checkmark that draws itself like a pen stroke. */
function DrawnCheckmark({ size = 20 }: { size?: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: Motion.base,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_PATH_LENGTH * (1 - progress.value),
  }));

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <AnimatedPath
        d="M4 12.5 L9.5 18 L20 6.5"
        stroke={Colors.paper}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${CHECK_PATH_LENGTH}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

interface HighlightInputProps {
  todayEntryCount: number;
  /**
   * Today's date, spelled the way the note under the title says it ("Aug 18").
   * A highlight ALWAYS lands on today — the grid above can be browsing any
   * month, so when it isn't the current one we say where the words are going
   * instead of quietly filing them somewhere else.
   */
  todayLabel: string;
  /** True when the grid above is showing a month other than the current one. */
  browsingOtherMonth?: boolean;
  /**
   * Called with text + locally-picked image URIs. Parent uploads + persists and
   * reports the outcome — it must not throw, so the composer can decide whether
   * it is safe to clear.
   */
  onSave: (text: string, localUris: string[]) => Promise<WriteOutcome>;
  /** True while parent is uploading + saving — disables the buttons. */
  saving?: boolean;
}

const MAX_IMAGES = 4;

export function HighlightInput({
  todayEntryCount,
  todayLabel,
  browsingOtherMonth,
  onSave,
  saving,
}: HighlightInputProps) {
  const [text, setText] = useState("");
  const [pickedUris, setPickedUris] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  // User-safe reason from the last failed save. Non-null keeps the retry row up.
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please grant photo library access in Settings to attach photos.",
      );
      return;
    }
    const remaining = MAX_IMAGES - pickedUris.length;
    const allowsMultiple = remaining > 1 && Platform.OS === "ios";
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: allowsMultiple,
      selectionLimit: allowsMultiple ? remaining : 1,
      quality: 0.8,
    });
    if (!result || result.canceled) return;
    const newUris = (result.assets ?? [])
      .map((a) => a.uri)
      .filter(Boolean) as string[];
    appendUris(newUris);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission needed",
        "Please grant camera access in Settings to take photos.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (!result || result.canceled) return;
    const newUris = (result.assets ?? [])
      .map((a) => a.uri)
      .filter(Boolean) as string[];
    appendUris(newUris);
  };

  const appendUris = (newUris: string[]) => {
    if (newUris.length === 0) return;
    const total = pickedUris.length + newUris.length;
    if (total > MAX_IMAGES) {
      Alert.alert(
        "Limit Reached",
        `Only the first ${MAX_IMAGES - pickedUris.length} will be added.`,
      );
      setPickedUris([
        ...pickedUris,
        ...newUris.slice(0, MAX_IMAGES - pickedUris.length),
      ]);
    } else {
      setPickedUris([...pickedUris, ...newUris]);
    }
  };

  const handleAddPhoto = () => {
    if (pickedUris.length >= MAX_IMAGES) {
      Alert.alert(
        "Limit reached",
        `You can only add up to ${MAX_IMAGES} photos per entry.`,
      );
      return;
    }
    setPickerOpen((open) => !open);
  };

  const handleRemovePhoto = (i: number) => {
    setPickedUris(pickedUris.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (saving || justSaved) return;
    const trimmed = text.trim();
    if (!trimmed && pickedUris.length === 0) return;
    setSaveError(null);

    const outcome = await onSave(trimmed, pickedUris);

    // The composer used to clear unconditionally, so a failed save silently ate
    // whatever the user had just written and every photo they'd picked. Now it
    // only clears once the write is durable: `synced` is on the server and
    // `queued` is in the pending-writes queue, which survives a restart and
    // replays on reconnect. On `failed` nothing is touched — text and photos
    // stay exactly where they were, with a retry right below.
    if (outcome.status === "failed") {
      setSaveError(outcome.reason);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setText("");
    setPickedUris([]);
    // Success beat: drawn checkmark + haptic, then back to "Add"
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJustSaved(true);
    savedTimer.current = setTimeout(() => setJustSaved(false), SAVED_BEAT_MS);
  };

  const nothingToSave = !text.trim() && pickedUris.length === 0;
  const saveDisabled = (nothingToSave || !!saving) && !justSaved;

  return (
    <PaperCard style={styles.container}>
      <Text style={styles.title}>Highlight of the day</Text>
      {/* Browsing March and typing here used to file the words under today
          with no warning. The grid stays back-fillable; the journal is
          today-only, so say which day this is. */}
      {browsingOtherMonth && (
        <Text style={styles.dateNote}>
          Saves to today, {todayLabel} — not the month you&apos;re viewing.
        </Text>
      )}
      {/* The hint is the TextInput's own placeholder, so it clears the moment
          you type. It used to be a sibling <Text> that sat there the whole
          time you were writing. */}
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={
          todayEntryCount === 0
            ? "Tell me something about today..."
            : "Add another highlight..."
        }
        multiline
        maxLength={MAX_HIGHLIGHT_LENGTH}
        placeholderTextColor={Colors.textSecondary}
        editable={!saving}
        accessibilityLabel={`Highlight for today, ${todayLabel}`}
      />
      {/* Silence at the cap reads as a broken keyboard — show the countdown,
          but only once it's close enough to matter. */}
      {text.length > MAX_HIGHLIGHT_LENGTH - COUNTER_VISIBLE_FROM && (
        <Text style={styles.counter} accessibilityLiveRegion="polite">
          {MAX_HIGHLIGHT_LENGTH - text.length} characters left
        </Text>
      )}
      {pickedUris.length > 0 && (
        <View style={styles.mediaPreviewContainer}>
          {pickedUris.map((uri, index) => (
            <View key={`${uri}-${index}`} style={styles.mediaPreview}>
              <Image
                source={{ uri }}
                style={styles.previewImage}
                resizeMode="cover"
              />
              {!saving && (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemovePhoto(index)}
                  activeOpacity={0.7}
                  // 20pt icon: hitSlop brings the target to the 44pt minimum.
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${index + 1} of ${pickedUris.length}`}
                >
                  <IconSymbol
                    name="xmark.circle.fill"
                    size={20}
                    color={Colors.ink}
                  />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
      <View style={styles.footer}>
        <View style={styles.mediaWrapper}>
          {pickerOpen && (
            <Animated.View
              entering={FadeInUp.duration(Motion.fast)}
              exiting={FadeOut.duration(Motion.quick)}
              style={styles.popover}
            >
              {/* Both rows were bare Pressables — no scale, no opacity, no
                  haptic. On the most-used menu in the app, that reads as a
                  dead tap. */}
              <PressableScale
                style={styles.popoverItem}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPickerOpen(false);
                  void takePhoto();
                }}
                accessibilityLabel="Take photo"
              >
                <View style={styles.popoverItemContent}>
                  <IconSymbol name="camera.fill" size={16} color={Colors.ink} />
                  <Text style={styles.popoverText}>Take Photo</Text>
                </View>
              </PressableScale>
              <View style={styles.popoverDivider} />
              <PressableScale
                style={styles.popoverItem}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPickerOpen(false);
                  void pickFromLibrary();
                }}
                accessibilityLabel="Choose from library"
              >
                <View style={styles.popoverItemContent}>
                  <IconSymbol name="photo.fill" size={16} color={Colors.ink} />
                  <Text style={styles.popoverText}>Choose from Library</Text>
                </View>
              </PressableScale>
              <View style={styles.popoverArrow} />
            </Animated.View>
          )}
          <PressableScale
            style={[
              styles.mediaButton,
              (pickedUris.length >= MAX_IMAGES || saving) &&
                styles.mediaButtonDisabled,
            ]}
            onPress={handleAddPhoto}
            disabled={pickedUris.length >= MAX_IMAGES || saving}
            accessibilityLabel={
              pickerOpen
                ? "Close photo picker"
                : `Add photo, ${pickedUris.length} of ${MAX_IMAGES} attached`
            }
          >
            <View style={styles.mediaButtonContent}>
              <IconSymbol
                name={pickerOpen ? "xmark" : "camera.fill"}
                size={18}
                color={
                  pickedUris.length >= MAX_IMAGES || saving
                    ? Colors.textSecondary
                    : Colors.ink
                }
              />
              <Text
                style={[
                  styles.mediaButtonText,
                  (pickedUris.length >= MAX_IMAGES || saving) &&
                    styles.mediaButtonTextDisabled,
                ]}
              >
                {pickerOpen ? "Close" : "Add Photo"}
                {!pickerOpen && pickedUris.length > 0
                  ? ` (${pickedUris.length}/${MAX_IMAGES})`
                  : ""}
              </Text>
            </View>
          </PressableScale>
        </View>
        <PressableScale
          style={[
            styles.saveButton,
            saveDisabled ? styles.saveButtonDisabled : null,
          ]}
          onPress={handleSave}
          disabled={saveDisabled}
          accessibilityLabel={
            justSaved
              ? "Highlight saved"
              : saving
                ? "Saving highlight"
                : saveError
                  ? "Save highlight, previous attempt failed"
                  : "Save highlight"
          }
          accessibilityState={{ busy: !!saving }}
        >
          <View style={styles.saveButtonContent}>
            {justSaved ? (
              <>
                <Text style={styles.saveButtonText}>Saved</Text>
                <DrawnCheckmark />
              </>
            ) : (
              <>
                <Text style={styles.saveButtonText}>
                  {saving ? "Saving..." : saveError ? "Try again" : "Add"}
                </Text>
                <IconSymbol
                  name="checkmark.circle.fill"
                  size={20}
                  color={Colors.paper}
                />
              </>
            )}
          </View>
        </PressableScale>
      </View>

      {/* Nothing was lost — say so plainly, in the same secondary ink as the
          privacy note. The primary button doubles as the retry. */}
      {saveError && !saving && (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>
            {saveError} Your words and photos are still here.
          </Text>
        </View>
      )}
      {/* Photos are NOT end-to-end encrypted in v1 (private Storage bucket
          only) — still disclosed, but only once a photo is actually attached.
          Standing on every empty composer it was permanent furniture on the
          home screen; it says nothing until there's a photo to say it about. */}
      {pickedUris.length > 0 && (
        <Text style={styles.privacyNote}>
          Photos are stored privately, but aren&apos;t encrypted yet.
        </Text>
      )}
    </PaperCard>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: 16, marginTop: 16, marginBottom: 16 },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.ink,
    marginBottom: 4,
    fontFamily: Fonts.handwriting,
  },
  dateNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
    fontFamily: Fonts.handwriting,
    fontStyle: "italic",
  },
  counter: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "right",
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    color: Colors.ink,
    minHeight: 60,
    fontFamily: Fonts.handwriting,
    // Keeps the old rhythm now that the hint lives inside the field rather
    // than as a line of its own above it.
    marginTop: 8,
    marginBottom: 12,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  privacyNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 16,
    marginTop: 12,
  },
  errorRow: {
    marginTop: 10,
  },
  errorText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    lineHeight: 16,
  },
  mediaPreviewContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
    gap: 8,
  },
  mediaPreview: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.shadow,
    position: "relative",
    marginRight: 8,
    marginBottom: 8,
  },
  previewImage: { width: "100%", height: "100%", borderRadius: 7 },
  removeButton: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: Colors.paper,
    borderRadius: 12,
  },
  mediaWrapper: {
    position: "relative",
  },
  mediaButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    backgroundColor: "transparent",
    justifyContent: "center",
  },
  mediaButtonDisabled: { borderColor: Colors.textSecondary, opacity: 0.35 },
  popover: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    marginBottom: 10,
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Hairline.raised,
    paddingVertical: 4,
    minWidth: 220,
    shadowColor: Colors.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 10,
  },
  popoverItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
    minHeight: 44,
  },
  popoverItemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  popoverText: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  popoverDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Hairline.popover,
    marginHorizontal: 8,
  },
  popoverArrow: {
    position: "absolute",
    bottom: -7,
    left: 24,
    width: 12,
    height: 12,
    backgroundColor: Colors.card,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: Hairline.raised,
    transform: [{ rotate: "45deg" }],
  },
  mediaButtonContent: { flexDirection: "row", alignItems: "center" },
  mediaButtonText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    fontWeight: "500",
    marginLeft: 6,
  },
  mediaButtonTextDisabled: { color: Colors.textSecondary },
  saveButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: Colors.ink,
    justifyContent: "center",
  },
  saveButtonDisabled: { opacity: 0.35 },
  saveButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 15,
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
    fontWeight: "700",
    marginRight: 8,
  },
});
