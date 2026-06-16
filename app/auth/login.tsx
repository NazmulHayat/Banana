import { BrandMark } from '@/components/ui/brand-mark';
import { PaperBackground } from '@/components/ui/paper-background';
import { Colors, Fonts } from '@/constants/theme';
import { router } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.content, { paddingTop: insets.top + 80 }]}>
          <View style={styles.logo}>
            <BrandMark size={40} blink float />
          </View>
          <Text style={styles.title}>Aight Bet</Text>
          <Text style={styles.subtitle}>
            Get your shit done!
          </Text>

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push('/auth/signup')}
              activeOpacity={0.7}
            >
              <Text style={styles.primaryButtonText}>Create Account</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => router.push('/auth/signin')}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>

        {__DEV__ && (
          <View style={styles.devRow}>
            <TouchableOpacity
              onPress={() => router.push('/onboarding/welcome' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.devLink}>Onboarding →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)' as any)}
              activeOpacity={0.7}
            >
              <Text style={styles.devLink}>Skip to app →</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
          End-to-end encrypted. Only you can read your data.
        </Text>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  logo: {
    marginBottom: 24,
  },
  title: {
    fontSize: 36,
    color: Colors.ink,
    fontFamily: Fonts.handwritingMedium,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 60,
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 340,
    gap: 16,
  },
  primaryButton: {
    width: '100%',
    height: 56,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  secondaryButton: {
    width: '100%',
    height: 56,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
  },
  footer: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  devRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 12,
  },
  devLink: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textDecorationLine: 'underline',
  },
});
