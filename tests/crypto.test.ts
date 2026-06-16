// Pure-crypto unit tests. No network, no Supabase.

import "./setup";

import {
  base32ToBytes,
  base64ToBytes,
  bytesToBase32,
  bytesToBase64,
  formatRecoveryKey,
  normalizeRecoveryKey,
} from "../lib/crypto/encoding";
import {
  dayBucket,
  habitLogDayBucket,
  habitLogMonthBucket,
  monthBucket,
} from "../lib/crypto/buckets";
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
} from "../lib/crypto/payload";
import {
  aesDecrypt,
  aesEncrypt,
  deriveKek,
  DEFAULT_KDF_PARAMS,
  generateMasterKey,
  generateSalt,
  hmacSha256,
  randomBytes,
} from "../lib/crypto/primitives";
import {
  assertBytesEq,
  assertEq,
  assertThrows,
  assertTrue,
  run,
  suite,
  test,
} from "./helpers";

// ============================================================================
suite("encoding/base64");
// ============================================================================
test("round-trips short string", () => {
  const bytes = new TextEncoder().encode("hello");
  const b64 = bytesToBase64(bytes);
  const decoded = base64ToBytes(b64);
  assertBytesEq(decoded, bytes);
});

test("round-trips random 1KB", () => {
  const bytes = randomBytes(1024);
  const b64 = bytesToBase64(bytes);
  const decoded = base64ToBytes(b64);
  assertBytesEq(decoded, bytes);
});

test("round-trips random 256KB", () => {
  const bytes = randomBytes(256 * 1024);
  const b64 = bytesToBase64(bytes);
  const decoded = base64ToBytes(b64);
  assertBytesEq(decoded, bytes);
});

test("handles empty", () => {
  const out = bytesToBase64(new Uint8Array(0));
  assertEq(out, "");
  assertBytesEq(base64ToBytes(""), new Uint8Array(0));
});

// ============================================================================
suite("encoding/base32 + recovery key");
// ============================================================================
test("base32 round-trips 32 bytes", () => {
  const bytes = randomBytes(32);
  const b32 = bytesToBase32(bytes);
  const decoded = base32ToBytes(b32);
  assertBytesEq(decoded, bytes);
});

test("formatRecoveryKey produces grouped output", () => {
  const b32 = "AAAABBBBCCCC";
  const out = formatRecoveryKey(b32);
  assertEq(out, "AAAA-BBBB-CCCC");
});

test("normalizeRecoveryKey strips dashes and lowercases", () => {
  const out = normalizeRecoveryKey("abcd-EFGH-2345");
  assertEq(out, "ABCDEFGH2345");
});

test("normalizeRecoveryKey strips whitespace and invalid chars", () => {
  const out = normalizeRecoveryKey(" abcd efgh 1018 ");
  // 0 and 1 are NOT in base32 alphabet — should be stripped
  assertEq(out, "ABCDEFGH");
});

test("recovery key round-trip via base32 + format/normalize survives copy-paste", () => {
  const original = randomBytes(32);
  const b32 = bytesToBase32(original);
  const formatted = formatRecoveryKey(b32);
  // simulate user copying + pasting
  const reentered = ` ${formatted.toLowerCase()}\n `;
  const recovered = base32ToBytes(normalizeRecoveryKey(reentered));
  assertBytesEq(recovered, original);
});

// ============================================================================
suite("primitives/AES-GCM");
// ============================================================================
test("encrypt → decrypt round-trips bytes", () => {
  const key = generateMasterKey();
  const plaintext = new TextEncoder().encode("the quick brown fox");
  const { ciphertext, nonce } = aesEncrypt(key, plaintext);
  const decoded = aesDecrypt(key, ciphertext, nonce);
  assertBytesEq(decoded, plaintext);
});

test("decrypt with wrong key throws", () => {
  const key1 = generateMasterKey();
  const key2 = generateMasterKey();
  const plaintext = new TextEncoder().encode("secret");
  const { ciphertext, nonce } = aesEncrypt(key1, plaintext);
  assertThrows(() => aesDecrypt(key2, ciphertext, nonce));
});

test("decrypt with tampered ciphertext throws (GCM auth catches it)", () => {
  const key = generateMasterKey();
  const plaintext = new TextEncoder().encode("secret");
  const { ciphertext, nonce } = aesEncrypt(key, plaintext);
  ciphertext[0] ^= 0xff;
  assertThrows(() => aesDecrypt(key, ciphertext, nonce));
});

test("each encrypt call uses fresh nonce (no reuse risk)", () => {
  const key = generateMasterKey();
  const pt = new TextEncoder().encode("hi");
  const n1 = aesEncrypt(key, pt).nonce;
  const n2 = aesEncrypt(key, pt).nonce;
  let same = true;
  for (let i = 0; i < n1.length; i++) {
    if (n1[i] !== n2[i]) {
      same = false;
      break;
    }
  }
  assertTrue(!same, "Two consecutive nonces were identical — random source broken?");
});

// ============================================================================
suite("primitives/scrypt + HMAC");
// ============================================================================
test("scrypt is deterministic with same password+salt+params", () => {
  const salt = new Uint8Array(16).fill(42);
  const a = deriveKek("hunter2", salt, DEFAULT_KDF_PARAMS);
  const b = deriveKek("hunter2", salt, DEFAULT_KDF_PARAMS);
  assertBytesEq(a, b);
});

test("scrypt with different password produces different KEK", () => {
  const salt = new Uint8Array(16).fill(42);
  const a = deriveKek("hunter2", salt, DEFAULT_KDF_PARAMS);
  const b = deriveKek("hunter3", salt, DEFAULT_KDF_PARAMS);
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
  assertTrue(!same, "different passwords produced identical KEK");
});

test("HMAC same key+input is deterministic", () => {
  const key = generateMasterKey();
  const a = hmacSha256(key, "day:2026-06-10");
  const b = hmacSha256(key, "day:2026-06-10");
  assertBytesEq(a, b);
});

test("HMAC different input → different output", () => {
  const key = generateMasterKey();
  const a = hmacSha256(key, "day:2026-06-10");
  const b = hmacSha256(key, "day:2026-06-11");
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
  assertTrue(!same, "HMAC produced same output for different inputs");
});

// ============================================================================
suite("buckets");
// ============================================================================
test("dayBucket is hex string of 32 chars", () => {
  const key = generateMasterKey();
  const b = dayBucket(key, "2026-06-10");
  assertEq(b.length, 32);
  assertTrue(/^[0-9a-f]+$/.test(b));
});

test("dayBucket changes with date", () => {
  const key = generateMasterKey();
  const a = dayBucket(key, "2026-06-10");
  const b = dayBucket(key, "2026-06-11");
  assertTrue(a !== b);
});

test("monthBucket changes with month", () => {
  const key = generateMasterKey();
  const a = monthBucket(key, "2026-06");
  const b = monthBucket(key, "2026-07");
  assertTrue(a !== b);
});

test("buckets are different across users (different keys)", () => {
  const key1 = generateMasterKey();
  const key2 = generateMasterKey();
  const date = "2026-06-10";
  assertTrue(dayBucket(key1, date) !== dayBucket(key2, date));
});

test("habitLogDayBucket distinguishes habit+date combos", () => {
  const key = generateMasterKey();
  const a = habitLogDayBucket(key, "habit-1", "2026-06-10");
  const b = habitLogDayBucket(key, "habit-2", "2026-06-10");
  const c = habitLogDayBucket(key, "habit-1", "2026-06-11");
  assertTrue(a !== b);
  assertTrue(a !== c);
  assertTrue(b !== c);
});

test("habitLogMonthBucket different from monthBucket (entries vs habit logs separate)", () => {
  const key = generateMasterKey();
  const a = monthBucket(key, "2026-06");
  const b = habitLogMonthBucket(key, "2026-06");
  assertTrue(
    a !== b,
    "Entries and habit log month buckets MUST be different (RLS index conflict otherwise)",
  );
});

// ============================================================================
suite("payload");
// ============================================================================
const AAD_FIXTURE = "test:entry:abc:def";

test("encryptJson → decryptJson round-trips an entry payload", () => {
  const key = generateMasterKey();
  const payload = {
    date: "2026-06-10",
    entries: [
      { id: "1", text: "first highlight", createdAt: "now" },
      { id: "2", text: "second highlight", createdAt: "now+1", mediaPaths: ["a/b"] },
    ],
  };
  const blob = encryptJson(key, payload, AAD_FIXTURE);
  const decrypted = decryptJson<typeof payload>(key, blob, AAD_FIXTURE);
  assertEq(decrypted, payload);
});

test("encryptBytes → decryptBytes round-trips arbitrary bytes", () => {
  const key = generateMasterKey();
  const data = randomBytes(2048);
  const blob = encryptBytes(key, data, AAD_FIXTURE);
  const decoded = decryptBytes(key, blob, AAD_FIXTURE);
  assertBytesEq(decoded, data);
});

test("blob.ciphertext is base64 and parseable", () => {
  const key = generateMasterKey();
  const blob = encryptJson(key, { hello: "world" }, AAD_FIXTURE);
  // shouldn't throw
  base64ToBytes(blob.ciphertext);
  base64ToBytes(blob.nonce);
});

test("AAD mismatch fails decryption (CRITICAL — prevents row-swap attacks)", () => {
  const key = generateMasterKey();
  const blob = encryptJson(key, { a: 1 }, "aad-A");
  assertThrows(() => decryptJson(key, blob, "aad-B"));
});

test("base32ToBytes validates expected length", () => {
  // 32 bytes → 52 chars
  const short = "AAAA"; // way too short
  assertThrows(() => base32ToBytes(short, 32), "expected 52");
  const long = "A".repeat(60);
  assertThrows(() => base32ToBytes(long, 32), "expected 52");
});

// ============================================================================
suite("simulated full wrap/unwrap (signup + login)");
// ============================================================================
test("password + recovery key unwrap independently", () => {
  // Simulate the keyring.setupNewUser() core math without supabase
  const password = "CorrectHorseBatteryStaple1!";
  const masterKey = generateMasterKey();
  const recoveryKey = randomBytes(32);

  const salt = generateSalt();
  const kek = deriveKek(password, salt, DEFAULT_KDF_PARAMS);

  const wrappedByPassword = aesEncrypt(kek, masterKey);
  const wrappedByRecovery = aesEncrypt(recoveryKey, masterKey);

  // Login path: re-derive KEK, unwrap
  const kek2 = deriveKek(password, salt, DEFAULT_KDF_PARAMS);
  const unwrapped1 = aesDecrypt(
    kek2,
    wrappedByPassword.ciphertext,
    wrappedByPassword.nonce,
  );
  assertBytesEq(unwrapped1, masterKey);

  // Recovery path
  const unwrapped2 = aesDecrypt(
    recoveryKey,
    wrappedByRecovery.ciphertext,
    wrappedByRecovery.nonce,
  );
  assertBytesEq(unwrapped2, masterKey);

  // Wrong password: should fail
  const wrongKek = deriveKek("WrongPassword!", salt, DEFAULT_KDF_PARAMS);
  assertThrows(() =>
    aesDecrypt(wrongKek, wrappedByPassword.ciphertext, wrappedByPassword.nonce),
  );
});

test("change password: re-wrap with new KEK, old password no longer works", () => {
  const masterKey = generateMasterKey();
  const oldSalt = generateSalt();
  const oldKek = deriveKek("OldPass1!", oldSalt, DEFAULT_KDF_PARAMS);
  aesEncrypt(oldKek, masterKey);

  // Change password
  const newSalt = generateSalt();
  const newKek = deriveKek("NewPass1!", newSalt, DEFAULT_KDF_PARAMS);
  const wrappedNew = aesEncrypt(newKek, masterKey);

  // New password unwraps
  const unwrapped = aesDecrypt(newKek, wrappedNew.ciphertext, wrappedNew.nonce);
  assertBytesEq(unwrapped, masterKey);

  // Old password derives wrong KEK (different salt!)
  const oldKekRetry = deriveKek("OldPass1!", newSalt, DEFAULT_KDF_PARAMS);
  assertThrows(() =>
    aesDecrypt(oldKekRetry, wrappedNew.ciphertext, wrappedNew.nonce),
  );
});

(async () => {
  await run();
})();
