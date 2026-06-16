// Keyring: the master object that owns the user's master key in memory
// and handles all wrap/unwrap operations against Supabase.
//
// Lifecycle:
//   signup → setupNewUser(userId, password) → write wrapped blob to profiles
//             → cached in memory + SecureStore
//   login  → unlock(userId, password) → fetch profile → derive KEK
//             → unwrap master → cache
//   restart → tryRestoreFromCache(userId) → load master from SecureStore
//   logout → lock() → zeroize memory + wipe SecureStore
//
// All client-side. Server only ever sees ciphertext.
//
// All AES-GCM operations bind ciphertext to its context via AAD
// (see lib/crypto/payload.ts), so a malicious server admin cannot swap
// ciphertext between rows or between users.

import { supabase } from "../supabase";
import {
  cacheMasterKey,
  clearCachedMasterKey,
  loadCachedMasterKey,
} from "./cache";
import {
  base32ToBytes,
  base64ToBytes,
  bytesToBase32,
  bytesToBase64,
  formatRecoveryKey,
  normalizeRecoveryKey,
} from "./encoding";
import { AAD } from "./payload";
import {
  aesDecrypt,
  aesEncrypt,
  deriveKekAsync,
  DEFAULT_KDF_PARAMS,
  generateMasterKey,
  generateSalt,
  KdfParams,
  randomBytes,
} from "./primitives";

interface ProfileBlob {
  id: string;
  wrapped_master_key: string;
  wrapped_master_key_nonce: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  wrapped_master_recovery: string | null;
  wrapped_master_recovery_nonce: string | null;
  recovery_key_display: string | null;
  recovery_key_display_nonce: string | null;
  recovery_key_hint: string | null;
}

const RECOVERY_KEY_BYTES = 32;

function zeroize(arr: Uint8Array | null): void {
  if (arr) arr.fill(0);
}

class Keyring {
  private masterKey: Uint8Array | null = null;
  private userId: string | null = null;

  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  /** Returns a defensive copy — callers can't accidentally mutate our state. */
  getMasterKey(): Uint8Array {
    if (!this.masterKey) {
      throw new Error("Keyring is locked. Sign in to unlock.");
    }
    return new Uint8Array(this.masterKey);
  }

  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Signup: generate master key + recovery key, wrap both, persist blobs.
   * Refuses to overwrite an existing keyring (use unlock or unlockWithRecoveryKey).
   * Returns the recovery key (formatted for display) — caller MUST show it.
   */
  async setupNewUser(
    userId: string,
    password: string,
  ): Promise<{ recoveryKey: string }> {
    // Idempotency guard: refuse to overwrite an existing wrapped key
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (existing) {
      throw new Error(
        "An encryption profile already exists for this account. " +
          "Sign in with your password (or use your recovery key) instead.",
      );
    }

    const masterKey = generateMasterKey();
    const recoveryKeyBytes = randomBytes(RECOVERY_KEY_BYTES);

    try {
      // Wrap master key with password-derived KEK
      const salt = generateSalt();
      const params = DEFAULT_KDF_PARAMS;
      const kek = await deriveKekAsync(password, salt, params);

      try {
        const { ciphertext: wrappedMaster, nonce: wrappedMasterNonce } =
          aesEncrypt(kek, masterKey, encode(AAD.wrapMaster(userId)));

        // Wrap master key with recovery key (independent recovery path)
        const { ciphertext: wrappedRecovery, nonce: wrappedRecoveryNonce } =
          aesEncrypt(
            recoveryKeyBytes,
            masterKey,
            encode(AAD.wrapRecovery(userId)),
          );

        // Encrypt the recovery key WITH the master key so it can be revealed
        // later in Settings.
        const { ciphertext: recoveryDisplay, nonce: recoveryDisplayNonce } =
          aesEncrypt(
            masterKey,
            recoveryKeyBytes,
            encode(AAD.recoveryDisplay(userId)),
          );

        const recoveryKeyB32 = bytesToBase32(recoveryKeyBytes);
        const recoveryFormatted = formatRecoveryKey(recoveryKeyB32);
        const hint = recoveryKeyB32.slice(0, 4);

        const { error } = await supabase.from("profiles").insert({
          id: userId,
          wrapped_master_key: bytesToBase64(wrappedMaster),
          wrapped_master_key_nonce: bytesToBase64(wrappedMasterNonce),
          kdf_salt: bytesToBase64(salt),
          kdf_params: params,
          wrapped_master_recovery: bytesToBase64(wrappedRecovery),
          wrapped_master_recovery_nonce: bytesToBase64(wrappedRecoveryNonce),
          recovery_key_display: bytesToBase64(recoveryDisplay),
          recovery_key_display_nonce: bytesToBase64(recoveryDisplayNonce),
          recovery_key_hint: hint,
          recovery_key_created_at: new Date().toISOString(),
        });

        if (error) {
          throw new Error(`Failed to create keyring profile: ${error.message}`);
        }

        this.masterKey = masterKey;
        this.userId = userId;
        await cacheMasterKey(userId, masterKey);

        return { recoveryKey: recoveryFormatted };
      } finally {
        // Zeroize the KEK regardless of success
        zeroize(kek);
      }
    } finally {
      // Zeroize the recovery key bytes — only the formatted string returned
      // to the caller persists, and only briefly while the user records it.
      zeroize(recoveryKeyBytes);
    }
  }

  /**
   * Login: fetch wrapped blob, unwrap with password.
   */
  async unlock(userId: string, password: string): Promise<void> {
    const profile = await this.fetchProfile(userId);
    const salt = base64ToBytes(profile.kdf_salt);
    const params = profile.kdf_params || DEFAULT_KDF_PARAMS;
    const kek = await deriveKekAsync(password, salt, params);

    try {
      const masterKey = aesDecrypt(
        kek,
        base64ToBytes(profile.wrapped_master_key),
        base64ToBytes(profile.wrapped_master_key_nonce),
        encode(AAD.wrapMaster(userId)),
      );

      // Successful unlock — replace any existing key
      this.lockInternal();
      this.masterKey = masterKey;
      this.userId = userId;
      await cacheMasterKey(userId, masterKey);
    } catch {
      throw new Error("Incorrect password");
    } finally {
      zeroize(kek);
    }
  }

  /**
   * App restart: try restoring master key from SecureStore.
   * Returns true if cache was present and loaded.
   */
  async tryRestoreFromCache(userId: string): Promise<boolean> {
    const cached = await loadCachedMasterKey(userId);
    if (!cached) return false;
    this.lockInternal();
    this.masterKey = cached;
    this.userId = userId;
    return true;
  }

  /**
   * Recovery: unlock with recovery key (for forgot-password flow).
   * Expects the formatted/normalized recovery key string the user pasted.
   */
  async unlockWithRecoveryKey(
    userId: string,
    recoveryKeyInput: string,
  ): Promise<void> {
    const profile = await this.fetchProfile(userId);
    if (
      !profile.wrapped_master_recovery ||
      !profile.wrapped_master_recovery_nonce
    ) {
      throw new Error(
        "No recovery key was set up for this account. Sign in with your password instead.",
      );
    }

    const normalized = normalizeRecoveryKey(recoveryKeyInput);
    let recoveryBytes: Uint8Array;
    try {
      recoveryBytes = base32ToBytes(normalized, RECOVERY_KEY_BYTES);
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : "Recovery key format is invalid",
      );
    }

    try {
      const masterKey = aesDecrypt(
        recoveryBytes,
        base64ToBytes(profile.wrapped_master_recovery),
        base64ToBytes(profile.wrapped_master_recovery_nonce),
        encode(AAD.wrapRecovery(userId)),
      );
      this.lockInternal();
      this.masterKey = masterKey;
      this.userId = userId;
      await cacheMasterKey(userId, masterKey);
    } catch {
      throw new Error("Incorrect recovery key");
    } finally {
      zeroize(recoveryBytes);
    }
  }

  /**
   * After recovery (or while logged in): set a new password.
   * Re-derives KEK with fresh salt and re-wraps master key.
   */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (!this.masterKey || this.userId !== userId) {
      throw new Error("Cannot change password while keyring is locked");
    }
    const salt = generateSalt();
    const params = DEFAULT_KDF_PARAMS;
    const kek = await deriveKekAsync(newPassword, salt, params);
    try {
      const { ciphertext: wrapped, nonce } = aesEncrypt(
        kek,
        this.masterKey,
        encode(AAD.wrapMaster(userId)),
      );

      const { error } = await supabase
        .from("profiles")
        .update({
          wrapped_master_key: bytesToBase64(wrapped),
          wrapped_master_key_nonce: bytesToBase64(nonce),
          kdf_salt: bytesToBase64(salt),
          kdf_params: params,
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to update password wrap: ${error.message}`);
      }
    } finally {
      zeroize(kek);
    }
  }

  /**
   * Settings: reveal the existing recovery key (requires unlocked keyring).
   * The keyring being unlocked already proves user authorization — they typed
   * their password recently or have SecureStore access on this device.
   */
  async getRecoveryKey(userId: string): Promise<string> {
    if (!this.masterKey || this.userId !== userId) {
      throw new Error("Keyring is locked");
    }
    const profile = await this.fetchProfile(userId);
    if (!profile.recovery_key_display || !profile.recovery_key_display_nonce) {
      throw new Error("No recovery key on file. Generate one first.");
    }
    const recoveryBytes = aesDecrypt(
      this.masterKey,
      base64ToBytes(profile.recovery_key_display),
      base64ToBytes(profile.recovery_key_display_nonce),
      encode(AAD.recoveryDisplay(userId)),
    );
    try {
      return formatRecoveryKey(bytesToBase32(recoveryBytes));
    } finally {
      zeroize(recoveryBytes);
    }
  }

  /**
   * Settings: regenerate the recovery key (invalidates the old one).
   */
  async regenerateRecoveryKey(userId: string): Promise<string> {
    if (!this.masterKey || this.userId !== userId) {
      throw new Error("Keyring is locked");
    }
    const newRecovery = randomBytes(RECOVERY_KEY_BYTES);
    try {
      const { ciphertext: wrappedRecovery, nonce: wrappedRecoveryNonce } =
        aesEncrypt(newRecovery, this.masterKey, encode(AAD.wrapRecovery(userId)));
      const { ciphertext: display, nonce: displayNonce } = aesEncrypt(
        this.masterKey,
        newRecovery,
        encode(AAD.recoveryDisplay(userId)),
      );
      const b32 = bytesToBase32(newRecovery);

      const { error } = await supabase
        .from("profiles")
        .update({
          wrapped_master_recovery: bytesToBase64(wrappedRecovery),
          wrapped_master_recovery_nonce: bytesToBase64(wrappedRecoveryNonce),
          recovery_key_display: bytesToBase64(display),
          recovery_key_display_nonce: bytesToBase64(displayNonce),
          recovery_key_hint: b32.slice(0, 4),
          recovery_key_created_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to save new recovery key: ${error.message}`);
      }
      return formatRecoveryKey(b32);
    } finally {
      zeroize(newRecovery);
    }
  }

  /**
   * Logout / lock — zeroize memory and wipe SecureStore.
   */
  async lock(): Promise<void> {
    const uid = this.userId;
    this.lockInternal();
    if (uid) {
      await clearCachedMasterKey(uid);
    }
  }

  /** Internal: zeroize keys in memory without touching SecureStore. */
  private lockInternal(): void {
    zeroize(this.masterKey);
    this.masterKey = null;
    this.userId = null;
  }

  private async fetchProfile(userId: string): Promise<ProfileBlob> {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, wrapped_master_key, wrapped_master_key_nonce, kdf_salt, kdf_params, wrapped_master_recovery, wrapped_master_recovery_nonce, recovery_key_display, recovery_key_display_nonce, recovery_key_hint",
      )
      .eq("id", userId)
      .single();

    if (error || !data) {
      throw new Error(
        `Could not fetch your encryption profile: ${error?.message ?? "not found"}`,
      );
    }
    return data as ProfileBlob;
  }
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export const keyring = new Keyring();
