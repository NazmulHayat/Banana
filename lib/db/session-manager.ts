// Session Manager - Efficient token caching and refresh
// Similar to how production apps handle authentication

import { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

interface CachedSession {
  session: Session;
  expiresAt: number;
  refreshPromise: Promise<Session> | null;
}

class SessionManager {
  private cachedSession: CachedSession | null = null;
  private refreshPromise: Promise<Session> | null = null;
  private readonly BUFFER_TIME = 60; // Refresh 60 seconds before expiry

  /**
   * Get a valid session, refreshing if needed
   * Uses singleton pattern - only one refresh at a time
   */
  async getSession(): Promise<Session> {
    const now = Math.floor(Date.now() / 1000);

    // Check if cached session is still valid
    if (this.cachedSession && this.cachedSession.expiresAt > now + this.BUFFER_TIME) {
      return this.cachedSession.session;
    }

    // If already refreshing, wait for that promise
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    // Start refresh
    this.refreshPromise = this.refreshSession();
    
    try {
      const session = await this.refreshPromise;
      return session;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Refresh session from storage or server
   */
  private async refreshSession(): Promise<Session> {
    // Get current session from storage
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error("[SessionManager] Session error:", error.message);
      throw new Error("Auth error: " + error.message);
    }

    if (!session) {
      console.error("[SessionManager] No session found");
      throw new Error("Not authenticated - please sign in");
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = session.expires_at || 0;

    // If token is expiring soon or expired, refresh it
    if (expiresAt < now + this.BUFFER_TIME) {
      console.log("[SessionManager] Token expiring soon, refreshing...");
      
      const { data: { session: refreshedSession }, error: refreshError } = 
        await supabase.auth.refreshSession();

      if (refreshError || !refreshedSession) {
        console.error("[SessionManager] Refresh failed:", refreshError?.message);
        // Clear cache on refresh failure
        this.cachedSession = null;
        throw new Error("Session expired - please sign in again");
      }

      // Cache the refreshed session
      this.cachedSession = {
        session: refreshedSession,
        expiresAt: refreshedSession.expires_at || 0,
        refreshPromise: null,
      };

      console.log("[SessionManager] Token refreshed and cached");
      return refreshedSession;
    }

    // Cache the current session
    this.cachedSession = {
      session,
      expiresAt,
      refreshPromise: null,
    };

    return session;
  }

  /**
   * Get user ID from cached or fresh session
   */
  async getUserId(): Promise<string> {
    const session = await this.getSession();
    return session.user.id;
  }

  /**
   * Get access token from cached or fresh session
   */
  async getAccessToken(): Promise<string> {
    const session = await this.getSession();
    return session.access_token;
  }

  /**
   * Clear cached session (on logout)
   */
  clearCache(): void {
    this.cachedSession = null;
    this.refreshPromise = null;
  }

  /**
   * Invalidate cache (force refresh on next call)
   */
  invalidateCache(): void {
    this.cachedSession = null;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();

// Helper function for backward compatibility
export async function getAuth() {
  const session = await sessionManager.getSession();
  return {
    userId: session.user.id,
    session,
  };
}
