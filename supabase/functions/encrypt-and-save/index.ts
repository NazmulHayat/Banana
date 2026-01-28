import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encrypt } from "../_shared/crypto.ts";
import { getAuthenticatedClient, verifyOwnership, AuthError } from "../_shared/auth.ts";
import { saveEncryptedData, saveEncryptedDataBatch, TableName } from "../_shared/db.ts";
import type { EncryptAndSaveRequest, ErrorResponse } from "../_shared/types.ts";

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
    // Parse request
    const body: EncryptAndSaveRequest = await req.json();
    const { table, data, owner_id, day_bucket, month_bucket, replace } = body;

    // Validate table
    const validTables: TableName[] = ["entries", "habits", "habit_logs"];
    if (!validTables.includes(table)) {
      return jsonResponse({ error: "Invalid table" }, 400);
    }

    // Authenticate and verify ownership
    const { user, supabase } = await getAuthenticatedClient(req);
    verifyOwnership(user.id, owner_id);

    // Batch replace for habits (faster, single request)
    if (table === "habits" && Array.isArray(data) && replace) {
      // Remove existing habits first
      const { error: deleteError } = await supabase
        .from("habits")
        .delete()
        .eq("owner_id", owner_id);

      if (deleteError) {
        throw new Error(`Database error: ${deleteError.message}`);
      }

      const encryptedRows = await Promise.all(
        data.map(async (item) => {
          const { ciphertext, nonce } = await encrypt(item);
          return { owner_id, ciphertext, nonce };
        })
      );

      await saveEncryptedDataBatch(supabase, table, encryptedRows);

      return jsonResponse({ success: true, count: encryptedRows.length });
    }

    if (Array.isArray(data)) {
      return jsonResponse({ error: "Batch mode is only supported for habits" }, 400);
    }

    // Habit logs are plaintext (no encryption) for speed
    if (table === "habit_logs") {
      const payload = data as Record<string, unknown>;
      const habitId = payload.habitId;
      const date = payload.date;
      const completed = payload.completed;

      if (typeof habitId !== "string" || typeof date !== "string" || typeof completed !== "boolean") {
        return jsonResponse({ error: "Invalid habit log payload" }, 400);
      }

      const { error } = await supabase.from("habit_logs").upsert({
        owner_id,
        habit_id: habitId,
        date,
        completed,
        day_bucket: day_bucket || null,
        month_bucket: month_bucket || null,
      }, { onConflict: "owner_id,day_bucket" });

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return jsonResponse({ success: true });
    }

    // Encrypt single payload (async - uses Web Crypto API)
    const { ciphertext, nonce } = await encrypt(data);

    // Entries should upsert by day to avoid unique constraint errors
    if (table === "entries") {
      const { error } = await supabase.from("entries").upsert(
        {
          owner_id,
          day_bucket: day_bucket || null,
          month_bucket: month_bucket || null,
          ciphertext,
          nonce,
        },
        { onConflict: "owner_id,day_bucket" }
      );

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return jsonResponse({ success: true });
    }

    // Save to database (default insert)
    await saveEncryptedData(supabase, table, {
      owner_id,
      ciphertext,
      nonce,
      day_bucket,
      month_bucket,
    });

    return jsonResponse({ success: true });
  } catch (error: unknown) {
    console.error("[encrypt-and-save] Error:", error);

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
