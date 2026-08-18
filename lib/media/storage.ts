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

// `list()` is capped per request, so every listing pages with an offset.
const LIST_PAGE_SIZE = 500;
// Hard stop so a misbehaving server can never spin the offset loop forever.
const MAX_LIST_PAGES = 200;
// `remove()` takes a bounded path list; long sweeps go out in chunks.
const REMOVE_BATCH_SIZE = 100;

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

/** Put one local file at an exact object path. Throws on refusal. */
async function putObject(localUri: string, objectPath: string): Promise<void> {
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

  await putObject(localUri, objectPath);

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
    // Never log the path — it carries the user + entry ids.
    if (__DEV__) console.warn("[media] signed URL failed:", error?.message);
    return null;
  }

  urlCache.set(objectPath, {
    url: data.signedUrl,
    expiresAt: now + 50 * 60 * 1000, // 50 min, leave buffer
  });

  return data.signedUrl;
}

/** Remove a single object. Returns false if the server refused. */
export async function deleteImage(objectPath: string): Promise<boolean> {
  const { failed } = await deleteImages([objectPath]);
  return failed.length === 0;
}

/** Outcome of a batched storage delete. */
export interface MediaDeleteResult {
  /** Object paths the server accepted a delete for. */
  deleted: string[];
  /** Object paths the server refused — these are still in the bucket. */
  failed: string[];
}

/**
 * Remove several objects in as few round trips as possible. Chunked because
 * `remove()` takes a bounded path list; a chunk that errors marks only its own
 * paths failed, so one bad batch never hides the rest.
 */
export async function deleteImages(
  objectPaths: string[],
): Promise<MediaDeleteResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < objectPaths.length; i += REMOVE_BATCH_SIZE) {
    const batch = objectPaths.slice(i, i + REMOVE_BATCH_SIZE);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      // Never log the paths themselves — they carry the user + entry ids.
      if (__DEV__) {
        console.warn(
          `[media] delete failed for ${batch.length} object(s):`,
          error.message,
        );
      }
      failed.push(...batch);
      continue;
    }
    deleted.push(...batch);
  }

  for (const path of deleted) urlCache.delete(path);
  return { deleted, failed };
}

/**
 * Best-effort cleanup of objects whose entry never landed. Swallows everything:
 * callers use this on a failure path and must surface the ORIGINAL error, not a
 * cleanup error.
 */
export async function discardEntryImages(objectPaths: string[]): Promise<void> {
  if (objectPaths.length === 0) return;
  try {
    const { failed } = await deleteImages(objectPaths);
    if (__DEV__ && failed.length > 0) {
      console.warn(`[media] rollback left ${failed.length} object(s) behind`);
    }
  } catch (err) {
    if (__DEV__) console.warn("[media] rollback threw:", err);
  }
}

/** Result of uploading a whole entry's worth of photos. */
export type UploadEntryImagesResult =
  | { status: "ok"; paths: string[] }
  | { status: "failed"; reason: string };

/**
 * Upload every photo for one entry, atomically (bug D8).
 *
 * The old caller looped over `uploadImage` inline and bailed on the first
 * throw, leaving every already-stored object orphaned in the bucket with no
 * entry referencing it — invisible to the user and impossible to clean up.
 * Here the successful paths are tracked as we go and rolled back on any
 * failure, so the batch is all-or-nothing: either the caller gets every path,
 * or the bucket is left exactly as it was.
 *
 * Never throws — returns a user-safe `reason` instead, so the composer can keep
 * the user's text and photos and offer a retry.
 */
export async function uploadEntryImages(
  localUris: string[],
  entryId: string,
  userId: string,
): Promise<UploadEntryImagesResult> {
  if (localUris.length === 0) return { status: "ok", paths: [] };

  const uploaded: string[] = [];
  try {
    for (const uri of localUris) {
      uploaded.push(await uploadImage(uri, entryId, userId));
    }
    return { status: "ok", paths: uploaded };
  } catch (err) {
    if (__DEV__) console.warn("[media] entry upload failed, rolling back:", err);
    await discardEntryImages(uploaded);
    return {
      status: "failed",
      reason:
        localUris.length === 1
          ? "Your photo couldn't be uploaded. Check your connection and try again."
          : "Your photos couldn't be uploaded. Check your connection and try again.",
    };
  }
}

// ----------------------------------------------------------------------------
// Avatars
// ----------------------------------------------------------------------------
// A profile photo is one object at "<userId>/avatar/<media_id>.<ext>" — under
// the same user prefix as entry photos, so the storage RLS policies
// (`name like auth.uid()::text || '/%'`) already cover it, `getImageUrl` signs
// it with the same cache, and `clearUserMedia` sweeps it on account deletion
// (its root listing sees the "avatar" folder like any entry folder and pages
// through it). Nothing avatar-specific is needed in any of those paths.
//
// The path is recorded in `accounts.avatar_path` by lib/db/accounts.ts — this
// module never touches the database, so replacing an avatar is a two-step
// dance the caller (the data store) sequences: upload → record → delete the
// object it replaced.
const AVATAR_FOLDER = "avatar";

/** Result of uploading a new avatar. Mirrors `UploadEntryImagesResult`. */
export type UploadAvatarResult =
  | { status: "ok"; path: string }
  | { status: "failed"; reason: string };

/**
 * Upload a new avatar object. Never throws — returns a user-safe `reason`, so
 * the edit screen can keep the picked photo on screen and offer a retry.
 *
 * A fresh media id every time (rather than a fixed "avatar.jpg") keeps the
 * write non-destructive: the old object is still there if recording the new
 * path fails, and signed URLs of the old one don't suddenly serve new bytes.
 */
export async function uploadAvatar(
  localUri: string,
  userId: string,
): Promise<UploadAvatarResult> {
  const objectPath = `${userId}/${AVATAR_FOLDER}/${generateMediaId()}.${guessExt(localUri)}`;
  try {
    await putObject(localUri, objectPath);
    return { status: "ok", path: objectPath };
  } catch (err) {
    // Never log the path — it carries the user id.
    if (__DEV__) console.warn("[media] avatar upload failed:", err);
    return {
      status: "failed",
      reason:
        "Your photo couldn't be uploaded. Check your connection and try again.",
    };
  }
}

/**
 * Best-effort removal of one avatar object — the previous photo once the new
 * one is recorded, or the new one when recording it failed (rollback). Same
 * swallow-everything contract as `discardEntryImages`, which it delegates to:
 * the caller must surface the ORIGINAL outcome, not a cleanup error.
 */
export async function discardAvatar(
  objectPath: string | null | undefined,
): Promise<void> {
  if (!objectPath) return;
  await discardEntryImages([objectPath]);
}

export function clearMediaCache(): void {
  urlCache.clear();
}

/**
 * List every name under a prefix, paging until the prefix is exhausted.
 *
 * Reports `complete: false` when a page errored or the page cap tripped, which
 * is how callers know they must NOT claim a clean sweep.
 */
async function listAllNames(
  prefix: string,
): Promise<{ names: string[]; complete: boolean }> {
  const names: string[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });

    if (error) {
      if (__DEV__) console.warn("[media] list failed:", error.message);
      return { names, complete: false };
    }

    const objects = data ?? [];
    for (const object of objects) names.push(object.name);
    // A short page means we've reached the end of the prefix.
    if (objects.length < LIST_PAGE_SIZE) return { names, complete: true };
    offset += objects.length;
  }

  // Page cap tripped — there is more under this prefix than we enumerated.
  if (__DEV__) console.warn("[media] list hit the page cap; result truncated");
  return { names, complete: false };
}

/** How completely a user's media was removed. */
export type MediaCleanupStatus = "complete" | "partial" | "failed";

export interface MediaCleanupResult {
  /**
   * `complete` — every object under the user's prefix was enumerated AND
   * removed. Only this value is safe to treat as "their photos are gone."
   * `partial` — some objects went, but a list or a delete failed.
   * `failed` — nothing could be removed.
   */
  status: MediaCleanupStatus;
  /** Objects the server accepted a delete for. */
  removed: number;
  /** Objects we know are still in the bucket. */
  remaining: number;
}

/**
 * Delete every object under a user's prefix in the private media bucket.
 * Called before delete_my_account() because Supabase blocks direct DELETE from
 * storage.objects via SECURITY DEFINER RPCs.
 *
 * Bug D9: this used to make two flat, unpaginated `list()` calls, so a user
 * with more entry folders (or more files in one folder) than a single page kept
 * photos in the bucket after asking for account deletion — a privacy failure,
 * not just clutter. Both levels now page through with an offset loop, and the
 * result says plainly whether the sweep was complete so the caller can abort
 * account deletion rather than orphan a user's photos.
 */
export async function clearUserMedia(
  userId: string,
): Promise<MediaCleanupResult> {
  const root = await listAllNames(userId);

  // Couldn't even enumerate the top level — assume nothing was cleaned.
  if (!root.complete && root.names.length === 0) {
    return { status: "failed", removed: 0, remaining: 0 };
  }

  let fullyEnumerated = root.complete;
  const paths: string[] = [];

  for (const name of root.names) {
    const prefix = `${userId}/${name}`;
    const child = await listAllNames(prefix);
    if (!child.complete) fullyEnumerated = false;

    if (child.names.length > 0) {
      // `name` is an entry folder.
      for (const file of child.names) paths.push(`${prefix}/${file}`);
    } else {
      // Nothing beneath it, so `name` is an object sitting directly under the
      // user prefix. Removing a path that doesn't exist is a no-op.
      paths.push(prefix);
    }
  }

  const { deleted, failed } = await deleteImages(paths);
  urlCache.clear();

  if (fullyEnumerated && failed.length === 0) {
    return { status: "complete", removed: deleted.length, remaining: 0 };
  }
  if (deleted.length === 0) {
    return { status: "failed", removed: 0, remaining: failed.length };
  }
  return {
    status: "partial",
    removed: deleted.length,
    remaining: failed.length,
  };
}
