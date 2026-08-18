// Tests for the read-path cache tiers in lib/db (D2 + D3):
//   in-memory Map (sync) -> AsyncStorage (offline) -> Supabase (network)
// Only the first two tiers are covered here — the network tier needs a live
// server (tests/e2e.test.ts). What matters for the store's short-circuit logic
// is the null/[] contract: `null` = "never resolved, go to the next tier",
// `[]` = "resolved and genuinely empty, stop here".
//
// Module handling: lib/db/* statically imports ../supabase (which pulls in
// react-native) and ../crypto. Neither loads headless, and neither is touched by
// the cache helpers under test, so we intercept those two requests with tiny
// stubs before requiring the modules. AsyncStorage is patched in-memory the same
// way tests/pending-writes.test.ts does it.

import "./setup";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

import AsyncStorageReal from "@react-native-async-storage/async-storage";

// ---- in-memory AsyncStorage mock -------------------------------------------
const store = new Map<string, string>();

Object.assign(AsyncStorageReal, {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? (store.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
  async getAllKeys(): Promise<string[]> {
    return [...store.keys()];
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) store.delete(key);
  },
});

// ---- stub the modules the cache helpers never call -------------------------
type Loader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;
const ModuleCtor = require("module") as { _load: Loader };
const realLoad = ModuleCtor._load;
const stubs: Record<string, unknown> = {
  "../supabase": { supabase: {}, isSupabaseConfigured: () => false },
  "../crypto": {
    AAD: {},
    keyring: { isUnlocked: () => false },
    decryptJson: () => ({}),
    encryptJson: () => ({}),
    dayBucket: () => "",
    monthBucket: () => "",
    habitLogDayBucket: () => "",
    habitLogMonthBucket: () => "",
  },
};
ModuleCtor._load = function patchedLoad(request, parent, isMain) {
  if (request in stubs) return stubs[request];
  return realLoad.call(this, request, parent, isMain);
};

const habitsDb = require("../lib/db/habits") as typeof import("../lib/db/habits");
const entriesDb =
  require("../lib/db/entries") as typeof import("../lib/db/entries");
const logsDb =
  require("../lib/db/habit-logs") as typeof import("../lib/db/habit-logs");

ModuleCtor._load = realLoad;

const U = "user-1";
const YEAR = 2026;
const MONTH = 6;

// The cache writers fire-and-forget their AsyncStorage.setItem — let the
// microtask land before reading storage back.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function resetAll(): void {
  store.clear();
  habitsDb.clearHabitsCache();
  entriesDb.clearEntriesCache();
  logsDb.clearHabitLogsCache();
}

const habitA = { id: "h1", name: "Read", createdAt: "2026-06-01T00:00:00.000Z" };
const entryA = {
  id: "e1",
  date: "2026-06-16",
  text: "hello",
  mediaPaths: [],
  createdAt: "2026-06-16T09:00:00.000Z",
};
const logA = { habitId: "h1", date: "2026-06-16", completed: true };

// ---------------------------------------------------------------------------
suite("habits cache tiers");

test("cold: memory and storage both miss (null, not [])", async () => {
  resetAll();
  assertEq(habitsDb.getCachedHabits(U), null, "memory miss");
  assertEq(await habitsDb.loadHabitsFromStorage(U), null, "storage miss");
});

test("write-through: storage hit repopulates the in-memory tier", async () => {
  resetAll();
  habitsDb.setCachedHabits(U, [habitA]);
  await settle();
  habitsDb.clearHabitsCache(); // simulate a cold app start
  assertEq(habitsDb.getCachedHabits(U), null, "memory cleared");

  const stored = await habitsDb.loadHabitsFromStorage(U);
  assertEq(stored, [habitA], "storage tier answers");
  assertEq(habitsDb.getCachedHabits(U), [habitA], "promoted back to memory");
});

test("loaded-empty is [] from both tiers, never null (D3)", async () => {
  resetAll();
  habitsDb.setCachedHabits(U, []);
  await settle();
  assertEq(habitsDb.getCachedHabits(U), [], "memory: resolved-empty");

  habitsDb.clearHabitsCache();
  assertEq(await habitsDb.loadHabitsFromStorage(U), [], "storage: resolved-empty");
});

test("caches are per-user", async () => {
  resetAll();
  habitsDb.setCachedHabits(U, [habitA]);
  await settle();
  assertEq(habitsDb.getCachedHabits("user-2"), null, "other user misses memory");
  assertEq(
    await habitsDb.loadHabitsFromStorage("user-2"),
    null,
    "other user misses storage",
  );
});

test("corrupt storage degrades to null, never throws", async () => {
  resetAll();
  store.set("banana_habits_v2:" + U, "{not json");
  assertEq(await habitsDb.loadHabitsFromStorage(U), null);
});

// ---------------------------------------------------------------------------
suite("entries cache tiers");

test("write-through: storage hit repopulates the in-memory tier", async () => {
  resetAll();
  entriesDb.setCachedEntriesForMonth(YEAR, MONTH, U, [entryA]);
  await settle();
  entriesDb.clearEntriesCache();
  assertEq(
    entriesDb.getCachedEntriesForMonth(YEAR, MONTH, U),
    null,
    "memory cleared",
  );

  const stored = await entriesDb.loadEntriesForMonthFromStorage(YEAR, MONTH, U);
  assertEq(stored, [entryA], "storage tier answers");
  assertEq(
    entriesDb.getCachedEntriesForMonth(YEAR, MONTH, U),
    [entryA],
    "promoted back to memory",
  );
});

test("an empty month is [] from both tiers, never null (D3)", async () => {
  resetAll();
  entriesDb.setCachedEntriesForMonth(YEAR, MONTH, U, []);
  await settle();
  assertEq(entriesDb.getCachedEntriesForMonth(YEAR, MONTH, U), []);

  entriesDb.clearEntriesCache();
  assertEq(await entriesDb.loadEntriesForMonthFromStorage(YEAR, MONTH, U), []);
});

test("months are isolated: another month still misses", async () => {
  resetAll();
  entriesDb.setCachedEntriesForMonth(YEAR, MONTH, U, [entryA]);
  await settle();
  entriesDb.clearEntriesCache();
  assertEq(
    await entriesDb.loadEntriesForMonthFromStorage(YEAR, MONTH + 1, U),
    null,
  );
});

test("storage key stays on the banana_*_v2 protocol prefix", async () => {
  resetAll();
  entriesDb.setCachedEntriesForMonth(YEAR, MONTH, U, [entryA]);
  await settle();
  assertTrue(
    store.has(`banana_entries_v2:${U}:2026-06`),
    "entries storage key unchanged",
  );
});

// ---------------------------------------------------------------------------
suite("habit-log cache tiers");

test("write-through: storage hit repopulates the in-memory tier", async () => {
  resetAll();
  logsDb.setCachedHabitLogsForMonth(YEAR, MONTH, U, [logA]);
  await settle();
  logsDb.clearHabitLogsCache();
  assertEq(
    logsDb.getCachedHabitLogsForMonth(YEAR, MONTH, U),
    null,
    "memory cleared",
  );

  const stored = await logsDb.loadHabitLogsFromStorage(YEAR, MONTH, U);
  assertEq(stored, [logA], "storage tier answers");
  assertEq(
    logsDb.getCachedHabitLogsForMonth(YEAR, MONTH, U),
    [logA],
    "promoted back to memory",
  );
});

test("an empty month is [] from both tiers, never null (D3)", async () => {
  resetAll();
  logsDb.setCachedHabitLogsForMonth(YEAR, MONTH, U, []);
  await settle();
  assertEq(logsDb.getCachedHabitLogsForMonth(YEAR, MONTH, U), []);

  logsDb.clearHabitLogsCache();
  assertEq(await logsDb.loadHabitLogsFromStorage(YEAR, MONTH, U), []);
});

test("corrupt storage degrades to null, never throws", async () => {
  resetAll();
  store.set(`banana_habit_logs_v2:${U}:2026-06`, "[[[");
  assertEq(await logsDb.loadHabitLogsFromStorage(YEAR, MONTH, U), null);
});

// ---------------------------------------------------------------------------
// The optimistic-write helpers the data store calls. They used to run
// INSIDE a setState updater, which StrictMode double-fires — and when the month
// wasn't loaded they replaced the whole cached month with a one-item array,
// hiding everything else in it. They are pure cache mutators now, and a month
// that isn't cached is left alone.
suite("optimistic cache writes never invent a month");

const logB = { habitId: "h2", date: "2026-06-17", completed: true };
const entryB = {
  id: "e2",
  date: "2026-06-17",
  text: "second",
  mediaPaths: [],
  createdAt: "2026-06-17T09:00:00.000Z",
};

test("a log for an uncached month is a no-op, not a one-item month", async () => {
  resetAll();
  logsDb.upsertHabitLogInCache(U, logB);
  await settle();
  assertEq(
    logsDb.getCachedHabitLogsForMonth(2026, 6, U),
    null,
    "still 'never resolved' — an optimistic tick can't fake a whole month",
  );
  assertTrue(!store.has(`banana_habit_logs_v2:${U}:2026-06`), "nothing on disk");
});

test("a log for a cached month updates both tiers in place", async () => {
  resetAll();
  logsDb.setCachedHabitLogsForMonth(YEAR, MONTH, U, [logA]);
  await settle();

  logsDb.upsertHabitLogInCache(U, { ...logA, completed: false });
  await settle();
  assertEq(
    logsDb.getCachedHabitLogsForMonth(YEAR, MONTH, U),
    [{ ...logA, completed: false }],
    "the existing log flipped, no duplicate row",
  );
  assertEq(
    JSON.parse(store.get(`banana_habit_logs_v2:${U}:2026-06`) as string),
    [{ ...logA, completed: false }],
    "written through to disk",
  );
});

test("an entry for an uncached month is a no-op", async () => {
  resetAll();
  entriesDb.upsertEntryInCache(entryB, U);
  await settle();
  assertEq(entriesDb.getCachedEntriesForMonth(2026, 6, U), null, "no month invented");
});

test("removing an entry keeps the rest of the cached month", async () => {
  resetAll();
  entriesDb.setCachedEntriesForMonth(YEAR, MONTH, U, [entryA, entryB]);
  await settle();

  entriesDb.removeEntryFromCache(entryA.id, entryA.date, U);
  await settle();
  assertEq(
    entriesDb.getCachedEntriesForMonth(YEAR, MONTH, U),
    [entryB],
    "an offline delete leaves a smaller month, not a hole",
  );
  assertEq(
    JSON.parse(store.get(`banana_entries_v2:${U}:2026-06`) as string),
    [entryB],
    "and the same on disk",
  );
});

(async () => {
  await run();
})();
