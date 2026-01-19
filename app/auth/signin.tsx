import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Colors, Fonts } from '@/constants/theme';
import { PaperBackground } from '@/components/ui/paper-background';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function SigninScreen() {
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState(''); // email or username
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [useUsername, setUseUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignin = async () => {
    if (!identifier.trim()) {
      Alert.alert('Required', useUsername ? 'Please enter your username.' : 'Please enter your email.');
      return;
    }

    if (!password) {
      Alert.alert('Required', 'Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      let email = identifier.trim().toLowerCase();

      // If using username, look up the email first
      if (useUsername) {
        const username = identifier.toLowerCase().trim().replace('@', '');
        
        const { data: account, error: lookupError } = await supabase
          .from('accounts')
          .select('email')
          .eq('username', username)
          .single();

        if (lookupError || !account || !account.email) {
          Alert.alert('Not found', 'No account found with this username.');
          setLoading(false);
          return;
        }

        email = account.email;
      }

      // Validate email format
      if (!validateEmail(email)) {
        Alert.alert('Invalid email', 'Please enter a valid email address.');
        setLoading(false);
        return;
      }

      // Sign in with password
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          Alert.alert('Invalid credentials', 'Email or password is incorrect.');
        } else if (error.message.includes('Email not confirmed')) {
          // Email not verified, send OTP
          const { error: otpError } = await supabase.auth.resend({
            type: 'signup',
            email: email,
          });

          if (otpError) {
            Alert.alert('Error', otpError.message);
          } else {
            router.push({
              pathname: '/auth/verify',
              params: { 
                email: email,
                isNewUser: 'false',
              },
            });
          }
        } else {
          Alert.alert('Error', error.message);
        }
        setLoading(false);
        return;
      }

      if (data.session) {
        // Successfully signed in
        router.replace('/(tabs)');
      }
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PaperBackground>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to access your encrypted journal
          </Text>

          <View style={styles.form}>
            {/* Toggle between email and username */}
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[styles.toggleButton, !useUsername && styles.toggleActive]}
                onPress={() => {
                  setUseUsername(false);
                  setIdentifier('');
                }}
              >
                <Text style={[styles.toggleText, !useUsername && styles.toggleTextActive]}>
                  Email
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleButton, useUsername && styles.toggleActive]}
                onPress={() => {
                  setUseUsername(true);
                  setIdentifier('');
                }}
              >
                <Text style={[styles.toggleText, useUsername && styles.toggleTextActive]}>
                  Username
                </Text>
              </TouchableOpacity>
            </View>

            {/* Email or Username */}
            <Text style={styles.label}>{useUsername ? 'Username' : 'Email'}</Text>
            {useUsername ? (
              <View style={styles.usernameContainer}>
                <Text style={styles.prefix}>@</Text>
                <TextInput
                  style={styles.usernameInput}
                  value={identifier}
                  onChangeText={(text) => setIdentifier(text.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="yourname"
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ) : (
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@example.com"
                placeholderTextColor={Colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            )}

            {/* Password */}
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={Colors.textSecondary}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <IconSymbol 
                  name={showPassword ? 'eye.slash' : 'eye'} 
                  size={20} 
                  color={Colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignin}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.forgotButton}
              onPress={() => {
                Alert.alert(
                  'Reset Password',
                  'Enter your email to receive a password reset link.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                      text: 'Send Reset Link',
                      onPress: async () => {
                        if (!identifier.trim() || !validateEmail(identifier)) {
                          Alert.alert('Enter email', 'Please enter your email address first.');
                          return;
                        }
                        const { error } = await supabase.auth.resetPasswordForEmail(identifier.trim().toLowerCase());
                        if (error) {
                          Alert.alert('Error', error.message);
                        } else {
                          Alert.alert('Email sent', 'Check your email for the password reset link.');
                        }
                      }
                    },
                  ]
                );
              }}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.signupContainer}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth/signup')}>
              <Text style={styles.signupLink}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 24,
  },
  form: {
    width: '100%',
    maxWidth: 400,
  },
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    overflow: 'hidden',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  toggleActive: {
    backgroundColor: Colors.ink,
  },
  toggleText: {
    fontSize: 14,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: Colors.paper,
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
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
    backgroundColor: Colors.card,
    marginBottom: 16,
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    backgroundColor: Colors.card,
    marginBottom: 16,
  },
  prefix: {
    fontSize: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    paddingLeft: 16,
  },
  usernameInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 4,
    paddingRight: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    height: 52,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    borderRadius: 12,
    backgroundColor: Colors.card,
    marginBottom: 8,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
  },
  eyeButton: {
    padding: 12,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
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
  forgotButton: {
    alignSelf: 'center',
    marginTop: 16,
  },
  forgotText: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
  },
  signupContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  signupText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signupLink: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
});
