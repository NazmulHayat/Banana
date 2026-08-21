// Place tagging for journal entries.
//
// Off by default and useless until switched on in Manage → Location.
//
// PRIVACY — read before changing anything here.
//
// 1. Coordinates leave the device. Turning a lat/long into "McDonald's" means
//    reverse geocoding, and `Location.reverseGeocodeAsync` hands the point to
//    the OS geocoder (Apple on iOS, Google on Android). This is the ONE place
//    in the app where anything derived from user data goes to a third party.
//    It never goes to Supabase, and the setting screen says so plainly.
// 2. Nothing coarser is stored than it has to be. Every coordinate is rounded
//    to `COORD_PRECISION` decimals (~110 m) BEFORE it is written anywhere, so
//    a stolen backup can place someone on a block, never at a front door.
// 3. What is stored is encrypted. The place on an entry rides inside the
//    entry's ciphertext; saved places are their own encrypted rows with their
//    own AAD. The server has no coordinate column to read.
// 4. The label is short on purpose. "Haneda Airport", not "3-3-2 Hanedakuko,
//    Ota City, Tokyo 144-0041" — a journal wants a place, not a mailing address.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import type { EntryPlace, SavedPlace } from "./db";
import {
  fullAddress,
  matchSavedPlace,
  MATCH_RADIUS_M,
  roundPoint,
  shortHeading,
} from "./geo";

// The pure matching rules live in lib/geo.ts so they can be tested in Node.
// Re-exported here so callers keep one import for "everything about places".
export {
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
} from "./geo";

// New protocol string, new suffix — existing `banana_*` keys are never renamed.
const STORAGE_KEY = "banana_location_v1";

/**
 * Hard ceiling on a detection. A journal entry must NEVER wait on GPS: a cold
 * fix indoors can take tens of seconds and a geocode needs the network, so
 * without this the primary action of the whole app would hang behind an
 * optional label. Time out and save the entry untagged instead.
 */
export const DETECT_TIMEOUT_MS = 6000;

/**
 * How stale a cached fix may be and still be used. Two minutes of walking is
 * well inside the 150 m match radius, and reusing it makes the common case —
 * writing several entries in one sitting — instant instead of re-acquiring.
 */
const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;

/** Resolve to `fallback` if `work` hasn't finished in `ms`. Never rejects. */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (e) => {
        clearTimeout(timer);
        if (__DEV__) console.warn("[location] detect failed:", e);
        resolve(fallback);
      },
    );
  });
}

/**
 * Decimal places kept on a stored coordinate. Three is roughly 110 m at the
 * equator — enough to recognise you're back somewhere, too coarse to point at
 * a building.
 */
export interface LocationPref {
  /** Off until the user says otherwise. Never opt someone in. */
  enabled: boolean;
}

export const DEFAULT_LOCATION_PREF: LocationPref = { enabled: false };

/** Why a detection produced nothing. The UI turns each into a calm line. */
export type LocationFailure =
  /** The setting is off — nothing was attempted. */
  | "off"
  /** The OS refused, or the user never granted it. */
  | "denied"
  /** Granted, but no fix (indoors, airplane mode, geocoder unreachable). */
  | "unavailable";

let cached: LocationPref | null = null;



/** Read the preference — memory first, then disk. Never throws. */
export async function loadLocationPref(): Promise<LocationPref> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const enabled =
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { enabled?: unknown }).enabled === true;
    cached = { enabled };
  } catch (e) {
    if (__DEV__) console.warn("[location] read failed:", e);
    cached = { ...DEFAULT_LOCATION_PREF };
  }
  return cached;
}

/** Persist the preference. Memory updates now; disk is fire-and-forget. */
export function saveLocationPref(pref: LocationPref): void {
  cached = { ...pref };
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
}

/** Forget the preference (account deletion / local purge). */
export async function clearLocationPref(): Promise<void> {
  cached = null;
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/**
 * Ask for permission, but only when the user has just switched the setting on.
 * Returns false for denied — the caller shows the explainer, never an alert.
 */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.granted;
  } catch (e) {
    if (__DEV__) console.warn("[location] permission check failed:", e);
    return false;
  }
}

export async function hasLocationPermission(): Promise<boolean> {
  try {
    return (await Location.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}


/**
 * Detect where we are and name it.
 *
 * `saved` is consulted first: if you've already told the app that this spot is
 * "Home", it stays "Home" rather than reverting to whatever the geocoder calls
 * your street. The address always comes from this detection, so a saved place
 * keeps its name without freezing its details.
 *
 * Returns a `LocationFailure` rather than throwing — a missing tag must never
 * be able to stop an entry from saving.
 */
export async function detectPlace(
  saved: SavedPlace[],
): Promise<EntryPlace | LocationFailure> {
  const pref = await loadLocationPref();
  if (!pref.enabled) return "off";
  if (!(await hasLocationPermission())) return "denied";
  // Bounded: the entry save is waiting on this.
  return withTimeout(locate(saved), DETECT_TIMEOUT_MS, "unavailable");
}

async function locate(
  saved: SavedPlace[],
): Promise<EntryPlace | LocationFailure> {
  {
    // A recent cached fix is free and accurate enough for a 150 m radius, so
    // try it before waking the GPS.
    const cachedFix = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_MAX_AGE_MS,
      requiredAccuracy: MATCH_RADIUS_M,
    });
    const position =
      cachedFix ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
    const point = roundPoint(position.coords);

    const results = await Location.reverseGeocodeAsync(point);
    const first = results[0];
    const match = matchSavedPlace(point, saved);

    if (!first) {
      // A fix with no name is still worth keeping if we already named it.
      if (match) {
        return {
          heading: match.heading,
          address: match.address,
          latitude: point.latitude,
          longitude: point.longitude,
        };
      }
      return "unavailable";
    }

    return {
      heading: match ? match.heading : shortHeading(first),
      address: fullAddress(first) || shortHeading(first),
      latitude: point.latitude,
      longitude: point.longitude,
    };
  }
}
