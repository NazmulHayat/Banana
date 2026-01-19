import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const ONBOARDING_KEY = '@onboarding_completed';

interface OnboardingContextType {
  hasCompletedOnboarding: boolean | null; // null = loading
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  loading: boolean;
}

const OnboardingContext = createContext<OnboardingContextType>({
  hasCompletedOnboarding: null,
  completeOnboarding: async () => {},
  resetOnboarding: async () => {},
  loading: true,
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_KEY);
      setHasCompletedOnboarding(value === 'true');
    } catch (err) {
      console.warn('Failed to check onboarding status:', err);
      setHasCompletedOnboarding(false);
    } finally {
      setLoading(false);
    }
  };

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      setHasCompletedOnboarding(true);
    } catch (err) {
      console.warn('Failed to save onboarding status:', err);
    }
  };

  const resetOnboarding = async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_KEY);
      setHasCompletedOnboarding(false);
    } catch (err) {
      console.warn('Failed to reset onboarding:', err);
    }
  };

  return (
    <OnboardingContext.Provider
      value={{
        hasCompletedOnboarding,
        completeOnboarding,
        resetOnboarding,
        loading,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export const useOnboarding = () => useContext(OnboardingContext);
