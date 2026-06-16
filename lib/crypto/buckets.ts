// Bucket derivation — HMAC-based pseudonyms that let the server
// query by date without knowing the actual date.
//
//   day_bucket = HMAC(masterKey, "day:YYYY-MM-DD")          [16 bytes hex]
//   month_bucket = HMAC(masterKey, "month:YYYY-MM")          [16 bytes hex]
//   habit_log_bucket = HMAC(masterKey, "habitlog:<id>:<date>")

import { bytesToHex } from "./encoding";
import { hmacSha256 } from "./primitives";

function bucket(key: Uint8Array, prefix: string, value: string): string {
  // Truncate to 16 bytes / 32 hex chars — still unique, and unique constraints
  // in Postgres handle the 1-in-2^128 collision risk.
  return bytesToHex(hmacSha256(key, `${prefix}:${value}`)).slice(0, 32);
}

export function dayBucket(masterKey: Uint8Array, date: string): string {
  return bucket(masterKey, "day", date);
}

export function monthBucket(masterKey: Uint8Array, yearMonth: string): string {
  return bucket(masterKey, "month", yearMonth);
}

export function habitLogDayBucket(
  masterKey: Uint8Array,
  habitId: string,
  date: string,
): string {
  return bucket(masterKey, "habitlog", `${habitId}:${date}`);
}

export function habitLogMonthBucket(
  masterKey: Uint8Array,
  yearMonth: string,
): string {
  return bucket(masterKey, "habitlogmonth", yearMonth);
}
