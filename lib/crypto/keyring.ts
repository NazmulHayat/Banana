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

/** What `setupNewUser` did — a fresh keyring, or one it resumed. */
export interface KeyringSetupResult {
  /**
   * Formatted recovery key to show the user once. `null` only when an existing
   * keyring was resumed and its display copy couldn't be read — the user views
   * it in Settings → Security instead of being handed a new one.
   */
  recoveryKey: string | null;
  /** True when an existing keyring was unlocked instead of a new one created. */
  resumed: boolean;
}

const RECOVERY_KEY_BYTES = 32;

/** Postgres unique-violation — the profile row was created by an earlier run. */
const PG_UNIQUE_VIOLATION = "23505";

// Every message here can end up in front of a user, so they stay calm and
// actionable and never carry a raw Postgres/Supabase string.
const Copy = {
  unreachable:
    "We couldn't reach your encryption profile. Check your connection and try again.",
  setupFailed:
    "We couldn't finish setting up your encryption. Check your connection and try again — nothing was lost.",
  alreadySetUp:
    "This account already has encryption set up, and this password doesn't match it. " +
    "Sign in with the password you first chose, or restore with your recovery key.",
  wrongPassword: "Incorrect password",
  rewrapFailed:
    "We couldn't save your new password to your encryption profile. Your previous password still unlocks your data.",
} as const;

// Narrow select — the keyring row is read in exactly one shape.
const PROFILE_COLUMNS =
  "id, wrapped_master_key, wrapped_master_key_nonce, kdf_salt, kdf_params, wrapped_master_recovery, wrapped_master_recovery_nonce, recovery_key_display, recovery_key_display_nonce, recovery_key_hint";

function zeroize(arr: Uint8Array | null): void {
  if (arr) arr.fill(0);
}

/** Constant-time-ish equality for key material (length + full scan). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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
   *
   * IDEMPOTENT (the profile row is the user's only copy of the wrapped master
   * key — overwriting it would orphan every ciphertext they already wrote).
   * A second run after an interrupted signup or email verification therefore
   * never inserts over an existing row: it re-derives the KEK from the same
   * password, unlocks the keyring that is already there, and resumes. A
   * password that doesn't match the existing wrap is refused, never used to
   * replace it.
   *
   * Returns the recovery key (formatted for display) — caller MUST show it.
   * `recoveryKey` is null only when we resumed a keyring whose display copy is
   * missing, in which case the user views it in Settings → Security instead.
   */
  async setupNewUser(
    userId: string,
    password: string,
  ): Promise<KeyringSetupResult> {
    // Cheap pre-check for the common resume case. The real guard is the
    // primary key on profiles.id, handled on the insert below — this select
    // just saves a wasted key generation + scrypt.
    const existing = await this.fetchProfileOrNull(userId);
    if (existing) return this.resumeSetup(userId, password, existing);

    const masterKey = generateMasterKey();
    const recoveryKeyBytes = randomBytes(RECOVERY_KEY_BYTES);
    // Until the row lands and we adopt the key, it's ours to zeroize.
    let adopted = false;

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
          // Lost the race with an earlier attempt (or a second device): the
          // row that won is authoritative, so drop the key we just made and
          // resume from theirs.
          if (error.code === PG_UNIQUE_VIOLATION) {
            const row = await this.fetchProfileOrNull(userId);
            if (row) return await this.resumeSetup(userId, password, row);
          }
          if (__DEV__) {
            console.warn("[keyring] profile insert failed:", error.message);
          }
          throw new Error(Copy.setupFailed);
        }

        adopted = true;
        await this.adopt(userId, masterKey);

        return { recoveryKey: recoveryFormatted, resumed: false };
      } finally {
        // Zeroize the KEK regardless of success
        zeroize(kek);
      }
    } finally {
      // Zeroize the recovery key bytes — only the formatted string returned
      // to the caller persists, and only briefly while the user records it.
      zeroize(recoveryKeyBytes);
      // A master key that never made it into a row is unreachable now; don't
      // leave it sitting in memory.
      if (!adopted) zeroize(masterKey);
    }
  }

  /**
   * Resume an interrupted setup: the profile row already exists, so unlock it
   * with the password we were given instead of writing anything. Refuses (and
   * changes nothing) when the password doesn't open the existing wrap.
   */
  private async resumeSetup(
    userId: string,
    password: string,
    profile: ProfileBlob,
  ): Promise<KeyringSetupResult> {
    try {
      await this.unlockWithProfile(userId, password, profile);
    } catch {
      throw new Error(Copy.alreadySetUp);
    }

    // Best effort: show the recovery key that was minted the first time round
    // rather than a new one — regenerating would silently invalidate a key the
    // user may already have saved.
    let recoveryKey: string | null = null;
    if (profile.recovery_key_display && profile.recovery_key_display_nonce) {
      try {
        recoveryKey = this.decryptRecoveryDisplay(userId, profile);
      } catch {
        recoveryKey = null;
      }
    }
    return { recoveryKey, resumed: true };
  }

  /**
   * Login: fetch wrapped blob, unwrap with password.
   */
  async unlock(userId: string, password: string): Promise<void> {
    const profile = await this.fetchProfile(userId);
    await this.unlockWithProfile(userId, password, profile);
  }

  /**
   * Shared unwrap path for `unlock` and `resumeSetup` — derives the KEK from
   * the profile's own salt/params and adopts the master key on success. Throws
   * `Incorrect password` (and touches nothing) when the wrap doesn't open.
   */
  private async unlockWithProfile(
    userId: string,
    password: string,
    profile: ProfileBlob,
  ): Promise<void> {
    const salt = base64ToBytes(profile.kdf_salt);
    const params = profile.kdf_params || DEFAULT_KDF_PARAMS;
    const kek = await deriveKekAsync(password, salt, params);

    let masterKey: Uint8Array;
    try {
      masterKey = aesDecrypt(
        kek,
        base64ToBytes(profile.wrapped_master_key),
        base64ToBytes(profile.wrapped_master_key_nonce),
        encode(AAD.wrapMaster(userId)),
      );
    } catch {
      // Only the unwrap lives in this try — a failing SecureStore write must
      // not be reported to the user as a wrong password.
      throw new Error(Copy.wrongPassword);
    } finally {
      zeroize(kek);
    }

    await this.adopt(userId, masterKey);
  }

  /**
   * Take ownership of a freshly unwrapped master key: replace whatever was
   * held before, then cache it. A failed cache is non-fatal — the keyring is
   * live for this session, the user just signs in again after a restart.
   */
  private async adopt(userId: string, masterKey: Uint8Array): Promise<void> {
    this.lockInternal();
    this.masterKey = masterKey;
    this.userId = userId;
    try {
      await cacheMasterKey(userId, masterKey);
    } catch (e) {
      if (__DEV__) console.warn("[keyring] master key cache write failed:", e);
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

    let masterKey: Uint8Array;
    try {
      masterKey = aesDecrypt(
        recoveryBytes,
        base64ToBytes(profile.wrapped_master_recovery),
        base64ToBytes(profile.wrapped_master_recovery_nonce),
        encode(AAD.wrapRecovery(userId)),
      );
    } catch {
      throw new Error("Incorrect recovery key");
    } finally {
      zeroize(recoveryBytes);
    }

    await this.adopt(userId, masterKey);
  }

  /**
   * After recovery (or while logged in): set a new password.
   * Re-derives KEK with a fresh salt and re-wraps the master key.
   *
   * Only the password columns move — `wrapped_master_recovery` is untouched,
   * so the recovery key keeps working after a password change. The new wrap is
   * verified locally before it is written, so we never replace a working wrap
   * with one that can't be opened, and the write itself is a single row update
   * (all four columns land together or none do).
   */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (!this.masterKey || this.userId !== userId) {
      throw new Error("Cannot change password while keyring is locked");
    }
    const salt = generateSalt();
    const params = DEFAULT_KDF_PARAMS;
    const kek = await deriveKekAsync(newPassword, salt, params);
    try {
      const aad = encode(AAD.wrapMaster(userId));
      const { ciphertext: wrapped, nonce } = aesEncrypt(
        kek,
        this.masterKey,
        aad,
      );

      // Prove the new wrap opens back to the same master key BEFORE it
      // replaces the working one.
      const check = aesDecrypt(kek, wrapped, nonce, aad);
      try {
        if (!bytesEqual(check, this.masterKey)) {
          throw new Error(Copy.rewrapFailed);
        }
      } finally {
        zeroize(check);
      }

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
        if (__DEV__) {
          console.warn("[keyring] password re-wrap failed:", error.message);
        }
        throw new Error(Copy.rewrapFailed);
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
    return this.decryptRecoveryDisplay(userId, profile);
  }

  /** Unwrap the stored display copy of the recovery key. Keyring must be open. */
  private decryptRecoveryDisplay(
    userId: string,
    profile: ProfileBlob,
  ): string {
    if (
      !this.masterKey ||
      !profile.recovery_key_display ||
      !profile.recovery_key_display_nonce
    ) {
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
    const profile = await this.fetchProfileOrNull(userId);
    if (!profile) {
      throw new Error(
        "We couldn't find the encryption profile for this account. Sign in again to finish setting it up.",
      );
    }
    return profile;
  }

  /**
   * Read the keyring row, or null when the user simply doesn't have one yet.
   * A transport error throws instead of returning null — "we couldn't ask" and
   * "there is no keyring" must never be confused on the setup path.
   */
  private async fetchProfileOrNull(
    userId: string,
  ): Promise<ProfileBlob | null> {
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      if (__DEV__) {
        console.warn("[keyring] profile fetch failed:", error.message);
      }
      throw new Error(Copy.unreachable);
    }
    return (data as ProfileBlob | null) ?? null;
  }
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export const keyring = new Keyring();
