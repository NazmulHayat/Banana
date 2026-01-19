/**
 * Core cryptographic utilities using @noble/ciphers
 * All encryption happens client-side; Supabase only stores ciphertext.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes, bytesToHex, hexToBytes } from '@noble/ciphers/utils.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Constants
const SCRYPT_N = 2 ** 15; // ~32768, moderate for mobile
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32; // 256-bit key
const NONCE_LENGTH = 12; // 96 bits for AES-GCM

/**
 * Derive a key from password using scrypt
 */
export function deriveKey(
  password: string,
  salt: Uint8Array,
  params?: { N?: number; r?: number; p?: number }
): Uint8Array {
  const encoder = new TextEncoder();
  return scrypt(encoder.encode(password), salt, {
    N: params?.N ?? SCRYPT_N,
    r: params?.r ?? SCRYPT_R,
    p: params?.p ?? SCRYPT_P,
    dkLen: SCRYPT_DKLEN,
  });
}

/**
 * Generate random bytes
 */
export function generateRandomBytes(length: number): Uint8Array {
  return randomBytes(length);
}

/**
 * Generate a random 256-bit master key
 */
export function generateMasterKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Generate a random salt for KDF
 */
export function generateSalt(): Uint8Array {
  return randomBytes(32);
}

/**
 * Encrypt data with AES-256-GCM
 */
export function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = randomBytes(NONCE_LENGTH);
  const aes = gcm(key, nonce);
  const ciphertext = aes.encrypt(plaintext);
  return { ciphertext, nonce };
}

/**
 * Decrypt data with AES-256-GCM
 */
export function decrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  const aes = gcm(key, nonce);
  return aes.decrypt(ciphertext);
}

/**
 * Encrypt a string to hex-encoded ciphertext
 */
export function encryptString(
  plaintext: string,
  key: Uint8Array
): { ciphertext: string; nonce: string } {
  const encoder = new TextEncoder();
  const { ciphertext, nonce } = encrypt(encoder.encode(plaintext), key);
  return {
    ciphertext: bytesToHex(ciphertext),
    nonce: bytesToHex(nonce),
  };
}

/**
 * Decrypt hex-encoded ciphertext to string
 */
export function decryptString(
  ciphertextHex: string,
  key: Uint8Array,
  nonceHex: string
): string {
  const ciphertext = hexToBytes(ciphertextHex);
  const nonce = hexToBytes(nonceHex);
  const plaintext = decrypt(ciphertext, key, nonce);
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

/**
 * Encrypt JSON object
 */
export function encryptJson(
  data: object,
  key: Uint8Array
): { ciphertext: string; nonce: string } {
  const json = JSON.stringify(data);
  return encryptString(json, key);
}
/**
 * Decrypt JSON object
 */
export function decryptJson<T = unknown>(
  ciphertextHex: string,
  key: Uint8Array,
  nonceHex: string
): T {
  const json = decryptString(ciphertextHex, key, nonceHex);
  return JSON.parse(json);
}

/**
 * Generate a deterministic bucket string using HMAC
 * This allows querying without revealing actual dates
 */
export function generateBucket(
  bucketKey: Uint8Array,
  prefix: string,
  value: string
): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${prefix}:${value}`);
  const hash = hmac(sha256, bucketKey, data);
  return bytesToHex(hash).slice(0, 32); // 128-bit bucket id
}

/**
 * Generate day bucket (for daily entries/logs)
 */
export function generateDayBucket(bucketKey: Uint8Array, date: string): string {
  return generateBucket(bucketKey, 'day', date); // date format: YYYY-MM-DD
}

/**
 * Generate month bucket (for monthly queries)
 */
export function generateMonthBucket(bucketKey: Uint8Array, yearMonth: string): string {
  return generateBucket(bucketKey, 'month', yearMonth); // format: YYYY-MM
}

// Hex utilities (re-export for convenience)
export { bytesToHex, hexToBytes };
