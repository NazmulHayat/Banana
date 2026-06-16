// Encoding helpers: base64 and base32 for crypto values
// We persist all crypto blobs as base64 in Postgres `text` columns.
// Recovery keys are surfaced to users in base32 (no padding, grouped) for readability.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function bytesToBase64(bytes: Uint8Array): string {
  // Convert Uint8Array → binary string → base64 (works in RN)
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // Use globalThis.btoa which exists in RN/Hermes
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  // Fallback: manual base64 encoding
  return manualBase64Encode(bytes);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return manualBase64Decode(b64);
}

function manualBase64Encode(bytes: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1] ?? 0;
    const b3 = bytes[i + 2] ?? 0;
    const triplet = (b1 << 16) | (b2 << 8) | b3;
    out += chars[(triplet >> 18) & 0x3f];
    out += chars[(triplet >> 12) & 0x3f];
    out += i + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : "=";
    out += i + 2 < bytes.length ? chars[triplet & 0x3f] : "=";
  }
  return out;
}

function manualBase64Decode(b64: string): Uint8Array {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const padded = clean.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let outIdx = 0;
  for (let i = 0; i < padded.length; i += 4) {
    const b1 = chars.indexOf(padded[i]);
    const b2 = chars.indexOf(padded[i + 1]);
    const b3 = chars.indexOf(padded[i + 2] ?? "A");
    const b4 = chars.indexOf(padded[i + 3] ?? "A");
    const triplet = (b1 << 18) | (b2 << 12) | (b3 << 6) | b4;
    if (outIdx < out.length) out[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < out.length) out[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < out.length) out[outIdx++] = triplet & 0xff;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// RFC 4648 base32 (no padding) — used for recovery keys
export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32ToBytes(input: string, expectedBytes?: number): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (expectedBytes !== undefined) {
    const expectedChars = Math.ceil((expectedBytes * 8) / 5);
    if (clean.length !== expectedChars) {
      throw new Error(
        `Recovery key has ${clean.length} characters; expected ${expectedChars}. ` +
          `Check for missing or extra characters.`,
      );
    }
  }
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// Group base32 string into 4-char chunks separated by "-" for display.
// "ABCDEFGHIJ..." → "ABCD-EFGH-IJ..."
export function formatRecoveryKey(b32: string): string {
  const upper = b32.toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 4) {
    groups.push(upper.slice(i, i + 4));
  }
  return groups.join("-");
}

// Strip whitespace and hyphens, uppercase — for accepting user input.
export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, "");
}
