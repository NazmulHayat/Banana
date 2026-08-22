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
  // Section titles are the only navigation on a long scrolling page, so they
  // have to win against the numbers under them: 22pt, semi-bold face, and
  // real air above. At 16pt they read as another label and the page became one
  // undifferentiated column.
  row: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  text: {
    fontSize: 22,
    // Custom fonts can't synthesise weight on iOS — the bold face has to be
    // named, `fontWeight` alone does nothing here.
    fontFamily: Fonts.handwritingSemiBold,
    color: Colors.ink,
    letterSpacing: 0.2,
  },
});
