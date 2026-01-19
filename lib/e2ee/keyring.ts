/**
 * Keyring: manages master key lifecycle
 * - Setup: create master key, wrap with KEK derived from password, store in Supabase
 * - Unlock: derive KEK from password, unwrap master key
 * - Lock: clear master key from memory
 */

import * as SecureStore from 'expo-secure-store';
import { supabase } from '../supabase';
import {
  deriveKey,
  generateMasterKey,
  generateSalt,
  encrypt,
  decrypt,
  bytesToHex,
  hexToBytes,
} from './crypto';

// Secure store keys
const MASTER_KEY_CACHE = 'banana_master_key';
const BUCKET_KEY_CACHE = 'banana_bucket_key';

// In-memory keys (cleared on lock)
let masterKey: Uint8Array | null = null;
let bucketKey: Uint8Array | null = null;

/**
 * Check if keyring is currently unlocked
 */
export function isKeyringUnlocked(): boolean {
  return masterKey !== null;
}

/**
 * Get the master key (throws if locked)
 */
export function getMasterKey(): Uint8Array {
  if (!masterKey) {
    throw new Error('Keyring is locked. Please unlock with your privacy password.');
  }
  return masterKey;
}

/**
 * Get the bucket key for HMAC operations (throws if locked)
 */
export function getBucketKey(): Uint8Array {
  if (!bucketKey) {
    throw new Error('Keyring is locked. Please unlock with your privacy password.');
  }
  return bucketKey;
}

export const keyring = {
  /**
   * Set up encryption with a new master key
   * Called when user first sets their privacy password
   */
  async setupMasterKey(password: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Check if already has a profile with key
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single();

    if (existing) {
      throw new Error('Encryption already set up. Use unlock instead.');
    }

    // Generate new master key and bucket key
    const newMasterKey = generateMasterKey();
    const newBucketKey = generateMasterKey(); // separate key for buckets
    const salt = generateSalt();

    // Derive KEK from password
    const kdfParams = { N: 32768, r: 8, p: 1 };
    const kek = deriveKey(password, salt, kdfParams);

    // Wrap (encrypt) master key with KEK
    const { ciphertext: wrappedMasterKey, nonce: masterKeyNonce } = encrypt(newMasterKey, kek);
    const { ciphertext: wrappedBucketKey, nonce: bucketKeyNonce } = encrypt(newBucketKey, kek);

    // Store in Supabase
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      wrapped_master_key: bytesToHex(wrappedMasterKey),
      wrapped_master_key_nonce: bytesToHex(masterKeyNonce),
      wrapped_bucket_key: bytesToHex(wrappedBucketKey),
      wrapped_bucket_key_nonce: bytesToHex(bucketKeyNonce),
      kdf_salt: bytesToHex(salt),
      kdf_params: kdfParams,
    });

    if (error) {
      throw new Error(`Failed to save encryption profile: ${error.message}`);
    }

    // Cache locally for session
    masterKey = newMasterKey;
    bucketKey = newBucketKey;

    // Also cache in secure store for app restarts
    await SecureStore.setItemAsync(MASTER_KEY_CACHE, bytesToHex(newMasterKey));
    await SecureStore.setItemAsync(BUCKET_KEY_CACHE, bytesToHex(newBucketKey));
  },

  /**
   * Unlock the keyring with password
   * Derives KEK and unwraps the master key from Supabase
   */
  async unlock(password: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Fetch profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('wrapped_master_key, wrapped_master_key_nonce, wrapped_bucket_key, wrapped_bucket_key_nonce, kdf_salt, kdf_params')
      .eq('id', user.id)
      .single();

    if (error || !profile) {
      throw new Error('No encryption profile found. Set up a privacy password first.');
    }

    // Derive KEK
    const salt = hexToBytes(profile.kdf_salt);
    const kek = deriveKey(password, salt, profile.kdf_params);

    // Unwrap master key
    try {
      const wrappedMasterKey = hexToBytes(profile.wrapped_master_key);
      const masterKeyNonce = hexToBytes(profile.wrapped_master_key_nonce);
      masterKey = decrypt(wrappedMasterKey, kek, masterKeyNonce);

      // Unwrap bucket key if exists
      if (profile.wrapped_bucket_key) {
        const wrappedBucketKey = hexToBytes(profile.wrapped_bucket_key);
        const bucketKeyNonce = hexToBytes(profile.wrapped_bucket_key_nonce);
        bucketKey = decrypt(wrappedBucketKey, kek, bucketKeyNonce);
      } else {
        // Fallback: derive bucket key from master key (for older profiles)
        bucketKey = masterKey;
      }

      // Cache in secure store
      await SecureStore.setItemAsync(MASTER_KEY_CACHE, bytesToHex(masterKey));
      await SecureStore.setItemAsync(BUCKET_KEY_CACHE, bytesToHex(bucketKey));
    } catch (err) {
      throw new Error('Incorrect password');
    }
  },

  /**
   * Try to restore keys from secure storage (for app restart)
   */
  async tryRestoreFromCache(): Promise<boolean> {
    try {
      const cachedMasterKey = await SecureStore.getItemAsync(MASTER_KEY_CACHE);
      const cachedBucketKey = await SecureStore.getItemAsync(BUCKET_KEY_CACHE);

      if (cachedMasterKey) {
        masterKey = hexToBytes(cachedMasterKey);
        bucketKey = cachedBucketKey ? hexToBytes(cachedBucketKey) : masterKey;
        return true;
      }
    } catch (err) {
      console.warn('Failed to restore keyring from cache:', err);
    }
    return false;
  },

  /**
   * Lock the keyring (clear keys from memory)
   */
  lock(): void {
    masterKey = null;
    bucketKey = null;
    // Note: we keep SecureStore cache for convenience
    // User can clear it by signing out
  },

  /**
   * Clear all cached keys (on sign out)
   */
  async clearAll(): Promise<void> {
    masterKey = null;
    bucketKey = null;
    await SecureStore.deleteItemAsync(MASTER_KEY_CACHE);
    await SecureStore.deleteItemAsync(BUCKET_KEY_CACHE);
  },
};

