// Pure place maths — no native modules, no I/O, no platform.
//
// Split out of lib/location.ts so it can be tested in Node: that module imports
// expo-location and AsyncStorage, which don't exist off-device. Everything here
// is a function of its arguments, which is also what makes the matching rules
// auditable — "is this the same place?" is a decision worth being able to prove.

import type { EntryPlace, SavedPlace } from "./db";

/**
 * Decimal places kept on a stored coordinate. Three is roughly 110 m at the
 * equator — enough to recognise you're back somewhere, too coarse to point at
 * a building. Applied BEFORE anything is written, so no precise position is
 * ever persisted, even encrypted.
 */
export const COORD_PRECISION = 3;

/**
 * How close counts as "the same place". Wider than the rounding grid above so
 * a rounded point still matches its neighbouring cell, and wide enough to
 * cover a building without swallowing the shop next door.
 */
export const MATCH_RADIUS_M = 150;

const EARTH_RADIUS_M = 6_371_000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Round to the stored grid. The only place coordinates lose precision. */
export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

export function roundPoint(point: Coordinates): Coordinates {
  return {
    latitude: roundCoord(point.latitude),
    longitude: roundCoord(point.longitude),
  };
}

/** Great-circle distance in metres. Used only to match against saved places. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The saved place within `MATCH_RADIUS_M`, nearest first, or null.
 * Nearest rather than first-found: two saved places can overlap, and the one
 * you're standing in should win over the one across the street.
 */
export function matchSavedPlace(
  point: Coordinates,
  places: SavedPlace[],
): SavedPlace | null {
  let best: SavedPlace | null = null;
  let bestDistance = MATCH_RADIUS_M;
  for (const place of places) {
    const d = distanceMeters(point, place);
    if (d <= bestDistance) {
      best = place;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * What an entry's place should be *called right now*.
 *
 * The entry carries the name it was given, but if the spot has since been
 * named — or renamed — in Manage → Location, that name wins. Resolving at read
 * time rather than rewriting history means renaming one place updates every
 * entry there instantly, with no writes and nothing to go wrong halfway. Forget
 * the saved name and entries fall back to whatever they were written with.
 */
export function resolvePlaceHeading(
  place: EntryPlace,
  saved: SavedPlace[],
): string {
  return matchSavedPlace(place, saved)?.heading ?? place.heading;
}

/**
 * The whole place as it stands today — the saved name AND address when this
 * spot has been named, the entry's own snapshot otherwise. Coordinates always
 * come from the entry: they are where you actually were.
 *
 * The editor opens on this rather than the raw snapshot. Showing the card one
 * name and the sheet another is the kind of mismatch that makes a user stop
 * trusting that anything saved at all.
 */
export function resolvePlace(
  place: EntryPlace,
  saved: SavedPlace[],
): EntryPlace {
  const match = matchSavedPlace(place, saved);
  if (!match) return place;
  return {
    heading: match.heading,
    address: match.address,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

/** The subset of a reverse-geocode result this app reads. */
export interface GeocodedParts {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

/**
 * The short label. A journal entry wants the name of somewhere, so a named
 * point of interest wins outright; only when there isn't one do we fall back
 * through street, then neighbourhood, then city.
 */
export function shortHeading(a: GeocodedParts): string {
  return (
    a.name?.trim() ||
    a.street?.trim() ||
    a.district?.trim() ||
    a.subregion?.trim() ||
    a.city?.trim() ||
    a.region?.trim() ||
    "Unknown place"
  );
}

/**
 * The fuller line shown when you tap to edit — enough to tell two branches of
 * the same chain apart, still not a postal address with a house number.
 */
export function fullAddress(a: GeocodedParts): string {
  const parts = [
    a.name,
    a.street,
    a.district,
    a.city,
    a.region,
    a.country,
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  // The geocoder repeats itself constantly — "Shibuya, Shibuya, Tokyo".
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.join(", ");
}
