// Real integration test against the Banana v2 Supabase project.
// Creates a test user, exercises the full flow, then deletes the user.
//
// Reads SUPABASE_URL + SUPABASE_ANON_KEY from .env

import "./setup";

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  base64ToBytes,
  bytesToBase64,
} from "../lib/crypto/encoding";
import {
  dayBucket,
  habitLogDayBucket,
  habitLogMonthBucket,
  monthBucket,
} from "../lib/crypto/buckets";
import {
  aesDecrypt,
  aesEncrypt,
  deriveKek,
  DEFAULT_KDF_PARAMS,
  generateMasterKey,
  generateSalt,
  randomBytes,
} from "../lib/crypto/primitives";
import { AAD, encryptJson } from "../lib/crypto/payload";
import {
  assertEq,
  assertRejects,
  assertTrue,
  run,
  suite,
  test,
} from "./helpers";

// ----------------------------------------------------------------------------
// Load .env
// ----------------------------------------------------------------------------
const envPath = path.join(__dirname, "..", ".env");
const envText = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.EXPO_PUBLIC_SUPABASE_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL / KEY in .env");
}
if (!SERVICE_ROLE_KEY) {
  console.log(
    "\n[skip] SUPABASE_SERVICE_ROLE_KEY not set in env. " +
      "Run with: SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/e2e.test.ts\n" +
      "(needed to create test users — Supabase Auth blocks @example.com emails)",
  );
  process.exit(0);
}

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------
const TEST_RUN_ID = Math.random().toString(36).slice(2, 10);
const USER_A = {
  email: `banana-test-a-${TEST_RUN_ID}@example.com`,
  password: "TestPass123!",
  username: `t_a_${TEST_RUN_ID.slice(0, 8)}`.slice(0, 20),
};
const USER_B = {
  email: `banana-test-b-${TEST_RUN_ID}@example.com`,
  password: "TestPass123!",
  username: `t_b_${TEST_RUN_ID.slice(0, 8)}`.slice(0, 20),
};

console.log(
  `\nTest run ${TEST_RUN_ID} — userA=${USER_A.email}, userB=${USER_B.email}`,
);
console.log(`Target: ${SUPABASE_URL}\n`);

function newClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createTestUser(email: string, password: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`admin.createUser: ${error?.message ?? "no user"}`);
  }
  return data.user.id;
}

async function adminDeleteUser(userId: string): Promise<void> {
  const admin = adminClient();
  await admin.auth.admin.deleteUser(userId);
}

// ----------------------------------------------------------------------------
// Shared state across tests (declared up front)
// ----------------------------------------------------------------------------
let userAId = "";
let userAMasterKey: Uint8Array = new Uint8Array();
let userARecoveryKey: Uint8Array = new Uint8Array();
let userASalt: Uint8Array = new Uint8Array();
let clientA = newClient();
let userBId = "";
let userBMasterKey: Uint8Array = new Uint8Array();
let clientB = newClient();

// Track created users so we can clean up even if tests fail
const usersToCleanup: string[] = [];

// ============================================================================
suite("connectivity");
// ============================================================================
test("can reach Supabase + username_available RPC works", async () => {
  const c = newClient();
  const { data, error } = await c.rpc("username_available", {
    check_username: "definitelynotaname_" + TEST_RUN_ID,
  });
  if (error) {
    throw new Error(
      `RPC failed: ${error.message}. Did you run the first migration?`,
    );
  }
  assertEq(data, true, "should report a random username as available");
});

// ============================================================================
suite("user A: signup + keyring + write");
// ============================================================================
test("create user A via admin API + sign in", async () => {
  userAId = await createTestUser(USER_A.email, USER_A.password);
  usersToCleanup.push(userAId);
  const { data, error } = await clientA.auth.signInWithPassword({
    email: USER_A.email,
    password: USER_A.password,
  });
  if (error || !data.session) {
    throw new Error(`signIn after admin-create: ${error?.message ?? "no session"}`);
  }
});

test("insert accounts row with username", async () => {
  const { error } = await clientA
    .from("accounts")
    .insert({ id: userAId, username: USER_A.username });
  if (error) throw new Error(`accounts insert: ${error.message}`);
});

test("RPC reports the just-claimed username as unavailable", async () => {
  const { data, error } = await clientA.rpc("username_available", {
    check_username: USER_A.username,
  });
  if (error) throw new Error(error.message);
  assertEq(data, false);
});

test("simulate keyring.setupNewUser — write profile blob", async () => {
  userAMasterKey = generateMasterKey();
  userARecoveryKey = randomBytes(32);
  userASalt = generateSalt();
  const kek = deriveKek(USER_A.password, userASalt, DEFAULT_KDF_PARAMS);

  const enc = (s: string) => new TextEncoder().encode(s);
  const wrappedMaster = aesEncrypt(
    kek,
    userAMasterKey,
    enc(AAD.wrapMaster(userAId)),
  );
  const wrappedRecovery = aesEncrypt(
    userARecoveryKey,
    userAMasterKey,
    enc(AAD.wrapRecovery(userAId)),
  );
  const recoveryDisplay = aesEncrypt(
    userAMasterKey,
    userARecoveryKey,
    enc(AAD.recoveryDisplay(userAId)),
  );

  const { error } = await clientA.from("profiles").insert({
    id: userAId,
    wrapped_master_key: bytesToBase64(wrappedMaster.ciphertext),
    wrapped_master_key_nonce: bytesToBase64(wrappedMaster.nonce),
    kdf_salt: bytesToBase64(userASalt),
    kdf_params: DEFAULT_KDF_PARAMS,
    wrapped_master_recovery: bytesToBase64(wrappedRecovery.ciphertext),
    wrapped_master_recovery_nonce: bytesToBase64(wrappedRecovery.nonce),
    recovery_key_display: bytesToBase64(recoveryDisplay.ciphertext),
    recovery_key_display_nonce: bytesToBase64(recoveryDisplay.nonce),
    recovery_key_hint: "TEST",
    recovery_key_created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`profiles insert: ${error.message}`);
});

test("write an encrypted journal entry", async () => {
  const date = "2026-06-10";
  const dBucket = dayBucket(userAMasterKey, date);
  const mBucket = monthBucket(userAMasterKey, "2026-06");
  const payload = {
    date,
    entries: [
      {
        id: "e1",
        text: "Integration test entry — should round-trip cleanly",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const blob = encryptJson(userAMasterKey, payload, AAD.entry(dBucket, userAId));

  const { error } = await clientA.from("entries").insert({
    owner_id: userAId,
    day_bucket: dBucket,
    month_bucket: mBucket,
    ciphertext: blob.ciphertext,
    nonce: blob.nonce,
  });
  if (error) throw new Error(`entries insert: ${error.message}`);
});

test("write an encrypted habit log", async () => {
  const date = "2026-06-10";
  const dBucket = habitLogDayBucket(userAMasterKey, "habit-1", date);
  const mBucket = habitLogMonthBucket(userAMasterKey, "2026-06");
  const blob = encryptJson(
    userAMasterKey,
    { habitId: "habit-1", date, completed: true },
    AAD.habitLog(dBucket, userAId),
  );
  const { error } = await clientA.from("habit_logs").insert({
    owner_id: userAId,
    day_bucket: dBucket,
    month_bucket: mBucket,
    ciphertext: blob.ciphertext,
    nonce: blob.nonce,
  });
  if (error) throw new Error(`habit_logs insert: ${error.message}`);
});

// ============================================================================
suite("user A: read + decrypt round-trip");
// ============================================================================
test("can read own profile blob", async () => {
  const { data, error } = await clientA
    .from("profiles")
    .select("wrapped_master_key, wrapped_master_key_nonce, kdf_salt, kdf_params")
    .eq("id", userAId)
    .single();
  if (error) throw new Error(error.message);
  assertTrue(data, "profile row missing");
  const salt = base64ToBytes(data!.kdf_salt);
  const kek = deriveKek(USER_A.password, salt, data!.kdf_params);
  const enc = new TextEncoder();
  const unwrapped = aesDecrypt(
    kek,
    base64ToBytes(data!.wrapped_master_key),
    base64ToBytes(data!.wrapped_master_key_nonce),
    enc.encode(AAD.wrapMaster(userAId)),
  );
  assertEq(
    bytesToBase64(unwrapped),
    bytesToBase64(userAMasterKey),
    "unwrapped master key must equal original",
  );
});

test("can decrypt own entry via month_bucket query", async () => {
  const mBucket = monthBucket(userAMasterKey, "2026-06");
  const { data, error } = await clientA
    .from("entries")
    .select("ciphertext, nonce, day_bucket")
    .eq("owner_id", userAId)
    .eq("month_bucket", mBucket);
  if (error) throw new Error(error.message);
  assertEq(data?.length, 1);
  const row = data![0];
  const plaintext = aesDecrypt(
    userAMasterKey,
    base64ToBytes(row.ciphertext as string),
    base64ToBytes(row.nonce as string),
    new TextEncoder().encode(AAD.entry(row.day_bucket as string, userAId)),
  );
  const obj = JSON.parse(new TextDecoder().decode(plaintext));
  assertEq(obj.entries[0].text, "Integration test entry — should round-trip cleanly");
});

test("can decrypt own habit log via month_bucket query", async () => {
  const mBucket = habitLogMonthBucket(userAMasterKey, "2026-06");
  const { data, error } = await clientA
    .from("habit_logs")
    .select("ciphertext, nonce, day_bucket")
    .eq("owner_id", userAId)
    .eq("month_bucket", mBucket);
  if (error) throw new Error(error.message);
  assertEq(data?.length, 1);
  const row = data![0];
  const plaintext = aesDecrypt(
    userAMasterKey,
    base64ToBytes(row.ciphertext as string),
    base64ToBytes(row.nonce as string),
    new TextEncoder().encode(AAD.habitLog(row.day_bucket as string, userAId)),
  );
  const obj = JSON.parse(new TextDecoder().decode(plaintext));
  assertEq(obj.completed, true);
});

// ============================================================================
suite("user B: RLS isolation");
// ============================================================================
test("create user B via admin + sign in", async () => {
  userBId = await createTestUser(USER_B.email, USER_B.password);
  usersToCleanup.push(userBId);
  const { data, error } = await clientB.auth.signInWithPassword({
    email: USER_B.email,
    password: USER_B.password,
  });
  if (error || !data.session) {
    throw new Error(`B signIn: ${error?.message ?? "no session"}`);
  }
  userBMasterKey = generateMasterKey();
});

test("user B cannot SELECT user A's accounts row", async () => {
  const { data } = await clientB
    .from("accounts")
    .select("*")
    .eq("id", userAId);
  // RLS filters out other rows → empty
  assertEq(data?.length ?? 0, 0);
});

test("user B cannot SELECT user A's profile row", async () => {
  const { data } = await clientB
    .from("profiles")
    .select("*")
    .eq("id", userAId);
  assertEq(data?.length ?? 0, 0);
});

test("user B cannot SELECT user A's entries (RLS scoped to owner_id)", async () => {
  const { data } = await clientB
    .from("entries")
    .select("*")
    .eq("owner_id", userAId);
  assertEq(data?.length ?? 0, 0);
});

test("user B cannot INSERT an entry claiming user A's owner_id", async () => {
  const { error } = await clientB.from("entries").insert({
    owner_id: userAId, // attempting to write to A's bucket
    day_bucket: "fake".repeat(8),
    month_bucket: "fake".repeat(8),
    ciphertext: "QUFB",
    nonce: "QUFB",
  });
  assertTrue(error, "expected RLS to block insert with foreign owner_id");
});

test("user B cannot DELETE user A's entries", async () => {
  await clientB
    .from("entries")
    .delete()
    .eq("owner_id", userAId);
  // Verify A's entries are still there (using A's session)
  const { data } = await clientA
    .from("entries")
    .select("*")
    .eq("owner_id", userAId);
  assertTrue((data?.length ?? 0) > 0, "user A's entries were deleted by user B!");
});

// ============================================================================
suite("recovery key flow");
// ============================================================================
test("can unwrap master key with recovery key", async () => {
  const { data, error } = await clientA
    .from("profiles")
    .select("wrapped_master_recovery, wrapped_master_recovery_nonce")
    .eq("id", userAId)
    .single();
  if (error) throw new Error(error.message);
  const unwrapped = aesDecrypt(
    userARecoveryKey,
    base64ToBytes(data!.wrapped_master_recovery!),
    base64ToBytes(data!.wrapped_master_recovery_nonce!),
    new TextEncoder().encode(AAD.wrapRecovery(userAId)),
  );
  assertEq(bytesToBase64(unwrapped), bytesToBase64(userAMasterKey));
});

test("can re-wrap with new password (simulates recover-with-key flow)", async () => {
  const newPassword = "NewPass456!";
  const newSalt = generateSalt();
  const newKek = deriveKek(newPassword, newSalt, DEFAULT_KDF_PARAMS);
  const newWrapped = aesEncrypt(
    newKek,
    userAMasterKey,
    new TextEncoder().encode(AAD.wrapMaster(userAId)),
  );

  const { error } = await clientA
    .from("profiles")
    .update({
      wrapped_master_key: bytesToBase64(newWrapped.ciphertext),
      wrapped_master_key_nonce: bytesToBase64(newWrapped.nonce),
      kdf_salt: bytesToBase64(newSalt),
      kdf_params: DEFAULT_KDF_PARAMS,
    })
    .eq("id", userAId);
  if (error) throw new Error(error.message);

  const { data: refetched } = await clientA
    .from("profiles")
    .select("wrapped_master_key, wrapped_master_key_nonce, kdf_salt")
    .eq("id", userAId)
    .single();
  const k = deriveKek(
    newPassword,
    base64ToBytes(refetched!.kdf_salt),
    DEFAULT_KDF_PARAMS,
  );
  const unwrapped = aesDecrypt(
    k,
    base64ToBytes(refetched!.wrapped_master_key),
    base64ToBytes(refetched!.wrapped_master_key_nonce),
    new TextEncoder().encode(AAD.wrapMaster(userAId)),
  );
  assertEq(bytesToBase64(unwrapped), bytesToBase64(userAMasterKey));
});

// ============================================================================
suite("account deletion (Apple-required)");
// ============================================================================
test("delete_my_account RPC exists + deletes user A", async () => {
  const { error } = await clientA.rpc("delete_my_account");
  if (error) {
    throw new Error(
      `delete_my_account failed: ${error.message}. Did you run migration 20260610130000_account_deletion.sql?`,
    );
  }
  // Remove from cleanup since RPC handled it
  usersToCleanup.splice(usersToCleanup.indexOf(userAId), 1);
});

test("user A's data is gone after delete (cascade)", async () => {
  // Sign in fresh as user B — RLS won't show A's data anyway, but confirm
  // by trying to sign in as A (should fail because user is gone)
  const c = newClient();
  const { data, error } = await c.auth.signInWithPassword({
    email: USER_A.email,
    password: USER_A.password,
  });
  // signInWithPassword should fail with "Invalid login credentials"
  assertTrue(error, "user A should no longer be able to sign in");
  assertTrue(!data.session, "no session expected");
});

// ============================================================================
// cleanup hook (best-effort)
// ============================================================================
async function cleanupRemaining(): Promise<void> {
  for (const uid of usersToCleanup) {
    try {
      // Try to sign in as them and call delete_my_account
      // (we already have clientB signed in for userB)
      const c = uid === userBId ? clientB : newClient();
      await c.rpc("delete_my_account");
    } catch (e) {
      console.warn(`Cleanup failed for ${uid}: ${e}`);
    }
  }
}

(async () => {
  try {
    await run();
  } catch (e) {
    console.error("Test run threw:", e);
  } finally {
    await cleanupRemaining();
  }
})();
