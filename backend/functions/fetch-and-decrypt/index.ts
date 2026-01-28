import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decrypt } from "../_shared/crypto.ts";
import { getAuthenticatedClient, verifyOwnership, AuthError } from "../_shared/auth.ts";
import { fetchEncryptedData, TableName } from "../_shared/db.ts";
import type { DecryptedItem, ErrorResponse } from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse query params
    const url = new URL(req.url);
    const table = url.searchParams.get("table") as TableName | null;
    const owner_id = url.searchParams.get("owner_id");
    const day_bucket = url.searchParams.get("day_bucket") || undefined;
    const month_bucket = url.searchParams.get("month_bucket") || undefined;

    console.log("[fetch-and-decrypt] Request:", { table, owner_id, day_bucket, month_bucket });

    // Validate required params
    if (!table || !owner_id) {
      return jsonResponse({ error: "Missing required parameters" }, 400);
    }

    // Validate table
    const validTables: TableName[] = ["entries", "habits", "habit_logs"];
    if (!validTables.includes(table)) {
      return jsonResponse({ error: "Invalid table" }, 400);
    }

    // Authenticate and verify ownership
    const { user, supabase } = await getAuthenticatedClient(req);
    console.log("[fetch-and-decrypt] Authenticated user:", user.id);
    verifyOwnership(user.id, owner_id);

    // Fast path: habit logs are plaintext (no decryption)
    if (table === "habit_logs") {
      let query = supabase
        .from("habit_logs")
        .select("id, habit_id, date, completed, day_bucket, month_bucket")
        .eq("owner_id", owner_id);

      if (day_bucket) {
        query = query.eq("day_bucket", day_bucket);
      }
      if (month_bucket) {
        query = query.eq("month_bucket", month_bucket);
      }

      const { data, error } = await query;
      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      const plaintext = (data || []).map((row) => ({
        habitId: row.habit_id,
        date: row.date,
        completed: row.completed,
        _id: row.id,
        _day_bucket: row.day_bucket,
      }));

      return jsonResponse({ data: plaintext });
    }

    // Fetch encrypted data
    console.log("[fetch-and-decrypt] Fetching from", table, "for owner", owner_id);
    const rows = await fetchEncryptedData(supabase, table, {
      owner_id,
      day_bucket,
      month_bucket,
    });
    console.log("[fetch-and-decrypt] Found", rows.length, "rows");

    // Decrypt all rows (async - uses Web Crypto API)
    const decrypted: DecryptedItem[] = [];
    const decryptErrors: string[] = [];
    
    for (const row of rows) {
      try {
        console.log("[fetch-and-decrypt] Decrypting row:", row.id);
        console.log("[fetch-and-decrypt] Ciphertext type:", typeof row.ciphertext);
        console.log("[fetch-and-decrypt] Ciphertext length:", row.ciphertext?.length);
        console.log("[fetch-and-decrypt] Ciphertext preview:", row.ciphertext?.substring(0, 100));
        console.log("[fetch-and-decrypt] Nonce type:", typeof row.nonce);
        console.log("[fetch-and-decrypt] Nonce length:", row.nonce?.length);
        console.log("[fetch-and-decrypt] Nonce:", row.nonce);
        
        // Check if ciphertext/nonce are valid base64 strings
        if (!row.ciphertext || typeof row.ciphertext !== 'string') {
          throw new Error(`Invalid ciphertext type: ${typeof row.ciphertext}`);
        }
        if (!row.nonce || typeof row.nonce !== 'string') {
          throw new Error(`Invalid nonce type: ${typeof row.nonce}`);
        }
        
        // Trim whitespace (in case database added any)
        const ciphertext = row.ciphertext.trim();
        const nonce = row.nonce.trim();
        
        const plaintext = await decrypt(ciphertext, nonce) as Record<string, unknown>;
        decrypted.push({
          ...plaintext,
          _id: row.id,
          _day_bucket: row.day_bucket,
        });
        console.log("[fetch-and-decrypt] Decrypted:", JSON.stringify(plaintext).substring(0, 100));
      } catch (e: unknown) {
        const err = e as Error;
        const errorMsg = `Row ${row.id}: ${err.message}`;
        console.error("[fetch-and-decrypt] Decryption failed:", errorMsg);
        console.error("[fetch-and-decrypt] Full error:", err);
        decryptErrors.push(errorMsg);
      }
    }

    console.log("[fetch-and-decrypt] Returning", decrypted.length, "decrypted items");
    return jsonResponse({ 
      data: decrypted,
      _debug: {
        table,
        owner_id,
        rows_found: rows.length,
        decrypted_count: decrypted.length,
        decrypt_errors: decryptErrors,
      }
    });
  } catch (error: unknown) {
    console.error("[fetch-and-decrypt] Error:", error);

    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, error.statusCode);
    }

    const err = error as Error;
    const response: ErrorResponse = {
      error: err.message || "Internal server error",
    };
    return jsonResponse(response, 500);
  }
});
