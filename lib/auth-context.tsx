import { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { keyring } from "./crypto";
import {
  clearEntriesCache,
  clearHabitLogsCache,
  clearHabitsCache,
} from "./db";
import { clearMediaCache } from "./media";
import { supabase } from "./supabase";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  // True once we've verified that either:
  //   (a) no session exists, or
  //   (b) session exists AND keyring is unlocked (either from cache or fresh login)
  keyringReady: boolean;
  /**
   * Manually flip keyringReady after a successful keyring.unlock() or
   * keyring.setupNewUser() — the onAuthStateChange callback can fire BEFORE
   * the async unlock completes, so we need to be able to update state by hand.
   */
  markKeyringReady: (ready: boolean) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  keyringReady: false,
  markKeyringReady: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyringReady, setKeyringReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;

      if (session) {
        const restored = await keyring.tryRestoreFromCache(session.user.id);
        if (!restored) {
          // Session is valid but encryption key isn't on this device.
          // This shouldn't happen on the same device that signed in, but
          // can occur after a reinstall when Supabase tokens persisted but
          // SecureStore did not. Force re-login so password is asked again.
          if (__DEV__) {
            console.warn(
              "[Auth] Session valid but no master key in SecureStore — forcing re-login",
            );
          }
          await supabase.auth.signOut();
          if (!mounted) return;
          setSession(null);
          setKeyringReady(false);
        } else {
          setSession(session);
          setKeyringReady(true);
        }
      }
      if (mounted) setLoading(false);
    }

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (!newSession) {
        await keyring.lock();
        setKeyringReady(false);
      } else if (newSession && !keyring.isUnlocked()) {
        // Session became live but keyring isn't unlocked yet — try cache.
        // The signin/signup screens explicitly unlock and won't go through
        // this branch in normal flow; this is only for restart-style events.
        const restored = await keyring.tryRestoreFromCache(newSession.user.id);
        setKeyringReady(restored);
      } else {
        setKeyringReady(true);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    clearEntriesCache();
    clearHabitLogsCache();
    clearHabitsCache();
    clearMediaCache();
    await keyring.lock();
    await supabase.auth.signOut();
    setSession(null);
    setKeyringReady(false);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        keyringReady,
        markKeyringReady: setKeyringReady,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
