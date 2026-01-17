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
    backgroundColor: Colors.card,
    borderRadius: 8,
    padding: 16,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});