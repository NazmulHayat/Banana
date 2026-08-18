import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface SettingsRowProps {
  /** SF Symbol name. */
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}

/** Icon + title (+ optional subtitle) + chevron row. Used across the hub + spokes. */
export function SettingsRow({ icon, title, subtitle, onPress }: SettingsRowProps) {
  return (
    <TouchableOpacity style={settingsRowStyles.row} onPress={onPress} activeOpacity={0.6}>
      <IconSymbol
        name={icon as never}
        size={20}
        color={Colors.ink}
        style={settingsRowStyles.icon}
      />
      <View style={settingsRowStyles.text}>
        <Text style={settingsRowStyles.title}>{title}</Text>
        {subtitle ? <Text style={settingsRowStyles.subtitle}>{subtitle}</Text> : null}
      </View>
      <IconSymbol name="chevron.right" size={14} color={Colors.textSecondary} />
    </TouchableOpacity>
  );
}

/** Section header with the accent-dot stamp shared with the feed date rows. */
export function SectionTitle({
  children,
  inline,
}: {
  children: string;
  /** Skip the bottom margin when used inside a header row. */
  inline?: boolean;
}) {
  return (
    <View style={[sectionTitleStyles.row, inline && { marginBottom: 0 }]}>
      <View style={sectionTitleStyles.dot} />
      <Text style={sectionTitleStyles.text}>{children}</Text>
    </View>
  );
}

const settingsRowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  icon: { marginRight: 14, width: 24 },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: "600", color: Colors.ink, fontFamily: Fonts.handwriting },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
});

const sectionTitleStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.accent },
  text: { fontSize: 16, fontWeight: "700", color: Colors.ink, fontFamily: Fonts.handwriting },
});
