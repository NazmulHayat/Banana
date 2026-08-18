import {
  ShantellSans_400Regular,
  ShantellSans_500Medium,
  ShantellSans_600SemiBold,
} from "@expo-google-fonts/shantell-sans";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Href, Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import "react-native-get-random-values"; // must be first for crypto
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/animated-splash";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { DataProvider } from "@/lib/data-store";
import { OnboardingProvider, useOnboarding } from "@/lib/onboarding-context";
import { configureReminders } from "@/lib/reminder";

SplashScreen.preventAutoHideAsync();

// How a local reminder behaves if it fires while the app is open. Local only —
// there is no push server and no device token anywhere in this app.
configureReminders();

// Auth-group screens that should NOT auto-redirect to tabs even when a
// session exists. These run post-signup or during password recovery and
// own their own routing.
const POST_SESSION_AUTH_SCREENS = new Set([
  "recovery-setup",
  "recover-with-key",
  "verify",
]);

// DEV: start every reload on the intro flow (splash → login) even when a
// session exists, and never auto-kick off the auth/onboarding screens —
// so the first-run experience is easy to iterate on. Dev builds only;
// flip to false to get normal routing back.
const DEV_FORCE_INTRO = false;

function RootLayoutNav() {
  const { session, loading: authLoading, keyringReady } = useAuth();
  const { hasCompletedOnboarding, loading: onboardingLoading } =
    useOnboarding();
  const segments = useSegments();
  const forcedIntro = useRef(false);

  const loading = authLoading || onboardingLoading;

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "auth";
    const inOnboarding = segments[0] === ("onboarding" as string);
    const currentAuthScreen = inAuthGroup ? segments[1] : undefined;
    const onPostSessionAuthScreen =
      inAuthGroup &&
      typeof currentAuthScreen === "string" &&
      POST_SESSION_AUTH_SCREENS.has(currentAuthScreen);

    const isFullySignedIn = !!session && keyringReady;

    if (DEV_FORCE_INTRO && !forcedIntro.current) {
      forcedIntro.current = true;
      router.replace("/auth/login");
      return;
    }

    if (!session && !inAuthGroup) {
      // No session, redirect to login
      router.replace("/auth/login");
      return;
    }

    // In dev-intro mode, never auto-redirect away from auth or onboarding —
    // navigate forward by tapping through like a new user would.
    if (DEV_FORCE_INTRO && (inAuthGroup || inOnboarding)) {
      return;
    }

    if (isFullySignedIn && inAuthGroup && !onPostSessionAuthScreen) {
      // Signed in AND keyring unlocked but still on a login/signup screen
      if (hasCompletedOnboarding === false) {
        router.replace("/onboarding/welcome" as Href);
      } else {
        router.replace("/(tabs)");
      }
      return;
    }

    if (
      isFullySignedIn &&
      !inOnboarding &&
      !inAuthGroup &&
      hasCompletedOnboarding === false
    ) {
      router.replace("/onboarding/welcome" as Href);
      return;
    }
  }, [session, keyringReady, loading, segments, hasCompletedOnboarding]);

  return (
    // DataProvider wraps the whole app (one shared store across the tabs and
    // the pushed analysis/habits/security pages). Inert until a session exists.
    <DataProvider session={session}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </DataProvider>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [introDone, setIntroDone] = useState(false);
  const [fontsLoaded] = useFonts({
    ShantellSans: ShantellSans_400Regular,
    ShantellSans_500: ShantellSans_500Medium,
    ShantellSans_600: ShantellSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      // The native splash (solid paper) hands off to the animated one,
      // which is already mounted underneath by the time we hide it.
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
          <ThemeProvider
            value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
          >
            <RootLayoutNav />
            <StatusBar style="dark" />
            {!introDone && (
              <AnimatedSplash onDone={() => setIntroDone(true)} />
            )}
          </ThemeProvider>
        </OnboardingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
