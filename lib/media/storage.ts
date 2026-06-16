// Image upload/display helpers.
//
// v1 model: images are uploaded to Supabase Storage in a private bucket
// scoped by user. The object path lives inside the encrypted entry payload,
// so the server can't tell which entry an image belongs to or what it depicts.
// The image BYTES themselves are NOT client-side encrypted in v1 — they're
// protected by Supabase's at-rest encryption + RLS only. v1.1 will add full
// per-image encryption.

import { File } from "expo-file-system";
import { supabase } from "../supabase";

const BUCKET = "private-media";

function generateMediaId(): string {
  // Random 16-byte hex — used as filename
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function guessContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

function guessExt(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".heic")) return "heic";
  return "jpg";
}

/**
 * Upload a local image (file:// URI from ImagePicker) to the user's private bucket.
 * Returns the object path that should be stored in the encrypted entry payload.
 */
export async function uploadImage(
  localUri: string,
  entryId: string,
  userId: string,
): Promise<string> {
  const ext = guessExt(localUri);
  const mediaId = generateMediaId();
  const objectPath = `${userId}/${entryId}/${mediaId}.${ext}`;

  // Read the local file as raw bytes (Expo SDK 54+ File API)
  const bytes = await new File(localUri).bytes();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType: guessContentType(localUri),
      upsert: false,
    });

  if (error) {
    throw new Error(`Image upload failed: ${error.message}`);
  }

  return objectPath;
}

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Get a temporary signed URL for displaying the image.
 * Cached for ~50 minutes (signed URLs expire after 1 hour).
 */
export async function getImageUrl(objectPath: string): Promise<string | null> {
  const now = Date.now();
  const cached = urlCache.get(objectPath);
  if (cached && cached.expiresAt > now) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60 * 60); // 1 hour

  if (error || !data) {
    console.warn("[media] Signed URL failed for", objectPath, error?.message);
    return null;
  }

  urlCache.set(objectPath, {
    url: data.signedUrl,
    expiresAt: now + 50 * 60 * 1000, // 50 min, leave buffer
  });

  return data.signedUrl;
}

export async function deleteImage(objectPath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) {
    console.warn("[media] Delete failed for", objectPath, error.message);
  }
  urlCache.delete(objectPath);
}

export function clearMediaCache(): void {
  urlCache.clear();
}

/**
 * Recursively list + delete every object under a user's prefix in the private
 * media bucket. Called before delete_my_account() because Supabase blocks
 * direct DELETE from storage.objects via SECURITY DEFINER RPCs.
 */
export async function clearUserMedia(userId: string): Promise<void> {
  // List entryId folders under <userId>/
  const { data: entryDirs, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(userId, { limit: 1000 });

  if (listErr) {
    if (__DEV__) {
      console.warn("[media] clearUserMedia list failed:", listErr.message);
    }
    return;
  }
  if (!entryDirs || entryDirs.length === 0) return;

  for (const dir of entryDirs) {
    const prefix = `${userId}/${dir.name}`;
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000 });
    if (!files || files.length === 0) continue;
    const paths = files.map((f) => `${prefix}/${f.name}`);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr && __DEV__) {
      console.warn("[media] clearUserMedia remove failed:", rmErr.message);
    }
  }
  urlCache.clear();
}
