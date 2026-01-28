// Edge Function Types

export type TableName = "entries" | "habits" | "habit_logs";

// Request/Response Types
export interface EncryptAndSaveRequest {
  table: TableName;
  data: Record<string, unknown> | Array<Record<string, unknown>>;
  owner_id: string;
  replace?: boolean;
  day_bucket?: string;
  month_bucket?: string;
}

export interface FetchAndDecryptRequest {
  table: TableName;
  owner_id: string;
  day_bucket?: string;
  month_bucket?: string;
}

export interface DecryptedItem {
  _id: string;
  _day_bucket?: string;
  [key: string]: unknown;
}

export interface ErrorResponse {
  error: string;
  code?: string;
}

// Database Row Types
export interface EncryptedRow {
  id: string;
  owner_id: string;
  ciphertext: string;
  nonce: string;
  day_bucket?: string;
  month_bucket?: string;
}

export interface SaveData {
  owner_id: string;
  ciphertext: string;
  nonce: string;
  day_bucket?: string;
  month_bucket?: string;
}
