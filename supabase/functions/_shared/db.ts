// Database operations for Edge Functions
// Table-aware: handles different schemas for each table type

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EncryptedRow, SaveData, TableName } from "./types.ts";

/**
 * Table metadata - defines which columns each table has
 * This is the single source of truth for table schemas
 */
const TABLE_CONFIG: Record<TableName, { hasBuckets: boolean }> = {
  entries: { hasBuckets: true },      // Has day_bucket, month_bucket for date queries
  habits: { hasBuckets: false },      // No buckets - just habit definitions
  habit_logs: { hasBuckets: true },   // Has day_bucket, month_bucket for date queries
};

function buildInsertData(table: TableName, data: SaveData): Record<string, unknown> {
  const config = TABLE_CONFIG[table];
  const insertData: Record<string, unknown> = {
    owner_id: data.owner_id,
    ciphertext: data.ciphertext,
    nonce: data.nonce,
  };

  if (config.hasBuckets) {
    insertData.day_bucket = data.day_bucket || null;
    insertData.month_bucket = data.month_bucket || null;
  }

  return insertData;
}

/**
 * Save encrypted data to database
 * Automatically handles table-specific columns
 */
export async function saveEncryptedData(
  supabase: SupabaseClient,
  table: TableName,
  data: SaveData
): Promise<void> {
  const insertData = buildInsertData(table, data);

  console.log(`[db] Inserting into ${table}:`, JSON.stringify(insertData).substring(0, 200));

  const { data: insertedData, error } = await supabase
    .from(table)
    .insert(insertData)
    .select();

  console.log(`[db] Insert result - data:`, insertedData, `error:`, error);

  if (error) {
    console.error(`[db] Insert error for ${table}:`, error);
    throw new Error(`Database error: ${error.message}`);
  }

  if (!insertedData || insertedData.length === 0) {
    console.error(`[db] Insert returned no data for ${table} - possible RLS issue`);
    throw new Error(`Database error: Insert returned no data (check RLS policies)`);
  }

  console.log(`[db] Successfully inserted into ${table}, id:`, insertedData[0]?.id);
}

/**
 * Save multiple encrypted rows in a single insert
 */
export async function saveEncryptedDataBatch(
  supabase: SupabaseClient,
  table: TableName,
  data: SaveData[]
): Promise<void> {
  if (data.length === 0) {
    return;
  }

  const insertData = data.map((item) => buildInsertData(table, item));

  console.log(`[db] Batch inserting ${insertData.length} rows into ${table}`);

  const { data: insertedData, error } = await supabase
    .from(table)
    .insert(insertData)
    .select();

  if (error) {
    console.error(`[db] Batch insert error for ${table}:`, error);
    throw new Error(`Database error: ${error.message}`);
  }

  if (!insertedData || insertedData.length !== insertData.length) {
    console.error(`[db] Batch insert returned unexpected row count for ${table}`);
    throw new Error(`Database error: Insert returned unexpected row count`);
  }
}

export interface FetchFilters {
  owner_id: string;
  day_bucket?: string;
  month_bucket?: string;
}

/**
 * Fetch encrypted data from database
 * Automatically handles table-specific columns
 */
export async function fetchEncryptedData(
  supabase: SupabaseClient,
  table: TableName,
  filters: FetchFilters
): Promise<EncryptedRow[]> {
  const config = TABLE_CONFIG[table];
  
  // Build select columns based on table schema
  const columns = config.hasBuckets
    ? "id, owner_id, ciphertext, nonce, day_bucket, month_bucket"
    : "id, owner_id, ciphertext, nonce";

  console.log(`[db] Fetching from ${table} for owner:`, filters.owner_id);

  let query = supabase
    .from(table)
    .select(columns)
    .eq("owner_id", filters.owner_id);

  // Only filter by buckets for tables that have them
  if (config.hasBuckets) {
    if (filters.day_bucket) {
      query = query.eq("day_bucket", filters.day_bucket);
    }
    if (filters.month_bucket) {
      query = query.eq("month_bucket", filters.month_bucket);
    }
  }

  const { data, error } = await query;

  console.log(`[db] Fetch result for ${table} - found ${data?.length || 0} rows, error:`, error);

  if (error) {
    console.error(`[db] Fetch error for ${table}:`, error);
    throw new Error(`Database error: ${error.message}`);
  }

  return data as EncryptedRow[];
}

// Re-export TableName for convenience
export type { TableName };
