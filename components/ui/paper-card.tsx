import { Colors } from "@/constants/theme";
import { Platform, StyleSheet, View, ViewStyle } from "react-native";

interface PaperCardProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}

export function PaperCard({ children, style }: PaperCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 20,
    // Deliberate ink outline (matches the sign-out button); shadow drops to
    // a whisper so cards read as drawn boxes, not floating panels.
    borderWidth: 1.5,
    borderColor: Colors.ink,
    ...Platform.select({
      ios: {
        shadowColor: Colors.ink,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
      },
      android: {
        elevation: 1,
      },
    }),
  },
});
