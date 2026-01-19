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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const validateEmail = (email: string): boolean => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validateUsername = (value: string): string | null => {
    const clean = value.toLowerCase().trim();
    if (clean.length < 3) return 'At least 3 characters';
    if (clean.length > 20) return 'Max 20 characters';
    if (!/^[a-z0-9_]+$/.test(clean)) return 'Only letters, numbers, underscores';
    return null;
  };

  const validatePassword = (pass: string): string | null => {
    if (pass.length < 8) return 'At least 8 characters';
    if (!/[A-Z]/.test(pass)) return 'Include an uppercase letter';
    if (!/[a-z]/.test(pass)) return 'Include a lowercase letter';
    if (!/[0-9]/.test(pass)) return 'Include a number';
    return null;
  };

  const checkUsernameAvailability = async (value: string) => {
    const clean = value.toLowerCase().trim();
    const validationError = validateUsername(clean);
    
    if (validationError) {
      setUsernameError(validationError);
      setUsernameAvailable(false);
      return;
    }

    setCheckingUsername(true);
    setUsernameError('');

    try {
      const { data: existing } = await supabase
        .from('accounts')
        .select('id')
        .eq('username', clean)
        .single();

      if (existing) {
        setUsernameError('Username taken');
        setUsernameAvailable(false);
      } else {
        setUsernameError('');
        setUsernameAvailable(true);
      }
    } catch {
      // No match found = available
      setUsernameError('');
      setUsernameAvailable(true);
    } finally {
      setCheckingUsername(false);
    }
  };

  const handleSignup = async () => {
    // Validate all fields
    if (!username.trim()) {
      setUsernameError('Username is required');
      return;
    }

    const usernameValidation = validateUsername(username);
    if (usernameValidation) {
      setUsernameError(usernameValidation);
      return;
    }

    if (!usernameAvailable) {
      Alert.alert('Username unavailable', 'Please choose a different username.');
      return;
    }

    if (!email.trim() || !validateEmail(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (passwordValidation) {
      setPasswordError(passwordValidation);
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setLoading(true);
    setPasswordError('');

    try {
      // Sign up with Supabase Auth (creates user with hashed password)
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: password,
        options: {
          data: {
            username: username.toLowerCase().trim(),
          },
        },
      });

      if (error) {
        if (error.message.includes('already registered')) {
          Alert.alert('Email in use', 'This email is already registered. Try signing in instead.');
        } else {
          Alert.alert('Error', error.message);
        }
        setLoading(false);
        return;
      }

      if (data.user) {
        // Navigate to verify screen
        router.push({
          pathname: '/auth/verify',
          params: { 
            email: email.trim().toLowerCase(),
            username: username.toLowerCase().trim(),
            isNewUser: 'true',
          },
        });
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
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <IconSymbol name="chevron.left" size={24} color={Colors.ink} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Join Banana and start journaling privately
          </Text>

          <View style={styles.form}>
            {/* Username */}
            <Text style={styles.label}>Username</Text>
            <View style={styles.usernameContainer}>
              <Text style={styles.prefix}>@</Text>
              <TextInput
                style={styles.usernameInput}
                value={username}
                onChangeText={(text) => {
                  const clean = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
                  setUsername(clean);
                  setUsernameAvailable(false);
                  setUsernameError('');
                }}
                onBlur={() => {
                  if (username.length >= 3) {
                    checkUsernameAvailability(username);
                  }
                }}
                placeholder="yourname"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              {checkingUsername && (
                <Text style={styles.checking}>...</Text>
              )}
              {usernameAvailable && !checkingUsername && (
                <IconSymbol name="checkmark.circle.fill" size={20} color="#4caf50" />
              )}
            </View>
            {usernameError ? (
              <Text style={styles.error}>{usernameError}</Text>
            ) : (
              <Text style={styles.hint}>3-20 characters: letters, numbers, underscores</Text>
            )}

            {/* Email */}
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />

            {/* Password */}
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setPasswordError('');
                }}
                placeholder="Create a password"
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
            <Text style={styles.hint}>Min 8 chars, uppercase, lowercase, number</Text>

            {/* Confirm Password */}
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                setPasswordError('');
              }}
              placeholder="Confirm your password"
              placeholderTextColor={Colors.textSecondary}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {passwordError ? <Text style={styles.error}>{passwordError}</Text> : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={loading || checkingUsername}
              activeOpacity={0.7}
            >
              <Text style={styles.buttonText}>
                {loading ? 'Creating account...' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.signinContainer}>
            <Text style={styles.signinText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth/signin')}>
              <Text style={styles.signinLink}>Sign In</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
    marginTop: 8,
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
    marginBottom: 4,
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
    marginBottom: 4,
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
    paddingRight: 12,
    fontSize: 16,
    fontFamily: Fonts.handwriting,
    color: Colors.ink,
  },
  checking: {
    fontSize: 14,
    color: Colors.textSecondary,
    paddingRight: 12,
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
    marginBottom: 4,
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
  error: {
    fontSize: 13,
    color: '#d32f2f',
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 8,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: Colors.ink,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
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
  signinContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  signinText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  signinLink: {
    fontSize: 14,
    color: Colors.accent,
    fontFamily: Fonts.handwriting,
    fontWeight: '600',
  },
});
