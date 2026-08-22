// Tests for the lib/db write + read contract (D5/D6/D11/D12)
// and for the pending-writes replay wiring in lib/data-store.
//
// What's covered, all headless:
//   - writes THROW on a server error instead of queueing their own retry (D5) —
//     the data store is the only place that enqueues, so a failed replay stays
//     queued instead of being rewritten;
//   - deleteEntry surfaces its errors at all (D6 — it used to ignore them);
//   - habits carry an explicit `position` and getHabits restores it, falling
//     back to created_at order for rows saved before positions existed (D11);
//   - deleting a habit purges that habit's logs, and only that habit's (D12),
//     by FORWARD-COMPUTING day buckets instead of downloading and decrypting
//     the user's whole log history, and sweeps the on-disk months too so
//     a cold start can't resurrect them;
//   - a failed READ reports failure and leaves every cache tier untouched
//     — it used to degrade to `[]`, which the store then wrote over the
//     user's month;
//   - a window of months is ONE query, regrouped by decrypted date;
//   - a replayed queued write is applied back to store state and the
//     queue survives sign-out.
//
// Module handling: lib/db/* statically imports ../supabase (pulls in
// react-native) and ../crypto (native random). Neither loads headless, so both
// are replaced with scripted stubs before the modules are required — same
// technique as tests/db-cache.test.ts. Encryption is stubbed as plain JSON so a
// test can read what would have been written; no real crypto is exercised here
// (that's tests/crypto.test.ts).

import "./setup";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

import AsyncStorageReal from "@react-native-async-storage/async-storage";

// ---- in-memory AsyncStorage mock -------------------------------------------
const storage = new Map<string, string>();
Object.assign(AsyncStorageReal, {
  async getItem(key: string): Promise<string | null> {
    return storage.has(key) ? (storage.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    storage.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    storage.delete(key);
  },
  async getAllKeys(): Promise<string[]> {
    return [...storage.keys()];
  },
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) storage.delete(key);
  },
});

// ---- scripted Supabase stub ------------------------------------------------
const USER = "user-1";

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

/** Scripted reply per `<table>.<verb>`; anything unscripted resolves empty. */
const replies = new Map<string, QueryResult>();
/** Every terminal call made, for assertions. */
const calls: { table: string; verb: string; payload: unknown }[] = [];
/** Values passed to `.in(col, …)`, per call, for the purge/window tests. */
const inFilters: { col: string; values: string[] }[] = [];

interface Builder extends PromiseLike<QueryResult> {
  select: (cols?: string) => Builder;
  insert: (rows: unknown) => Builder;
  upsert: (row: unknown, opts?: unknown) => Builder;
  update: (row: unknown) => Builder;
  delete: () => Builder;
  eq: (col: string, value: unknown) => Builder;
  in: (col: string, values: string[]) => Builder;
  order: (col: string, opts?: unknown) => Builder;
  range: (from: number, to: number) => Builder;
  maybeSingle: () => Builder;
}

function makeBuilder(table: string): Builder {
  let verb = "select";
  let payload: unknown = null;
  const b: Builder = {
    select(cols?: string) {
      verb = "select";
      payload = cols;
      return b;
    },
    insert(rows: unknown) {
      verb = "insert";
      payload = rows;
      return b;
    },
    upsert(row: unknown) {
      verb = "upsert";
      payload = row;
      return b;
    },
    update(row: unknown) {
      verb = "update";
      payload = row;
      return b;
    },
    delete() {
      verb = "delete";
      return b;
    },
    eq() {
      return b;
    },
    in(col: string, values: string[]) {
      inFilters.push({ col, values });
      return b;
    },
    order() {
      return b;
    },
    range() {
      return b;
    },
    maybeSingle() {
      return b;
    },
    then(onOk, onErr) {
      calls.push({ table, verb, payload });
      const scripted = replies.get(`${table}.${verb}`);
      const result: QueryResult = {
        data: null,
        error: null,
        ...(scripted ?? {}),
      };
      return Promise.resolve(result).then(onOk, onErr);
    },
  };
  return b;
}

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const ModuleCtor = require("module") as { _load: Loader };
const realLoad = ModuleCtor._load;
const supabaseStub = {
  isSupabaseConfigured: () => true,
  supabase: {
    from: (table: string) => makeBuilder(table),
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: USER } } },
      }),
    },
  },
};
const cryptoStub = {
  // Encryption stubbed as JSON so tests can read the intended plaintext.
  AAD: {
    entry: () => "aad:entry",
    habit: () => "aad:habit",
    habitLog: () => "aad:habitLog",
  },
  keyring: {
    isUnlocked: () => true,
    getMasterKey: () => new Uint8Array(32),
    lock: async () => {},
  },
  encryptJson: (_mk: unknown, payload: unknown) => ({
    ciphertext: JSON.stringify(payload),
    nonce: "nonce",
  }),
  decryptJson: (_mk: unknown, blob: { ciphertext: string }) =>
    JSON.parse(blob.ciphertext),
  dayBucket: (_mk: unknown, date: string) => `day:${date}`,
  monthBucket: (_mk: unknown, ym: string) => `month:${ym}`,
  habitLogDayBucket: (_mk: unknown, habitId: string, date: string) =>
    `hl:${habitId}:${date}`,
  habitLogMonthBucket: (_mk: unknown, ym: string) => `hlm:${ym}`,
};
const stubs: Record<string, unknown> = {
  "../supabase": supabaseStub,
  "../crypto": cryptoStub,
};
ModuleCtor._load = function patchedLoad(request, parent, isMain) {
  if (request in stubs) return stubs[request];
  return realLoad.call(this, request, parent, isMain);
};

const habitsDb = require("../lib/db/habits") as typeof import("../lib/db/habits");
const logsDb =
  require("../lib/db/habit-logs") as typeof import("../lib/db/habit-logs");
const entriesDb =
  require("../lib/db/entries") as typeof import("../lib/db/entries");
const queueDb =
  require("../lib/db/pending-writes") as typeof import("../lib/db/pending-writes");

// lib/data-store pulls in React Native and the db modules by their own request
// strings; point those at the instances above so a replay really writes through
// the scripted server.
stubs["./supabase"] = supabaseStub;
stubs["./db/entries"] = entriesDb;
stubs["./db/habit-logs"] = logsDb;
stubs["./db/habits"] = habitsDb;
stubs["./db/pending-writes"] = queueDb;
stubs["react-native"] = {
  AppState: { addEventListener: () => ({ remove() {} }) },
};
const store = require("../lib/data-store") as typeof import("../lib/data-store");

function reset(): void {
  storage.clear();
  replies.clear();
  calls.length = 0;
  inFilters.length = 0;
  habitsDb.clearHabitsCache();
  logsDb.clearHabitLogsCache();
  entriesDb.clearEntriesCache();
}

/** The cache writers fire-and-forget their setItem — let the microtask land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Await a promise expecting a throw; returns the message. */
async function messageOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** A habits row as the server would return it (ciphertext = stubbed JSON). */
function habitRow(payload: Record<string, unknown>) {
  return { ciphertext: JSON.stringify(payload), nonce: "nonce" };
}

const H = (id: string, name: string, createdAt: string) => ({
  id,
  name,
  createdAt,
});

const LOG = (habitId: string, date: string, completed = true) => ({
  habitId,
  date,
  completed,
});

/** A habit_logs row as the server would return it. */
function logRow(habitId: string, date: string, completed = true) {
  return {
    day_bucket: `hl:${habitId}:${date}`,
    ciphertext: JSON.stringify({ habitId, date, completed }),
    nonce: "nonce",
  };
}

/** An entries row (one day, possibly several highlights). */
function entryRow(date: string, ids: string[]) {
  return {
    day_bucket: `day:${date}`,
    ciphertext: JSON.stringify({
      date,
      entries: ids.map((id) => ({
        id,
        text: id,
        createdAt: `${date}T10:00:00.000Z`,
      })),
    }),
    nonce: "nonce",
  };
}

// ---- habits: position (D11) ------------------------------------------------

suite("habits · durable order (D11)");

test("saveHabits stamps each habit with its array index", async () => {
  reset();
  const list = [
    H("h3", "Walk", "2026-01-03T00:00:00.000Z"),
    H("h1", "Read", "2026-01-01T00:00:00.000Z"),
    H("h2", "Water", "2026-01-02T00:00:00.000Z"),
  ];
  await habitsDb.saveHabits(list, USER);

  const insert = calls.find((c) => c.table === "habits" && c.verb === "insert");
  assertTrue(insert !== undefined, "an insert happened");
  const rows = insert?.payload as { ciphertext: string }[];
  assertEq(
    rows.map((r) => JSON.parse(r.ciphertext) as Record<string, unknown>),
    [
      { id: "h3", name: "Walk", createdAt: "2026-01-03T00:00:00.000Z", position: 0 },
      { id: "h1", name: "Read", createdAt: "2026-01-01T00:00:00.000Z", position: 1 },
      { id: "h2", name: "Water", createdAt: "2026-01-02T00:00:00.000Z", position: 2 },
    ],
    "array order becomes position 0,1,2",
  );
});

test("getHabits restores position order, not created_at order", async () => {
  reset();
  // Rows come back in created_at order (the query's `order`), but the user
  // dragged them into a different one.
  replies.set("habits.select", {
    data: [
      habitRow({ id: "h1", name: "Read", createdAt: "2026-01-01", position: 2 }),
      habitRow({ id: "h2", name: "Water", createdAt: "2026-01-02", position: 0 }),
      habitRow({ id: "h3", name: "Walk", createdAt: "2026-01-03", position: 1 }),
    ],
  });
  const result = await habitsDb.getHabits(USER);
  assertTrue(result.ok, "read succeeded");
  assertEq(
    result.ok ? result.data.map((h) => h.id) : [],
    ["h2", "h3", "h1"],
    "sorted by stored position",
  );
});

test("rows saved before positions existed keep created_at order", async () => {
  reset();
  // Pre-D11 payloads: no `position` at all. Scrambling these would be the
  // worst possible upgrade bug, so they must come back exactly as fetched.
  replies.set("habits.select", {
    data: [
      habitRow({ id: "h1", name: "Read", createdAt: "2026-01-01" }),
      habitRow({ id: "h2", name: "Water", createdAt: "2026-01-02" }),
      habitRow({ id: "h3", name: "Walk", createdAt: "2026-01-03" }),
    ],
  });
  const result = await habitsDb.getHabits(USER);
  assertEq(
    result.ok ? result.data.map((h) => h.id) : [],
    ["h1", "h2", "h3"],
    "legacy list untouched",
  );
});

test("a half-migrated list also keeps created_at order", async () => {
  reset();
  replies.set("habits.select", {
    data: [
      habitRow({ id: "h1", name: "Read", createdAt: "2026-01-01", position: 5 }),
      habitRow({ id: "h2", name: "Water", createdAt: "2026-01-02" }),
    ],
  });
  const result = await habitsDb.getHabits(USER);
  assertEq(
    result.ok ? result.data.map((h) => h.id) : [],
    ["h1", "h2"],
    "no partial re-sort",
  );
});

// ---- the throw contract (D5) ----------------------------------------------

suite("writes throw instead of self-queueing (D5)");

test("saveHabits throws on a failed clear and on a failed insert", async () => {
  reset();
  replies.set("habits.delete", { error: { message: "network down" } });
  assertTrue(
    (
      await messageOf(habitsDb.saveHabits([H("h1", "Read", "2026-01-01")], USER))
    ).startsWith("Failed to save habits"),
    "clear failure surfaces",
  );

  reset();
  replies.set("habits.insert", { error: { message: "network down" } });
  assertTrue(
    (
      await messageOf(habitsDb.saveHabits([H("h1", "Read", "2026-01-01")], USER))
    ).startsWith("Failed to save habits"),
    "insert failure surfaces",
  );
});

test("upsertHabitLog throws on a failed write", async () => {
  reset();
  replies.set("habit_logs.upsert", { error: { message: "network down" } });
  assertTrue(
    (
      await messageOf(logsDb.upsertHabitLog(LOG("h1", "2026-06-16"), USER))
    ).startsWith("Failed to update habit"),
    "write failure surfaces",
  );
});

test("saveEntry throws on a failed write and on an unreadable day", async () => {
  reset();
  replies.set("entries.upsert", { error: { message: "network down" } });
  const entry = {
    id: "e1",
    date: "2026-06-16",
    text: "hi",
    mediaPaths: [],
    createdAt: "2026-06-16T10:00:00.000Z",
  };
  assertTrue(
    (await messageOf(entriesDb.saveEntry(entry, USER))).startsWith(
      "Failed to save entry",
    ),
    "write failure surfaces",
  );

  reset();
  // The merge read failed: saving anyway would wipe the day's other highlights.
  replies.set("entries.select", { error: { message: "network down" } });
  assertTrue(
    (await messageOf(entriesDb.saveEntry(entry, USER))).startsWith(
      "Failed to save entry",
    ),
    "merge-read failure surfaces instead of overwriting the day",
  );
});

// ---- deletes are real writes (D6) ------------------------------------------

suite("deleteEntry reports failure (D6)");

test("deleteEntry throws when the server rejects the delete", async () => {
  reset();
  replies.set("entries.select", {
    data: {
      ciphertext: JSON.stringify({
        date: "2026-06-16",
        entries: [{ id: "e1", text: "hi", createdAt: "2026-06-16T10:00:00.000Z" }],
      }),
      nonce: "nonce",
    },
  });
  replies.set("entries.delete", { error: { message: "network down" } });
  assertTrue(
    (await messageOf(entriesDb.deleteEntry("e1", "2026-06-16", USER))).startsWith(
      "Failed to delete entry",
    ),
    "delete failure surfaces so the caller can queue it",
  );
});

test("deleteEntry of a day with siblings updates instead of deleting", async () => {
  reset();
  replies.set("entries.select", {
    data: {
      ciphertext: JSON.stringify({
        date: "2026-06-16",
        entries: [
          { id: "e1", text: "one", createdAt: "2026-06-16T10:00:00.000Z" },
          { id: "e2", text: "two", createdAt: "2026-06-16T11:00:00.000Z" },
        ],
      }),
      nonce: "nonce",
    },
  });
  await entriesDb.deleteEntry("e1", "2026-06-16", USER);
  const update = calls.find((c) => c.table === "entries" && c.verb === "update");
  assertTrue(update !== undefined, "the day row was rewritten, not dropped");
  const written = JSON.parse(
    (update?.payload as { ciphertext: string }).ciphertext,
  ) as { entries: { id: string }[] };
  assertEq(
    written.entries.map((e) => e.id),
    ["e2"],
    "only the sibling survives",
  );
});

test("deleting an entry the server never had is a clean no-op", async () => {
  reset();
  replies.set("entries.select", { data: null });
  await entriesDb.deleteEntry("e1", "2026-06-16", USER); // must not throw
  assertTrue(
    !calls.some((c) => c.table === "entries" && c.verb === "delete"),
    "nothing to delete server-side",
  );
});

// ---- habit deletion purges its logs (D12), forward-computed ----------

suite("habit deletion purges its logs (D12)");

test("the sweep deletes forward-computed buckets and reads nothing", async () => {
  reset();
  await logsDb.deleteHabitLogsForHabit("h1", USER, {
    from: "2026-06-01",
    to: "2026-06-03",
  });

  assertTrue(
    !calls.some((c) => c.table === "habit_logs" && c.verb === "select"),
    "no rows are downloaded or decrypted to find the habit's logs",
  );
  assertEq(
    inFilters.map((f) => f.values),
    [["hl:h1:2026-06-01", "hl:h1:2026-06-02", "hl:h1:2026-06-03"]],
    "one delete, one bucket per day in range — and only this habit's",
  );
});

test("a long history is chunked, never one giant request", async () => {
  reset();
  await logsDb.deleteHabitLogsForHabit("h1", USER, {
    from: "2024-01-01",
    to: "2024-12-31", // 366 days (leap year)
  });
  assertEq(inFilters.length, 4, "366 days → 4 chunks of ≤100");
  assertEq(
    inFilters.reduce((n, f) => n + f.values.length, 0),
    366,
    "every day in range covered exactly once",
  );
});

test("an inverted or unparseable range deletes nothing", async () => {
  reset();
  await logsDb.deleteHabitLogsForHabit("h1", USER, {
    from: "2026-06-10",
    to: "2026-06-01",
  });
  await logsDb.deleteHabitLogsForHabit("h1", USER, { from: "nonsense", to: "x" });
  assertEq(inFilters.length, 0, "no delete issued");
});

test("the purge throws when the server rejects it", async () => {
  reset();
  replies.set("habit_logs.delete", { error: { message: "network down" } });
  assertTrue(
    (
      await messageOf(
        logsDb.deleteHabitLogsForHabit("h1", USER, {
          from: "2026-06-01",
          to: "2026-06-02",
        }),
      )
    ).startsWith("Failed to remove habit history"),
    "so the caller can queue the purge",
  );
});

test("enumeratePurgeDays is inclusive and clamps an absurd range", () => {
  assertEq(
    logsDb.enumeratePurgeDays("2026-06-28", "2026-07-02"),
    ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"],
    "crosses a month boundary, both ends included",
  );
  const clamped = logsDb.enumeratePurgeDays("1900-01-01", "2026-06-30");
  assertTrue(clamped.length === 366 * 12, "clamped to the ceiling");
  assertEq(
    clamped[clamped.length - 1],
    "2026-06-30",
    "the clamp keeps the most recent days",
  );
});

// ---- the purge sweeps the disk too -----------------------------------

suite("habit deletion clears cached logs on disk");

test("a month that only exists in AsyncStorage loses the habit's logs", async () => {
  reset();
  // A month from a previous session: on disk, never loaded into memory.
  storage.set(
    "banana_habit_logs_v2:user-1:2026-05",
    JSON.stringify([LOG("h1", "2026-05-04"), LOG("h2", "2026-05-04")]),
  );
  // …and a month that IS loaded in memory.
  logsDb.setCachedHabitLogsForMonth(2026, 6, USER, [
    LOG("h1", "2026-06-01"),
    LOG("h2", "2026-06-01"),
  ]);
  await settle();

  await logsDb.deleteHabitLogsForHabit("h1", USER, {
    from: "2026-05-01",
    to: "2026-06-30",
  });
  await settle();

  assertEq(
    JSON.parse(storage.get("banana_habit_logs_v2:user-1:2026-05") as string),
    [LOG("h2", "2026-05-04")],
    "the disk-only month was swept — a cold start can't resurrect h1",
  );
  assertEq(
    JSON.parse(storage.get("banana_habit_logs_v2:user-1:2026-06") as string),
    [LOG("h2", "2026-06-01")],
    "the in-memory month was swept through to disk",
  );
  assertEq(
    logsDb.getCachedHabitLogsForMonth(2026, 6, USER),
    [LOG("h2", "2026-06-01")],
    "and in memory",
  );
});

test("another user's cached months are never touched", async () => {
  reset();
  storage.set(
    "banana_habit_logs_v2:user-2:2026-05",
    JSON.stringify([LOG("h1", "2026-05-04")]),
  );
  await logsDb.deleteHabitLogsForHabit("h1", USER, {
    from: "2026-05-01",
    to: "2026-05-31",
  });
  await settle();
  assertEq(
    JSON.parse(storage.get("banana_habit_logs_v2:user-2:2026-05") as string),
    [LOG("h1", "2026-05-04")],
    "a second account on the same device keeps its cache",
  );
});

// ---- a failed read must not destroy the cache ------------------------

suite("a failed read reports failure and keeps the cache");

test("habits: the cached list survives a server error", async () => {
  reset();
  habitsDb.setCachedHabits(USER, [H("h1", "Read", "2026-01-01")]);
  await settle();

  replies.set("habits.select", { error: { message: "network down" } });
  const result = await habitsDb.getHabits(USER);

  assertEq(result.ok, false, "the read reports failure instead of []");
  assertEq(
    habitsDb.getCachedHabits(USER),
    [H("h1", "Read", "2026-01-01")],
    "memory tier untouched",
  );
  assertEq(
    JSON.parse(storage.get("banana_habits_v2:user-1") as string),
    [H("h1", "Read", "2026-01-01")],
    "storage tier untouched",
  );
});

test("habit logs: a failed month read leaves memory and disk alone", async () => {
  reset();
  logsDb.setCachedHabitLogsForMonth(2026, 6, USER, [LOG("h1", "2026-06-16")]);
  await settle();

  replies.set("habit_logs.select", { error: { message: "offline" } });
  const result = await logsDb.getHabitLogsForMonths([{ year: 2026, month: 6 }], USER);
  await settle();

  assertEq(result.ok, false, "failure is reported, not an empty month");
  assertEq(
    logsDb.getCachedHabitLogsForMonth(2026, 6, USER),
    [LOG("h1", "2026-06-16")],
    "memory tier untouched",
  );
  assertEq(
    JSON.parse(storage.get("banana_habit_logs_v2:user-1:2026-06") as string),
    [LOG("h1", "2026-06-16")],
    "storage tier untouched — pull-to-refresh offline can't wipe the month",
  );
});

test("entries: a failed month read leaves memory and disk alone", async () => {
  reset();
  const entry = {
    id: "e1",
    date: "2026-06-16",
    text: "hello",
    mediaPaths: [],
    createdAt: "2026-06-16T09:00:00.000Z",
  };
  entriesDb.setCachedEntriesForMonth(2026, 6, USER, [entry]);
  await settle();

  replies.set("entries.select", { error: { message: "offline" } });
  const result = await entriesDb.getEntriesForMonths(
    [{ year: 2026, month: 6 }],
    USER,
  );
  await settle();

  assertEq(result.ok, false, "failure is reported");
  assertEq(
    entriesDb.getCachedEntriesForMonth(2026, 6, USER),
    [entry],
    "memory tier untouched",
  );
  assertEq(
    JSON.parse(storage.get("banana_entries_v2:user-1:2026-06") as string),
    [entry],
    "storage tier untouched",
  );
});

test("a genuinely empty month IS cached — empty is a real answer", async () => {
  reset();
  replies.set("habit_logs.select", { data: [] });
  const result = await logsDb.getHabitLogsForMonths(
    [{ year: 2026, month: 6 }],
    USER,
  );
  await settle();
  assertEq(result.ok, true, "the read succeeded");
  assertEq(logsDb.getCachedHabitLogsForMonth(2026, 6, USER), [], "cached as empty");
});

test("one undecryptable row is skipped, the read still succeeds", async () => {
  reset();
  replies.set("habit_logs.select", {
    data: [
      logRow("h1", "2026-06-01"),
      { day_bucket: "hl:corrupt", ciphertext: "not json", nonce: "nonce" },
      logRow("h1", "2026-06-02"),
    ],
  });
  const result = await logsDb.getHabitLogsForMonths(
    [{ year: 2026, month: 6 }],
    USER,
  );
  assertTrue(result.ok, "a bad row is not a failed read");
  assertEq(
    result.ok ? result.data.get("2026-06") : null,
    [LOG("h1", "2026-06-01"), LOG("h1", "2026-06-02")],
    "the readable rows still land",
  );
});

// ---- a window of months is one query ---------------------------------

suite("a window of months is ONE query");

test("twelve months of logs cost one round trip, grouped by decrypted date", async () => {
  reset();
  replies.set("habit_logs.select", {
    data: [
      logRow("h1", "2026-06-01"),
      logRow("h1", "2026-05-31"),
      logRow("h2", "2026-04-02"),
    ],
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2026, 5 - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const result = await logsDb.getHabitLogsForMonths(months, USER);
  await settle();

  assertEq(
    calls.filter((c) => c.table === "habit_logs" && c.verb === "select").length,
    1,
    "one query, not twelve",
  );
  assertTrue(result.ok, "read ok");
  const byMonth = result.ok ? result.data : new Map();
  assertEq(byMonth.get("2026-06"), [LOG("h1", "2026-06-01")], "June");
  assertEq(byMonth.get("2026-05"), [LOG("h1", "2026-05-31")], "May");
  assertEq(byMonth.get("2026-04"), [LOG("h2", "2026-04-02")], "April");
  assertEq(byMonth.get("2026-03"), [], "a month with no rows is empty, not absent");
  assertEq(byMonth.size, 12, "every requested month is answered");
  assertEq(
    logsDb.getCachedHabitLogsForMonth(2026, 3, USER),
    [],
    "the empty month is cached as resolved-empty",
  );
});

test("the window filters on month buckets the client computed", async () => {
  reset();
  replies.set("entries.select", { data: [entryRow("2026-06-16", ["e1", "e2"])] });
  const result = await entriesDb.getEntriesForMonths(
    [
      { year: 2026, month: 6 },
      { year: 2026, month: 5 },
    ],
    USER,
  );
  assertEq(
    inFilters.map((f) => f),
    [{ col: "month_bucket", values: ["month:2026-06", "month:2026-05"] }],
    "one .in() over both month buckets — the server learns nothing new",
  );
  assertEq(
    result.ok ? (result.data.get("2026-06") ?? []).map((e) => e.id) : [],
    ["e1", "e2"],
    "both highlights of the day are unpacked",
  );
});

// ---- replayed writes reach store state -------------------------------

suite("a replayed write is applied back to state");

/** Records what the store would have applied, without mounting React. */
function recordingHandlers() {
  const applied: string[] = [];
  return {
    applied,
    handlers: {
      userId: USER,
      onEntrySaved: (e: { id: string }) => applied.push(`entry:${e.id}`),
      onEntryDeleted: (id: string) => applied.push(`entry-deleted:${id}`),
      onHabitsSaved: (list: { id: string }[]) =>
        applied.push(`habits:${list.map((h) => h.id).join(",")}`),
      onHabitLogSaved: (l: { habitId: string; date: string; completed: boolean }) =>
        applied.push(`log:${l.habitId}:${l.date}:${l.completed}`),
      onHabitLogsPurged: (habitId: string) => applied.push(`purged:${habitId}`),
      fallbackPurgeRange: () => ({ from: "2026-06-01", to: "2026-06-02" }),
    },
  };
}

test("a replayed habit-log lands on the server AND in state", async () => {
  reset();
  const { applied, handlers } = recordingHandlers();
  const executor = store.createFlushExecutor(handlers);

  await executor({
    id: "pw1",
    key: "habitLog:h1:2026-06-16",
    queuedAt: "2026-06-16T10:00:00.000Z",
    kind: "habitLog",
    payload: LOG("h1", "2026-06-16"),
  });

  assertTrue(
    calls.some((c) => c.table === "habit_logs" && c.verb === "upsert"),
    "the write reached the server",
  );
  assertEq(
    applied,
    ["log:h1:2026-06-16:true"],
    "…and the optimistic tick was re-applied, so the UI stops lying",
  );
});

test("a replay that fails throws and applies nothing", async () => {
  reset();
  replies.set("habit_logs.upsert", { error: { message: "still offline" } });
  const { applied, handlers } = recordingHandlers();
  const executor = store.createFlushExecutor(handlers);

  const message = await messageOf(
    executor({
      id: "pw1",
      key: "habitLog:h1:2026-06-16",
      queuedAt: "2026-06-16T10:00:00.000Z",
      kind: "habitLog",
      payload: LOG("h1", "2026-06-16"),
    }),
  );
  assertTrue(message.startsWith("Failed to update habit"), "it throws (stays queued)");
  assertEq(applied, [], "nothing applied for a write the server never took");
});

test("replayed entries, habits and purges all re-apply", async () => {
  reset();
  const { applied, handlers } = recordingHandlers();
  const executor = store.createFlushExecutor(handlers);
  const entry = {
    id: "e1",
    date: "2026-06-16",
    text: "hi",
    mediaPaths: [],
    createdAt: "2026-06-16T10:00:00.000Z",
  };

  await executor({
    id: "a",
    key: "entry:e1",
    queuedAt: "x",
    kind: "entry",
    payload: entry,
  });
  await executor({
    id: "b",
    key: "entry:e2",
    queuedAt: "x",
    op: "delete",
    kind: "entry",
    payload: { id: "e2", date: "2026-06-15" },
  });
  await executor({
    id: "c",
    key: "habits",
    queuedAt: "x",
    kind: "habits",
    payload: [H("h1", "Read", "2026-01-01")],
  });
  await executor({
    id: "d",
    key: "habitLogs:h9",
    queuedAt: "x",
    op: "delete",
    kind: "habitLogs",
    payload: { habitId: "h9", from: "2026-06-01", to: "2026-06-02" },
  });

  assertEq(
    applied,
    ["entry:e1", "entry-deleted:e2", "habits:h1", "purged:h9"],
    "every replayed kind updates local state",
  );
});

test("a purge queued without a range replays on the fallback range", async () => {
  reset();
  const { handlers } = recordingHandlers();
  const executor = store.createFlushExecutor(handlers);
  await executor({
    id: "e",
    key: "habitLogs:h9",
    queuedAt: "x",
    op: "delete",
    kind: "habitLogs",
    payload: { habitId: "h9" }, // queued by an older build
  });
  assertEq(
    inFilters.map((f) => f.values),
    [["hl:h9:2026-06-01", "hl:h9:2026-06-02"]],
    "the caller's fallback range is swept instead of nothing",
  );
});

// ---- the queue outlives a sign-out -----------------------------------

suite("queued writes survive logout");

test("clearing the in-memory caches (sign-out) leaves the queue intact", async () => {
  reset();
  await queueDb.enqueuePendingWrite(USER, {
    kind: "habitLog",
    payload: LOG("h1", "2026-06-16"),
  });

  // What signing out actually does: drop the in-memory tiers, keep the disk.
  habitsDb.clearHabitsCache();
  logsDb.clearHabitLogsCache();
  entriesDb.clearEntriesCache();

  assertEq(
    await queueDb.pendingWriteCount(USER),
    1,
    "the unsynced write is still there for the next sign-in",
  );
});

test("the data store never clears the queue on logout", () => {
  // `clearAll` needs React to run, so the guard is on the wiring: the store
  // must not import the queue-clearing helper at all. Dropping the queue while
  // the AsyncStorage caches survive is what caused permanent divergence — the
  // optimistic value stayed on disk while its write was destroyed.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "data-store.tsx"),
    "utf-8",
  );
  assertTrue(
    !source.includes("clearPendingWrites"),
    "only account deletion (lib/auth/local-purge.ts) may clear the queue",
  );
});

test("account deletion DOES clear the queue", async () => {
  reset();
  await queueDb.enqueuePendingWrite(USER, {
    kind: "habitLog",
    payload: LOG("h1", "2026-06-16"),
  });
  assertEq(await queueDb.pendingWriteCount(USER), 1, "queued");

  stubs["../media"] = { clearMediaCache: () => {} };
  stubs["../reminder"] = { clearReminder: async () => {} };
  // lib/location pulls in expo-location -> expo-modules-core, which reads the
  // native `expo` global at import time and throws under the Node harness.
  // Stubbed for the same reason as media and reminder above.
  stubs["../location"] = { clearLocationPref: async () => {} };
  const purge =
    require("../lib/auth/local-purge") as typeof import("../lib/auth/local-purge");
  await purge.purgeLocalUserData(USER);

  assertEq(
    await queueDb.pendingWriteCount(USER),
    0,
    "a deleted account leaves nothing to replay",
  );
});

(async () => {
  await run();
})();
