import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not found. Backend features disabled.');
}

// Lazy-load AsyncStorage to avoid SSR issues on web
const getStorage = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  return AsyncStorage;
};

// Check if we're in a browser/client environment
const isClient = typeof window !== 'undefined';

// Create Supabase client with platform-appropriate storage
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Only use AsyncStorage on client-side, use memory storage during SSR
    storage: isClient ? getStorage() : undefined,
    autoRefreshToken: true,
    persistSession: isClient,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Helper to check if Supabase is configured
export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);
