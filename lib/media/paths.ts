// Object-path conventions for stored photos. No native modules, no I/O — the
// rest of lib/media pulls in expo-file-system and Supabase, which don't exist
// off-device, and these rules are worth being able to test.

/**
 * A thumbnail lives beside its full image under a fixed suffix rather than
 * being recorded in the payload. Derivable means cleanup can find it without
 * decrypting anything, and entries written before thumbnails existed need no
 * migration — their thumbnail simply isn't there and the grid falls back.
 */
export const THUMB_SUFFIX = "_t";

/**
 * The thumbnail path for a full-size object path.
 *
 * The suffix goes BEFORE the extension: "…_t.jpg", never "….jpg_t". Storage
 * serves content types by extension, and the RLS policies match on the
 * `auth.uid()/` prefix, so both have to survive intact.
 */
export function thumbPathFor(objectPath: string): string {
  const slash = objectPath.lastIndexOf("/");
  const dot = objectPath.lastIndexOf(".");
  // A dot in a folder name is not an extension.
  if (dot <= slash) return `${objectPath}${THUMB_SUFFIX}`;
  return `${objectPath.slice(0, dot)}${THUMB_SUFFIX}${objectPath.slice(dot)}`;
}

/**
 * Every object that makes up one photo, full size first. Used by each delete
 * path so none of them can leave a thumbnail orphaned in the bucket.
 */
export function objectPathsFor(objectPath: string): string[] {
  return [objectPath, thumbPathFor(objectPath)];
}
