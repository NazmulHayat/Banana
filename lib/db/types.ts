// App Models
export interface Habit {
  id: string;
  name: string;
  createdAt: string;
}

export interface DailyEntry {
  id: string;
  date: string;
  text: string;
  mediaUrls: string[];
  createdAt: string;
}

export interface HabitLog {
  habitId: string;
  date: string;
  completed: boolean;
}

// DB Row Types (matches Supabase schema)
export interface AccountRow {
  id: string;
  username: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileRow {
  id: string;
  wrapped_master_key: string; // bytea -> base64
  wrapped_master_key_nonce: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  created_at: string;
  updated_at: string;
}

export interface EntryRow {
  id: string;
  owner_id: string;
  day_bucket: string;
  month_bucket: string;
  ciphertext: string; // bytea -> base64
  nonce: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EntryMediaRow {
  id: string;
  entry_id: string;
  owner_id: string;
  object_path: string;
  ciphertext_meta: string; // bytea -> base64
  nonce: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface HabitRow {
  id: string;
  owner_id: string;
  ciphertext: string; // bytea -> base64
  nonce: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface HabitLogRow {
  id: string;
  owner_id: string;
  day_bucket: string;
  month_bucket: string;
  ciphertext: string; // bytea -> base64
  nonce: string;
  version: number;
  created_at: string;
  updated_at: string;
}

// Encrypted Payloads
export interface EntryPayload {
  date: string;
  entries: Array<{
    id: string;
    text: string;
    createdAt: string;
    localMediaUrls?: string[];
  }>;
}

export interface LegacyEntryPayload {
  date: string;
  text: string;
  createdAt: string;
  localMediaUrls?: string[];
}

export interface HabitPayload {
  id: string;
  name: string;
  createdAt: string;
}

export interface HabitLogPayload {
  habitId: string;
  date: string;
  completed: boolean;
}

// Utility Types
export interface KdfParams {
  N: number;
  r: number;
  p: number;
}

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
}
