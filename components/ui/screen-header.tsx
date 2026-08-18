import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ScreenHeaderProps {
  title: string;
  /** Optional trailing element (e.g. an Edit button). */
  right?: React.ReactNode;
}

/** Back chevron + title row for pushed (non-tab) pages. Respects the notch. */
export function ScreenHeader({ title, right }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: Math.max(insets.top, 12) }]}>
      <TouchableOpacity
        onPress={() => router.back()}
        activeOpacity={0.6}
        hitSlop={10}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
        accessibilityHint={`Leaves ${title}`}
      >
        <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
      </TouchableOpacity>
      {/* The title is the first thing VoiceOver should land on after Back. */}
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 4,
  },
  back: { padding: 4 },
  title: {
    flex: 1,
    fontSize: 22,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  right: { minWidth: 24, alignItems: "flex-end" },
});
