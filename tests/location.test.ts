// Place matching rules (location tagging).
//
// These decide whether two moments count as "the same place", which is what
// makes a saved name stick — or fail to. Worth being able to prove rather than
// eyeball on a phone.

import "./setup";

import type { EntryPlace, SavedPlace } from "../lib/db";
import {
  COORD_PRECISION,
  distanceMeters,
  fullAddress,
  MATCH_RADIUS_M,
  matchSavedPlace,
  resolvePlace,
  resolvePlaceHeading,
  roundCoord,
  roundPoint,
  shortHeading,
} from "../lib/geo";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

function place(
  heading: string,
  latitude: number,
  longitude: number,
): SavedPlace {
  return {
    id: heading,
    heading,
    address: `${heading} address`,
    latitude,
    longitude,
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

function entryPlace(
  heading: string,
  latitude: number,
  longitude: number,
): EntryPlace {
  return { heading, address: `${heading} address`, latitude, longitude };
}

// Haneda Airport, rounded to the storage grid.
const HANEDA = { latitude: 35.549, longitude: 139.779 };

// ============================================================================
suite("distanceMeters");
// ============================================================================
test("a point is zero metres from itself", () => {
  assertEq(distanceMeters(HANEDA, HANEDA), 0);
});

test("one degree of latitude is ~111 km", () => {
  const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
  assertTrue(Math.abs(d - 111_195) < 500, `expected ~111195 m, got ${d}`);
});

test("is symmetric", () => {
  const a = { latitude: 35.6812, longitude: 139.7671 };
  const b = { latitude: 35.6895, longitude: 139.6917 };
  assertTrue(
    Math.abs(distanceMeters(a, b) - distanceMeters(b, a)) < 1e-6,
    "distance must not depend on argument order",
  );
});

test("survives the antimeridian without exploding", () => {
  const d = distanceMeters(
    { latitude: 0, longitude: 179.999 },
    { latitude: 0, longitude: -179.999 },
  );
  assertTrue(Number.isFinite(d), "distance must be finite across ±180");
});

// ============================================================================
suite("coordinate rounding");
// ============================================================================
test(`keeps ${COORD_PRECISION} decimals`, () => {
  assertEq(roundCoord(35.68123456), 35.681);
  assertEq(roundCoord(-139.76987654), -139.77);
});

test("rounding never moves a point further than the match radius", () => {
  // The privacy grid must stay inside the matching tolerance, or a place could
  // fail to match itself after a round-trip through storage.
  const raw = { latitude: 35.6812345, longitude: 139.7671234 };
  const moved = distanceMeters(raw, roundPoint(raw));
  assertTrue(
    moved < MATCH_RADIUS_M,
    `rounding moved the point ${moved} m, radius is ${MATCH_RADIUS_M} m`,
  );
});

// ============================================================================
suite("matchSavedPlace");
// ============================================================================
test("no saved places means no match", () => {
  assertEq(matchSavedPlace(HANEDA, []), null);
});

test("matches a place you are standing in", () => {
  const saved = [place("Home", HANEDA.latitude, HANEDA.longitude)];
  assertEq(matchSavedPlace(HANEDA, saved)?.heading, "Home");
});

test("matches a place just inside the radius", () => {
  // ~0.0009 deg latitude is ~100 m.
  const near = { latitude: HANEDA.latitude + 0.0009, longitude: HANEDA.longitude };
  const d = distanceMeters(HANEDA, near);
  assertTrue(d < MATCH_RADIUS_M, `fixture must be inside the radius, was ${d} m`);
  assertEq(matchSavedPlace(near, [place("Home", HANEDA.latitude, HANEDA.longitude)])?.heading, "Home");
});

test("does not match a place beyond the radius", () => {
  // ~0.005 deg latitude is ~550 m — comfortably outside.
  const far = { latitude: HANEDA.latitude + 0.005, longitude: HANEDA.longitude };
  const d = distanceMeters(HANEDA, far);
  assertTrue(d > MATCH_RADIUS_M, `fixture must be outside the radius, was ${d} m`);
  assertEq(matchSavedPlace(far, [place("Home", HANEDA.latitude, HANEDA.longitude)]), null);
});

test("the nearest place wins when two overlap", () => {
  const here = HANEDA;
  const saved = [
    place("Across the street", here.latitude + 0.001, here.longitude),
    place("Right here", here.latitude + 0.0001, here.longitude),
  ];
  assertEq(matchSavedPlace(here, saved)?.heading, "Right here");
});

test("order of the saved list does not change the winner", () => {
  const here = HANEDA;
  const a = place("Across the street", here.latitude + 0.001, here.longitude);
  const b = place("Right here", here.latitude + 0.0001, here.longitude);
  assertEq(matchSavedPlace(here, [a, b])?.heading, "Right here");
  assertEq(matchSavedPlace(here, [b, a])?.heading, "Right here");
});

// ============================================================================
suite("resolvePlaceHeading");
// ============================================================================
test("a saved name overrides the name the entry was written with", () => {
  const entry = entryPlace("Hanedakuko 2-Chome", HANEDA.latitude, HANEDA.longitude);
  const saved = [place("The airport", HANEDA.latitude, HANEDA.longitude)];
  assertEq(resolvePlaceHeading(entry, saved), "The airport");
});

test("renaming a saved place relabels the entry with no write to the entry", () => {
  const entry = entryPlace("Haneda Airport", HANEDA.latitude, HANEDA.longitude);
  const before = [place("Haneda Airport", HANEDA.latitude, HANEDA.longitude)];
  const after = [place("Work trip", HANEDA.latitude, HANEDA.longitude)];
  assertEq(resolvePlaceHeading(entry, before), "Haneda Airport");
  assertEq(resolvePlaceHeading(entry, after), "Work trip");
  // The entry itself is untouched — this is the whole point of resolving late.
  assertEq(entry.heading, "Haneda Airport");
});

test("forgetting a place falls back to what the entry was written with", () => {
  const entry = entryPlace("Haneda Airport", HANEDA.latitude, HANEDA.longitude);
  assertEq(resolvePlaceHeading(entry, []), "Haneda Airport");
});

test("a place elsewhere does not leak its name onto this entry", () => {
  const entry = entryPlace("Haneda Airport", HANEDA.latitude, HANEDA.longitude);
  const saved = [place("Home", 35.6812, 139.7671)];
  assertEq(resolvePlaceHeading(entry, saved), "Haneda Airport");
});

// ============================================================================
suite("resolvePlace (what the editor opens on)");
// ============================================================================
test("opens on the saved name, not the entry's snapshot", () => {
  // The bug this guards: the card showed "Haneda Airport T3" (resolved) while
  // the sheet pre-filled "Haneda Airport" (the snapshot), so editing appeared
  // to revert a rename that had actually worked.
  const entry = entryPlace("Haneda Airport", HANEDA.latitude, HANEDA.longitude);
  const saved = [place("Haneda Airport T3", HANEDA.latitude, HANEDA.longitude)];
  const resolved = resolvePlace(entry, saved);
  assertEq(resolved.heading, "Haneda Airport T3");
  assertEq(
    resolved.heading,
    resolvePlaceHeading(entry, saved),
    "the sheet and the card must never disagree",
  );
});

test("takes the saved address too, so both fields agree", () => {
  const entry = entryPlace("Old name", HANEDA.latitude, HANEDA.longitude);
  const saved = [place("New name", HANEDA.latitude, HANEDA.longitude)];
  assertEq(resolvePlace(entry, saved).address, "New name address");
});

test("keeps the entry's own coordinates — that is where you were", () => {
  const entry = entryPlace("Old name", HANEDA.latitude, HANEDA.longitude);
  const saved = [place("New name", HANEDA.latitude + 0.0005, HANEDA.longitude)];
  const resolved = resolvePlace(entry, saved);
  assertEq(resolved.latitude, HANEDA.latitude);
  assertEq(resolved.longitude, HANEDA.longitude);
});

test("with nothing saved it returns the entry's own place untouched", () => {
  const entry = entryPlace("Haneda Airport", HANEDA.latitude, HANEDA.longitude);
  assertEq(resolvePlace(entry, []), entry);
});

// ============================================================================
suite("labelling a geocode result");
// ============================================================================
test("a named point of interest beats the street it sits on", () => {
  assertEq(
    shortHeading({ name: "McDonald's", street: "Hanedakuko 2-Chome", city: "Ota" }),
    "McDonald's",
  );
});

test("falls back through street, district, then city", () => {
  assertEq(shortHeading({ street: "Omotesando", city: "Shibuya" }), "Omotesando");
  assertEq(shortHeading({ district: "Ebisu", city: "Shibuya" }), "Ebisu");
  assertEq(shortHeading({ city: "Shibuya" }), "Shibuya");
});

test("blank strings are not treated as names", () => {
  assertEq(shortHeading({ name: "   ", street: "Omotesando" }), "Omotesando");
});

test("never returns an empty label", () => {
  assertEq(shortHeading({}), "Unknown place");
});

test("the full address drops the geocoder's repeated components", () => {
  // Real Tokyo results repeat the ward as name, district and city.
  assertEq(
    fullAddress({ name: "Shibuya", district: "Shibuya", city: "Shibuya", region: "Tokyo" }),
    "Shibuya, Tokyo",
  );
});

test("the full address keeps order and skips missing parts", () => {
  assertEq(
    fullAddress({ name: "Haneda Airport", city: "Ota", region: "Tokyo", country: "Japan" }),
    "Haneda Airport, Ota, Tokyo, Japan",
  );
});

void run();
