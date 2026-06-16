// Payload encrypt/decrypt — JSON objects → base64 ciphertext + nonce.
// These are the only crypto functions data-layer code (entries.ts, habits.ts) calls.
//
// All callers MUST pass `aad` (additional authenticated data) so AES-GCM binds
// the ciphertext to its row context. Without it, a malicious server admin could
// swap ciphertext between rows (e.g. move a journal entry from one day to
// another) and the client would decrypt it as valid.

import { base64ToBytes, bytesToBase64 } from "./encoding";
import { aesDecrypt, aesEncrypt } from "./primitives";

export interface EncryptedBlob {
  ciphertext: string; // base64
  nonce: string; // base64
}

function encodeAad(aad: string | Uint8Array): Uint8Array {
  return typeof aad === "string" ? new TextEncoder().encode(aad) : aad;
}

export function encryptJson(
  masterKey: Uint8Array,
  payload: unknown,
  aad: string | Uint8Array,
): EncryptedBlob {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const { ciphertext, nonce } = aesEncrypt(masterKey, plaintext, encodeAad(aad));
  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  };
}

export function decryptJson<T = unknown>(
  masterKey: Uint8Array,
  blob: EncryptedBlob,
  aad: string | Uint8Array,
): T {
  const plaintext = aesDecrypt(
    masterKey,
    base64ToBytes(blob.ciphertext),
    base64ToBytes(blob.nonce),
    encodeAad(aad),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export function encryptBytes(
  masterKey: Uint8Array,
  bytes: Uint8Array,
  aad: string | Uint8Array,
): EncryptedBlob {
  const { ciphertext, nonce } = aesEncrypt(masterKey, bytes, encodeAad(aad));
  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  };
}

export function decryptBytes(
  masterKey: Uint8Array,
  blob: EncryptedBlob,
  aad: string | Uint8Array,
): Uint8Array {
  return aesDecrypt(
    masterKey,
    base64ToBytes(blob.ciphertext),
    base64ToBytes(blob.nonce),
    encodeAad(aad),
  );
}

// AAD constants — keep these stable forever, callers depend on them.
// The "banana:" prefix is a protocol constant, NOT branding: existing
// ciphertexts were sealed with it, so renaming it breaks all decryption.
export const AAD = {
  entry: (dayBucket: string, ownerId: string): string =>
    `banana:v1:entry:${dayBucket}:${ownerId}`,
  habit: (ownerId: string): string => `banana:v1:habit:${ownerId}`,
  habitLog: (dayBucket: string, ownerId: string): string =>
    `banana:v1:habitlog:${dayBucket}:${ownerId}`,
  wrapMaster: (userId: string): string => `banana:v1:wrap:master:${userId}`,
  wrapRecovery: (userId: string): string =>
    `banana:v1:wrap:recovery:${userId}`,
  recoveryDisplay: (userId: string): string =>
    `banana:v1:recovery_display:${userId}`,
} as const;
