// Cryptographic primitives: AES-256-GCM, scrypt, HMAC-SHA256
// Wraps @noble/* with a small, focused API. All keys/nonces are Uint8Array.

import { gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { scrypt, scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const KEY_LENGTH = 32; // 256 bits
export const NONCE_LENGTH = 12; // 96 bits, recommended for AES-GCM
export const SALT_LENGTH = 16;

// Default scrypt parameters — slow enough to be safe on mobile,
// fast enough to feel responsive. ~1-2s on iPhone, ~2-4s on mid-range Android.
export const DEFAULT_KDF_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  dkLen: KEY_LENGTH,
};

export type KdfParams = typeof DEFAULT_KDF_PARAMS;

// Web Crypto's getRandomValues caps at 65536 bytes per call — chunk for safety.
const MAX_RANDOM_CHUNK = 65536;

export function randomBytes(length: number): Uint8Array {
  const arr = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MAX_RANDOM_CHUNK) {
    const slice = arr.subarray(
      offset,
      Math.min(offset + MAX_RANDOM_CHUNK, length),
    );
    crypto.getRandomValues(slice);
  }
  return arr;
}

export function generateNonce(): Uint8Array {
  return randomBytes(NONCE_LENGTH);
}

export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

export function generateMasterKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

// Derive a 256-bit KEK from a password + salt using scrypt.
// Caller should keep `params` constant per user (stored in profiles.kdf_params).
//
// SYNCHRONOUS variant — blocks the JS thread for ~500ms-2s. Avoid on the UI
// thread; use deriveKekAsync() in React Native to keep the UI responsive.
export function deriveKek(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Uint8Array {
  return scrypt(new TextEncoder().encode(password), salt, params);
}

// ASYNC variant — yields to the event loop between scrypt iterations so the
// React Native UI can render spinners / respond to touches during the wait.
export async function deriveKekAsync(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  return scryptAsync(new TextEncoder().encode(password), salt, params);
}

// AES-256-GCM encrypt. Returns { ciphertext, nonce } as bytes.
export function aesEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = generateNonce();
  const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
  return { ciphertext, nonce };
}

export function aesEncryptWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).encrypt(plaintext);
}

export function aesDecrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
): Uint8Array {
  return gcm(key, nonce, aad).decrypt(ciphertext);
}

// HMAC-SHA256 — used for date bucket derivation
export function hmacSha256(key: Uint8Array, data: string | Uint8Array): Uint8Array {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hmac(sha256, key, bytes);
}
