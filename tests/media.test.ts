// Storage path conventions for photo derivatives.
//
// A thumbnail is found by convention rather than stored in the payload, so
// cleanup can reach it without decrypting anything and old entries need no
// migration. That convention is load-bearing: get it wrong and every delete
// silently orphans a thumbnail in the bucket forever.

import "./setup";

import { objectPathsFor, thumbPathFor } from "../lib/media/paths";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

const FULL = "27b443c6/entry-1/9f8e7d6c.jpg";

// ============================================================================
suite("thumbnail paths");
// ============================================================================
test("the suffix goes before the extension, not after", () => {
  // "...jpg_t" would be served without an image content type.
  assertEq(thumbPathFor(FULL), "27b443c6/entry-1/9f8e7d6c_t.jpg");
});

test("keeps the user and entry prefix intact", () => {
  // Storage RLS matches on `name like auth.uid() || '/%'` — a thumbnail that
  // lost its prefix would be unreadable by the person who owns it.
  assertTrue(
    thumbPathFor(FULL).startsWith("27b443c6/entry-1/"),
    "thumbnail must stay under the same owner prefix",
  );
});

test("handles a path with no extension", () => {
  assertEq(thumbPathFor("owner/entry/abc"), "owner/entry/abc_t");
});

test("does not confuse a dot in a folder name for an extension", () => {
  const path = "owner/entry.v2/abc.jpg";
  assertEq(thumbPathFor(path), "owner/entry.v2/abc_t.jpg");
});

test("is stable — the same input always yields the same thumbnail", () => {
  assertEq(thumbPathFor(FULL), thumbPathFor(FULL));
});

// ============================================================================
suite("delete expansion");
// ============================================================================
test("deleting a photo covers both objects", () => {
  const paths = objectPathsFor(FULL);
  assertEq(paths.length, 2);
  assertEq(paths[0], FULL);
  assertEq(paths[1], thumbPathFor(FULL));
});

test("the full image is listed first so a partial failure keeps the cheap one", () => {
  assertEq(objectPathsFor(FULL)[0], FULL);
});

void run();
