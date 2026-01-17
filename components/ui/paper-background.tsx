import { View, StyleSheet } from 'react-native';
import Svg, { Defs, Pattern, Circle, Rect } from 'react-native-svg';
import { Colors } from '@/constants/theme';

export function PaperBackground({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.container}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <Pattern id="dotGrid" patternUnits="userSpaceOnUse" width="20" height="20">
            <Circle cx="10" cy="10" r="1" fill={Colors.dotGrid} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dotGrid)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
});