// Master key caching via SecureStore.
// SecureStore encrypts at rest using iOS Keychain / Android Keystore.
// This lets us keep the user logged in across app restarts without
// re-prompting for password every time.

import * as SecureStore from "expo-secure-store";
import { base64ToBytes, bytesToBase64 } from "./encoding";

// Protocol constant, not branding — renaming orphans cached master keys.
const STORAGE_KEY_PREFIX = "banana_mk_v1";

function storageKey(userId: string): string {
  // Underscores only — SecureStore disallows some chars on Android
  return `${STORAGE_KEY_PREFIX}_${userId.replace(/-/g, "")}`;
}

export async function cacheMasterKey(
  userId: string,
  masterKey: Uint8Array,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      storageKey(userId),
      bytesToBase64(masterKey),
    );
  } catch (err) {
    console.warn("[crypto/cache] Failed to cache master key:", err);
  }
}

export async function loadCachedMasterKey(
  userId: string,
): Promise<Uint8Array | null> {
  try {
    const b64 = await SecureStore.getItemAsync(storageKey(userId));
    if (!b64) return null;
    return base64ToBytes(b64);
  } catch (err) {
    console.warn("[crypto/cache] Failed to load cached master key:", err);
    return null;
  }
}

export async function clearCachedMasterKey(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(storageKey(userId));
  } catch (err) {
    console.warn("[crypto/cache] Failed to clear cached master key:", err);
  }
}
