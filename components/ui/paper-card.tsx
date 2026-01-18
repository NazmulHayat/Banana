import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/constants/theme';

interface PaperCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function PaperCard({ children, style }: PaperCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.paper,
    borderRadius: 4,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.shadow,
  },
});