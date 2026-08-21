// Batched AsyncStorage writes for the cache tier.
//
// Cache writes are fire-and-forget by design: the in-memory Map is the
// synchronous truth and Supabase (plus the pending-writes queue) is the durable
// one, so the on-disk copy only has to catch up before the next cold start.
// That slack is what lets a burst collapse into a single bridge crossing —
// a multi-month read used to fan out one `setItem` per month, and a rapid
// habit toggle rewrote the same month over and over.
//
// The coalescing window is the current tick: long enough to absorb a fan-out,
// short enough that nothing meaningful is ever left in flight.

import AsyncStorage from "@react-native-async-storage/async-storage";

const pending = new Map<string, string>(); // storage key -> serialized value
let scheduled = false;
// Batches are chained rather than raced so a slow earlier write can never land
// on top of a newer value for the same key.
let inFlight: Promise<void> = Promise.resolve();

function flush(): void {
  scheduled = false;
  if (pending.size === 0) return;
  const batch: [string, string][] = [...pending.entries()];
  pending.clear();
  inFlight = inFlight.then(
    () => AsyncStorage.multiSet(batch).then(() => {}),
    () => {},
  );
  // A lost cache write costs a re-fetch, never data — swallow and move on.
  inFlight = inFlight.catch((e) => {
    if (__DEV__) console.warn("[cache] Batched write failed:", e);
  });
}

/**
 * Queue one cache key for persistence. Repeated writes to the same key inside
 * the tick collapse to the last value. Serializing eagerly means the caller can
 * keep mutating its array afterwards without corrupting what reaches disk.
 */
export function queueCacheWrite(key: string, value: unknown): void {
  pending.set(key, JSON.stringify(value));
  if (scheduled) return;
  scheduled = true;
  setTimeout(flush, 0);
}

/**
 * Push the queue out now and resolve once it has landed. Used before a read
 * that has to see its own writes (the habit-delete disk sweep).
 */
export async function flushCacheWrites(): Promise<void> {
  flush();
  await inFlight;
}
