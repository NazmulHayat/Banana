// Only bucket generation needed on client (for querying)
// Encryption/decryption happens server-side via Edge Functions

import { bytesToHex } from '@noble/ciphers/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

const KEY_LENGTH = 32;
const UUID_SALT = new TextEncoder().encode('banana_uuid_salt_2026');

// Key cache for bucket generation
let cachedKey: Uint8Array | null = null;
let cachedUuid: string | null = null;

export function deriveKeyFromUuid(uuid: string): Uint8Array {
  // Return cached key if same user
  if (cachedKey && cachedUuid === uuid) {
    return cachedKey;
  }

  const salt = new Uint8Array(KEY_LENGTH);
  salt.set(UUID_SALT.slice(0, KEY_LENGTH));
  
  cachedKey = scrypt(new TextEncoder().encode(uuid), salt, {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: KEY_LENGTH,
  });
  cachedUuid = uuid;
  
  return cachedKey;
}

export function clearKeyCache() {
  cachedKey = null;
  cachedUuid = null;
}

// Bucket generation for querying (still needed on client)
function generateBucket(key: Uint8Array, prefix: string, value: string): string {
  const data = new TextEncoder().encode(`${prefix}:${value}`);
  return bytesToHex(hmac(sha256, key, data)).slice(0, 32);
}

export function generateDayBucket(key: Uint8Array, date: string): string {
  return generateBucket(key, 'day', date);
}

export function generateMonthBucket(key: Uint8Array, yearMonth: string): string {
  return generateBucket(key, 'month', yearMonth);
}
