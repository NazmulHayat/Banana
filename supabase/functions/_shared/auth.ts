// Authentication utilities for Edge Functions

import { createClient, SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2";

export class AuthError extends Error {
  statusCode: number;
  
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export interface AuthResult {
  user: User;
  supabase: SupabaseClient;
}

/**
 * Get authenticated Supabase client from request
 * 
 * Strategy:
 * 1. Validate user's JWT to authenticate them
 * 2. Return a SERVICE ROLE client for database operations
 *    (Edge Functions handle authorization via verifyOwnership)
 */
export async function getAuthenticatedClient(req: Request): Promise<AuthResult> {
  // Get authorization header
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("No authorization header", 401);
  }
  
  // Extract token
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    throw new AuthError("Invalid authorization header", 401);
  }
  
  // Get Supabase credentials from environment
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase configuration not found");
  }
  
  // Create a client with anon key just to verify the user's token
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  
  // Verify token and get user
  const { data: { user }, error } = await authClient.auth.getUser(token);
  
  if (error || !user) {
    console.error("[auth] Token verification failed:", error?.message);
    throw new AuthError(error?.message || "Invalid token", 401);
  }
  
  console.log("[auth] User verified:", user.id);
  
  // Create a SERVICE ROLE client for database operations
  // This bypasses RLS - authorization is handled by verifyOwnership()
  const supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  
  return { user, supabase };
}

/**
 * Verify that the authenticated user owns the resource
 * @param authUserId - User ID from JWT
 * @param resourceOwnerId - Owner ID of the resource
 */
export function verifyOwnership(authUserId: string, resourceOwnerId: string): void {
  if (authUserId !== resourceOwnerId) {
    throw new AuthError("Access denied: you don't own this resource", 403);
  }
}
