import { Motion } from "@/constants/motion";
import { Colors, Fonts } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
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

/** Checkmark that draws itself like a pen stroke. */
function DrawnCheckmark({ size = 20 }: { size?: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: 300,
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
  /** Called with text + locally-picked image URIs. Parent uploads + persists. */
  onSave: (text: string, localUris: string[]) => Promise<void> | void;
  /** True while parent is uploading + saving — disables the buttons. */
  saving?: boolean;
}

const MAX_IMAGES = 4;

export function HighlightInput({
  todayEntryCount,
  onSave,
  saving,
}: HighlightInputProps) {
  const [text, setText] = useState("");
  const [pickedUris, setPickedUris] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
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
    await onSave(trimmed, pickedUris);
    setText("");
    setPickedUris([]);
    // Success beat: drawn checkmark + haptic, then back to "Add"
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setJustSaved(true);
    savedTimer.current = setTimeout(() => setJustSaved(false), 1200);
  };

  return (
    <PaperCard style={styles.container}>
      <Text style={styles.title}>Highlight of the day</Text>
      <Text style={styles.placeholder}>
        {todayEntryCount === 0
          ? "Tell me something about today..."
          : "Add another highlight..."}
      </Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder=""
        multiline
        placeholderTextColor={Colors.textSecondary}
        editable={!saving}
      />
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
              exiting={FadeOut.duration(100)}
              style={styles.popover}
            >
              <Pressable
                style={styles.popoverItem}
                onPress={() => {
                  setPickerOpen(false);
                  void takePhoto();
                }}
              >
                <IconSymbol
                  name="camera.fill"
                  size={16}
                  color={Colors.ink}
                />
                <Text style={styles.popoverText}>Take Photo</Text>
              </Pressable>
              <View style={styles.popoverDivider} />
              <Pressable
                style={styles.popoverItem}
                onPress={() => {
                  setPickerOpen(false);
                  void pickFromLibrary();
                }}
              >
                <IconSymbol
                  name="photo.fill"
                  size={16}
                  color={Colors.ink}
                />
                <Text style={styles.popoverText}>Choose from Library</Text>
              </Pressable>
              <View style={styles.popoverArrow} />
            </Animated.View>
          )}
          {/* The a11y label sits on a grouping View because PressableScale
              doesn't forward accessibility props yet. */}
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={
              pickerOpen
                ? "Close photo picker"
                : `Add photo, ${pickedUris.length} of ${MAX_IMAGES} attached`
            }
            accessibilityState={{
              disabled: pickedUris.length >= MAX_IMAGES || !!saving,
            }}
          >
            <PressableScale
              style={[
                styles.mediaButton,
                (pickedUris.length >= MAX_IMAGES || saving) &&
                  styles.mediaButtonDisabled,
              ]}
              onPress={handleAddPhoto}
              disabled={pickedUris.length >= MAX_IMAGES || saving}
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
        </View>
        <PressableScale
          style={[
            styles.saveButton,
            ((!text.trim() && pickedUris.length === 0) || saving) && !justSaved
              ? styles.saveButtonDisabled
              : null,
          ]}
          onPress={handleSave}
          disabled={
            ((!text.trim() && pickedUris.length === 0) || saving) && !justSaved
          }
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
                  {saving ? "Saving..." : "Add"}
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
      {/* Photos are NOT end-to-end encrypted in v1 (private Storage bucket
          only) — disclosed plainly, right where photos get attached. */}
      <Text style={styles.privacyNote}>
        Your words and habits are end-to-end encrypted. Photos are stored
        privately, but not encrypted yet.
      </Text>
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
  placeholder: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginBottom: 12,
    fontFamily: Fonts.handwriting,
    fontStyle: "italic",
  },
  input: {
    fontSize: 16,
    color: Colors.ink,
    minHeight: 60,
    fontFamily: Fonts.handwriting,
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
    borderColor: "rgba(26, 26, 26, 0.15)",
    paddingVertical: 4,
    minWidth: 220,
    shadowColor: "#1A1A1A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 10,
  },
  popoverItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    backgroundColor: "rgba(26, 26, 26, 0.1)",
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
    borderColor: "rgba(26, 26, 26, 0.15)",
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
