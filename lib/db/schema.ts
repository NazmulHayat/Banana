export const Tables = {
  ACCOUNTS: "accounts",
  PROFILES: "profiles",
  ENTRIES: "entries",
  ENTRY_MEDIA: "entry_media",
  HABITS: "habits",
  HABIT_LOGS: "habit_logs",
} as const;

export const AccountColumns = {
  ID: "id",
  USERNAME: "username",
  EMAIL: "email",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const ProfileColumns = {
  ID: "id",
  WRAPPED_MASTER_KEY: "wrapped_master_key",
  WRAPPED_MASTER_KEY_NONCE: "wrapped_master_key_nonce",
  KDF_SALT: "kdf_salt",
  KDF_PARAMS: "kdf_params",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const EntryColumns = {
  ID: "id",
  OWNER_ID: "owner_id",
  DAY_BUCKET: "day_bucket",
  MONTH_BUCKET: "month_bucket",
  CIPHERTEXT: "ciphertext",
  NONCE: "nonce",
  VERSION: "version",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const EntryMediaColumns = {
  ID: "id",
  ENTRY_ID: "entry_id",
  OWNER_ID: "owner_id",
  OBJECT_PATH: "object_path",
  CIPHERTEXT_META: "ciphertext_meta",
  NONCE: "nonce",
  VERSION: "version",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const HabitColumns = {
  ID: "id",
  OWNER_ID: "owner_id",
  CIPHERTEXT: "ciphertext",
  NONCE: "nonce",
  VERSION: "version",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const HabitLogColumns = {
  ID: "id",
  OWNER_ID: "owner_id",
  DAY_BUCKET: "day_bucket",
  MONTH_BUCKET: "month_bucket",
  CIPHERTEXT: "ciphertext",
  NONCE: "nonce",
  VERSION: "version",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
} as const;

export const UsernameRules = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 20,
  PATTERN: /^[a-z0-9_]{3,20}$/,
  validate(username: string): { valid: boolean; error?: string } {
    const normalized = username.toLowerCase();
    if (normalized.length < this.MIN_LENGTH) {
      return {
        valid: false,
        error: `Username must be at least ${this.MIN_LENGTH} characters`,
      };
    }
    if (normalized.length > this.MAX_LENGTH) {
      return {
        valid: false,
        error: `Username must be at most ${this.MAX_LENGTH} characters`,
      };
    }
    if (!this.PATTERN.test(normalized)) {
      return {
        valid: false,
        error: "Username can only contain letters, numbers, and underscores",
      };
    }
    return { valid: true };
  },
} as const;

export const HabitLimits = {
  MAX_NAME_LENGTH: 20,
} as const;

export const DateFormats = {
  formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  },
  formatMonth(date: Date): string {
    return date.toISOString().slice(0, 7);
  },
  formatYearMonth(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, "0")}`;
  },
} as const;

export const SCHEMA_VERSION = 1;
