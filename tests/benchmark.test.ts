// Performance benchmarks. Numbers are from Node on the dev machine — divide
// by ~0.5–0.7x for newer iPhones, multiply by ~1.5–2x for older Android.

import "./setup";

import {
  aesDecrypt,
  aesEncrypt,
  deriveKek,
  DEFAULT_KDF_PARAMS,
  generateMasterKey,
  generateSalt,
  randomBytes,
} from "../lib/crypto/primitives";
import { dayBucket, monthBucket } from "../lib/crypto/buckets";
import { decryptJson, encryptJson } from "../lib/crypto/payload";
import { bench } from "./helpers";

function fmtNum(n: number, decimals = 2): string {
  if (n < 1) return n.toFixed(decimals);
  if (n < 100) return n.toFixed(1);
  return n.toFixed(0);
}

function print(label: string, mean: number, min: number, max: number): void {
  const m = `${fmtNum(mean)}ms`.padStart(8);
  const lo = `${fmtNum(min)}ms`.padStart(8);
  const hi = `${fmtNum(max)}ms`.padStart(8);
  console.log(`  ${label.padEnd(50)} ${m}  [${lo} – ${hi}]`);
}

console.log("\n=================================================================");
console.log(" Banana crypto benchmarks (mean across 5 runs after warmup)");
console.log("=================================================================");

// --- KDF ---
console.log("\n[ KEY DERIVATION — runs on every login ]");
{
  const salt = generateSalt();
  const r = bench(
    "scrypt N=16384 (current params)",
    () => deriveKek("Hunter22!", salt, DEFAULT_KDF_PARAMS),
  );
  print(r.name, r.mean, r.min, r.max);
}

// --- AES-GCM at various payload sizes ---
console.log("\n[ AES-GCM ENCRYPT — runs on every save ]");
{
  const key = generateMasterKey();
  for (const sizeKb of [1, 10, 50, 100]) {
    const data = randomBytes(sizeKb * 1024);
    const r = bench(
      `encrypt ${sizeKb} KB`,
      () => aesEncrypt(key, data),
      10,
    );
    print(r.name, r.mean, r.min, r.max);
  }
}

console.log("\n[ AES-GCM DECRYPT — runs on every read ]");
{
  const key = generateMasterKey();
  for (const sizeKb of [1, 10, 50, 100]) {
    const data = randomBytes(sizeKb * 1024);
    const { ciphertext, nonce } = aesEncrypt(key, data);
    const r = bench(
      `decrypt ${sizeKb} KB`,
      () => aesDecrypt(key, ciphertext, nonce),
      10,
    );
    print(r.name, r.mean, r.min, r.max);
  }
}

// --- HMAC bucket ---
console.log("\n[ HMAC BUCKETS — runs on every save/query ]");
{
  const key = generateMasterKey();
  const r1 = bench(
    "dayBucket",
    () => dayBucket(key, "2026-06-10"),
    1000,
  );
  print(r1.name, r1.mean, r1.min, r1.max);
  const r2 = bench(
    "monthBucket",
    () => monthBucket(key, "2026-06"),
    1000,
  );
  print(r2.name, r2.mean, r2.min, r2.max);
}

// --- Full save/load roundtrips simulating real workload ---
console.log("\n[ PAYLOAD JSON encrypt+decrypt ]");
{
  const key = generateMasterKey();
  // Typical entry: 3 highlights of 200 chars each ~ 700 bytes JSON
  const typical = {
    date: "2026-06-10",
    entries: [
      { id: "1", text: "morning run was rough", createdAt: "..." },
      { id: "2", text: "had a great lunch meeting with the team", createdAt: "..." },
      { id: "3", text: "wrote ~300 lines and shipped a feature", createdAt: "..." },
    ],
  };
  const aad = "test:entry:bench";
  const r1 = bench(
    "encryptJson typical entry (~700B)",
    () => encryptJson(key, typical, aad),
    100,
  );
  print(r1.name, r1.mean, r1.min, r1.max);
  const blob = encryptJson(key, typical, aad);
  const r2 = bench(
    "decryptJson typical entry (~700B)",
    () => decryptJson(key, blob, aad),
    100,
  );
  print(r2.name, r2.mean, r2.min, r2.max);
}

// --- Full signup/login simulation ---
console.log("\n[ END-TO-END FLOWS ]");
{
  const password = "Hunter22!";
  const salt = generateSalt();
  const masterKey = generateMasterKey();

  // signup: scrypt + wrap
  const signup = bench(
    "Full signup core (scrypt + wrap master + wrap recovery)",
    () => {
      const kek = deriveKek(password, salt, DEFAULT_KDF_PARAMS);
      aesEncrypt(kek, masterKey);
      const recovery = randomBytes(32);
      aesEncrypt(recovery, masterKey);
    },
    3,
  );
  print(signup.name, signup.mean, signup.min, signup.max);

  // login: scrypt + unwrap
  const kek = deriveKek(password, salt, DEFAULT_KDF_PARAMS);
  const { ciphertext, nonce } = aesEncrypt(kek, masterKey);
  const login = bench(
    "Full login core (scrypt + unwrap master)",
    () => {
      const k = deriveKek(password, salt, DEFAULT_KDF_PARAMS);
      aesDecrypt(k, ciphertext, nonce);
    },
    3,
  );
  print(login.name, login.mean, login.min, login.max);
}

console.log("\n=================================================================\n");
