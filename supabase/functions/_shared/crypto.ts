// Server-side encryption using Web Crypto API (Deno compatible)
// Uses AES-256-GCM with server-managed encryption key

import { encode as base64Encode, decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const NONCE_LENGTH = 12; // 96 bits for GCM

// Get encryption key from environment
function getEncryptionKey(): string {
  const key = Deno.env.get("APP_ENCRYPTION_KEY");
  if (!key) {
    throw new Error("APP_ENCRYPTION_KEY not configured");
  }
  if (key.length !== 64) {
    throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return key;
}

// Convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Convert PostgreSQL bytea hex format (\x...) to bytes
function pgHexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.substring(2) : value;
  return hexToBytes(hex);
}

// Convert bytes to PostgreSQL bytea hex format (\x...)
function bytesToPgHex(bytes: Uint8Array): string {
  return `\\x${bytesToHex(bytes)}`;
}

// Import the encryption key as a CryptoKey
async function importKey(): Promise<CryptoKey> {
  const keyHex = getEncryptionKey();
  const keyBytes = hexToBytes(keyHex);
  
  return await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

// Generate random nonce
function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
}

export interface EncryptResult {
  ciphertext: string; // PostgreSQL bytea hex (\x...)
  nonce: string; // PostgreSQL bytea hex (\x...)
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - Object to encrypt
 * @returns ciphertext and nonce as PostgreSQL bytea hex strings (\\x...)
 */
export async function encrypt(data: unknown): Promise<EncryptResult> {
  const key = await importKey();
  const nonce = generateNonce();
  
  // Convert data to JSON bytes
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  
  // Encrypt
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: nonce },
    key,
    plaintext
  );
  
  return {
    ciphertext: bytesToPgHex(new Uint8Array(ciphertextBuffer)),
    nonce: bytesToPgHex(nonce),
  };
}

/**
 * Decrypt data using AES-256-GCM
 * @param ciphertext - PostgreSQL bytea hex (\\x...) or base64
 * @param nonce - PostgreSQL bytea hex (\\x...) or base64
 * @returns decrypted data as object
 */
export async function decrypt(ciphertext: string, nonce: string): Promise<unknown> {
  const key = await importKey();
  
  try {
    const ciphertextBytes = ciphertext.startsWith("\\x")
      ? pgHexToBytes(ciphertext)
      : base64Decode(ciphertext.trim());
    const nonceBytes = nonce.startsWith("\\x")
      ? pgHexToBytes(nonce)
      : base64Decode(nonce.trim());
    
    // Decrypt
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: nonceBytes },
      key,
      ciphertextBytes
    );
    
    // Parse JSON
    const plaintext = new TextDecoder().decode(plaintextBuffer);
    return JSON.parse(plaintext);
  } catch (error) {
    const err = error as Error;
    // Provide more context about what failed
    if (err.message.includes('base64') || err.message.includes('decode')) {
      throw new Error(`Failed to decode base64 - ciphertext length: ${ciphertext?.length}, nonce length: ${nonce?.length}, ciphertext preview: ${ciphertext?.substring(0, 50)}`);
    }
    throw error;
  }
}
