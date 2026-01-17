import {
    ShantellSans_400Regular,
    ShantellSans_500Medium,
    ShantellSans_600SemiBold,
} from '@expo-google-fonts/shantell-sans';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { storage } from '@/lib/storage';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    ShantellSans: ShantellSans_400Regular,
    ShantellSans_500: ShantellSans_500Medium,
    ShantellSans_600: ShantellSans_600SemiBold,
  });

  useEffect(() => {
    async function initialize() {
      const habits = await storage.getHabits();
      const entries = await storage.getDailyEntries();
      
      // Populate habits if empty or if we have less than 6 (old default)
      if (habits.length === 0 || habits.length < 6) {
        const defaultHabits = [
          { id: '1', name: 'Morning walk', createdAt: new Date().toISOString() },
          { id: '2', name: 'Read', createdAt: new Date().toISOString() },
          { id: '3', name: 'Meditate', createdAt: new Date().toISOString() },
          { id: '4', name: 'Exercise', createdAt: new Date().toISOString() },
          { id: '5', name: 'Water plants', createdAt: new Date().toISOString() },
          { id: '6', name: 'Journal', createdAt: new Date().toISOString() },
        ];
        await storage.saveHabits(defaultHabits);
      }
      
      // Populate feed entries if empty
      if (entries.length === 0) {
        const today = new Date();
        const dummyEntries = [
          {
            id: '1',
            date: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Had an amazing morning walk in the park. The weather was perfect and I saw so many beautiful flowers blooming. Feeling refreshed and ready for the day!',
            mediaUrls: ['https://images.unsplash.com/photo-1544966503-7cc5ac882d5f?w=800&h=600&fit=crop'],
            createdAt: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: '2',
            date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Finished reading an incredible book today. The story was so captivating, I couldn\'t put it down. Already thinking about what to read next.',
            mediaUrls: ['https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&h=600&fit=crop'],
            createdAt: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: '3',
            date: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Meditation session was deeply calming today. Found a new spot by the window where the morning light streams in. Perfect way to start the day.',
            mediaUrls: [],
            createdAt: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: '4',
            date: new Date(today.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Great workout session! Pushed myself harder than usual and it felt amazing. The endorphin rush is real.',
            mediaUrls: ['https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=600&fit=crop'],
            createdAt: new Date(today.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: '5',
            date: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Watered all my plants today. They\'re looking so healthy and vibrant! My little indoor garden brings me so much joy.',
            mediaUrls: ['https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=600&fit=crop', 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?w=800&h=600&fit=crop'],
            createdAt: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          },
          {
            id: '6',
            date: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            text: 'Spent some time journaling about gratitude today. Reflecting on the small moments that made me smile. Grateful for this peaceful evening.',
            mediaUrls: ['https://images.unsplash.com/photo-1455390582262-044cdead277a?w=800&h=600&fit=crop'],
            createdAt: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString(),
          },
        ];
        
        for (const entry of dummyEntries) {
          await storage.saveDailyEntry(entry);
        }
      }
      
      if (!(await storage.isInitialized())) {
        await storage.setInitialized();
      }
    }
    initialize();
  }, []);

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
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}