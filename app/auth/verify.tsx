import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Colors, Fonts } from '@/constants/theme';
import { PaperBackground } from '@/components/ui/paper-background';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function VerifyScreen() {
  const insets = useSafeAreaInsets();
  const { email, username, isNewUser } = useLocalSearchParams<{ 
    email: string;
    username?: string;
    isNewUser: string;
  }>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleVerify = async () => {
    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length < 6) {
      Alert.alert('Invalid code', 'Please enter the verification code from your email.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email!,
        token: cleanCode,
        type: 'signup',
      });

      if (error) {
        Alert.alert('Verification failed', error.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        Alert.alert('Error', 'No session created. Please try again.');
        setLoading(false);
        return;
      }

      // If new user, create account with username and email
      if (isNewUser === 'true' && username) {
        const { error: accountError } = await supabase
          .from('accounts')
          .insert({
            id: data.session.user.id,
            username: username.toLowerCase().trim(),
            email: email!.toLowerCase().trim(),
          });

        if (accountError) {
          if (accountError.code === '23505') {
            Alert.alert(
              'Username taken',
              'Someone took this username while you were signing up. Please try again.',
              [{ text: 'OK', onPress: () => router.replace('/auth/signup') }]
            );
            return;
          }
          console.error('Account creation error:', accountError);
        }
      }

      router.replace('/(tabs)');
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;

    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email!,
      });

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        Alert.alert('Code sent', 'A new verification code has been sent to your email.');
        setResendCooldown(60);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to resend code.');
    }
  };

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.content, { paddingTop: insets.top + 20 }]}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Verify your email</Text>
          <Text style={styles.subtitle}>
            We sent a verification code to{'\n'}
            <Text style={styles.email}>{email}</Text>
          </Text>

          <View style={styles.form}>
            <Text style={styles.label}>Verification Code</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="Enter code"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
              maxLength={8}
              autoComplete="one-time-code"
            />

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Verifying...' : 'Verify Email'}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleResend}
            disabled={resendCooldown > 0}
            activeOpacity={0.7}
            style={styles.resendButton}
          >
            <Text style={[styles.resend, resendCooldown > 0 && styles.resendDisabled]}>
              {resendCooldown > 0
                ? `Resend code in ${resendCooldown}s`
                : 'Resend code'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            Can't find the email? Check your spam folder.
          </Text>
        </View>
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
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  backText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginLeft: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 32,
    lineHeight: 24,
  },
  email: {
    color: Colors.ink,
    fontWeight: '600',
  },
  form: {
    width: '100%',
    maxWidth: 400,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 28,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: 4,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.paper,
    fontFamily: Fonts.handwriting,
  },
  resendButton: {
    marginTop: 24,
    alignSelf: 'center',
  },
  resend: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    textDecorationLine: 'underline',
  },
  resendDisabled: {
    color: Colors.textSecondary,
    textDecorationLine: 'none',
  },
  hint: {
    marginTop: 16,
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: 'center',
  },
});
