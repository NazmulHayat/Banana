import 'react-native-get-random-values'; // Must be first for crypto
import {
  ShantellSans_400Regular,
  ShantellSans_500Medium,
  ShantellSans_600SemiBold,
} from '@expo-google-fonts/shantell-sans';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, router, useSegments, Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { OnboardingProvider, useOnboarding } from '@/lib/onboarding-context';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { session, loading: authLoading } = useAuth();
  const { hasCompletedOnboarding, loading: onboardingLoading } = useOnboarding();
  const segments = useSegments();

  const loading = authLoading || onboardingLoading;

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === 'auth';
    const inOnboarding = segments[0] === 'onboarding' as string;

    if (!session && !inAuthGroup) {
      // No session, redirect to login
      router.replace('/auth/login');
    } else if (session && inAuthGroup) {
      // Has session but still in auth flow
      // Check if they need onboarding
      if (hasCompletedOnboarding === false) {
        router.replace('/onboarding/welcome' as Href);
      } else {
        router.replace('/(tabs)');
      }
    } else if (session && !inOnboarding && hasCompletedOnboarding === false) {
      // User is logged in but hasn't completed onboarding
      router.replace('/onboarding/welcome' as Href);
    }
  }, [session, loading, segments, hasCompletedOnboarding]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="auth" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    ShantellSans: ShantellSans_400Regular,
    ShantellSans_500: ShantellSans_500Medium,
    ShantellSans_600: ShantellSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <OnboardingProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootLayoutNav />
            <StatusBar style="auto" />
          </ThemeProvider>
        </OnboardingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
