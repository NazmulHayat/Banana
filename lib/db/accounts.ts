// Accounts — the one PLAINTEXT row per user: username (unique, public-facing)
// and the avatar's Storage object key. Nothing here is encrypted, and nothing
// here may ever hold a date, a habit name or journal text.
//
// No cache tier: the accounts row is a single row read once per session by the
// store (which holds it in React state as `profile`), so the entries/habits
// Map + AsyncStorage pattern would be a second cache for one row. Writes go
// straight to the server and the store updates its own state from the result.

import { supabase } from "../supabase";
import { UsernameRules } from "./schema";
import type { Account, AccountRow, UsernameCheck } from "./types";
import { UnrecoverableWriteError } from "./types";

// The columns this module ever reads. Narrow by design — widening a select on
// the account row is how a "just in case" column ends up in the UI.
const ACCOUNT_COLUMNS = "id, username, avatar_path, created_at";

// Postgres unique-violation. The username has a unique index, so this is what
// comes back when somebody else took the name between our availability check
// and our update — the race, not a bug.
const UNIQUE_VIOLATION = "23505";

// Authored messages for write failures that retrying as-is can never fix. The
// store maps each to user-safe copy (FAILED_REASONS) — never the raw server
// message, which can leak schema details.
export const AccountWriteErrors = {
  INVALID_USERNAME: "Username is invalid",
  TAKEN_USERNAME: "Username is taken",
} as const;

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    avatarPath: row.avatar_path ?? null,
    created_at: row.created_at,
  };
}

/** Trim + lowercase, the same normalization the DB's lowercase check enforces. */
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Read the signed-in user's account row.
 *
 * Returns a `ReadResult`-shaped answer via null: `null` means the read failed
 * or the row doesn't exist yet (a signup that died between auth and
 * `recovery-setup`), and the caller must keep whatever it already had rather
 * than blanking the profile.
 */
export async function getAccount(userId: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (__DEV__) console.warn("[accounts] fetch failed:", error.message);
    return null;
  }
  if (!data) return null;
  return toAccount(data as AccountRow);
}

/**
 * Ask the server whether a username is free, via the `username_available` RPC
 * (there is no readable list of accounts — that would leak the user list).
 *
 * Never throws: an unreachable server is `unknown`, which the UI shows as
 * "couldn't check" rather than pretending the name is taken.
 */
export async function checkUsername(
  candidate: string,
): Promise<UsernameCheck> {
  const username = normalizeUsername(candidate);

  // Client-side rules first — same regex as the DB's accounts_username_format
  // check (UsernameRules is the single source; change one, change both).
  const validation = UsernameRules.validate(username);
  if (!validation.valid) {
    return {
      status: "invalid",
      reason: validation.error ?? "That username won't work.",
    };
  }

  const { data, error } = await supabase.rpc("username_available", {
    check_username: username,
  });

  if (error) {
    if (__DEV__) console.warn("[accounts] availability check failed:", error.message);
    return { status: "unknown" };
  }
  return data === true ? { status: "available" } : { status: "taken" };
}

/**
 * Change the username. Throws on failure — the store turns the throw into a
 * `WriteOutcome` (see backend rules: lib/db never queues its own retry).
 *
 * Two guards, both needed:
 *   1. `UsernameRules` before the round trip, so an invalid name never becomes
 *      a raw constraint-violation message in the UI;
 *   2. the availability RPC, then the update — and the update still handles
 *      `23505`, because between (2) and the write somebody else can claim the
 *      name. The unique index is the real authority; the RPC is only a
 *      courtesy so the common case reads nicely.
 */
export async function updateUsername(
  candidate: string,
  userId: string,
): Promise<Account> {
  const username = normalizeUsername(candidate);

  const validation = UsernameRules.validate(username);
  if (!validation.valid) {
    throw new UnrecoverableWriteError(AccountWriteErrors.INVALID_USERNAME);
  }

  const availability = await checkUsername(username);
  if (availability.status === "taken") {
    throw new UnrecoverableWriteError(AccountWriteErrors.TAKEN_USERNAME);
  }
  // `unknown` (couldn't ask) falls through to the update: the unique index
  // catches a collision anyway, and refusing to try would block a rename on a
  // flaky connection for no safety gain.

  const { data, error } = await supabase
    .from("accounts")
    .update({ username })
    .eq("id", userId)
    .select(ACCOUNT_COLUMNS)
    .single();

  if (error) {
    // Lost the race: somebody claimed the name in the gap above. Retrying the
    // SAME name can never succeed, so this is unrecoverable, not queueable.
    if (error.code === UNIQUE_VIOLATION) {
      throw new UnrecoverableWriteError(AccountWriteErrors.TAKEN_USERNAME);
    }
    throw new Error(`Failed to update username: ${error.message}`);
  }
  if (!data) {
    throw new Error("Failed to update username: no row was returned");
  }
  return toAccount(data as AccountRow);
}

/**
 * Point the account at a new avatar object, or clear it with `null`. Throws on
 * failure so the caller can roll the uploaded object back.
 *
 * The path itself is not secret (see the migration comment), so it is stored
 * plaintext — that is what lets us delete the object it replaces.
 */
export async function setAvatarPath(
  avatarPath: string | null,
  userId: string,
): Promise<Account> {
  const { data, error } = await supabase
    .from("accounts")
    .update({ avatar_path: avatarPath })
    .eq("id", userId)
    .select(ACCOUNT_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update profile photo: ${error.message}`);
  }
  if (!data) {
    throw new Error("Failed to update profile photo: no row was returned");
  }
  return toAccount(data as AccountRow);
}
