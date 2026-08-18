// Tests for the lib/db write contract (D5/D6/D11/D12).
//
// What's covered, all headless:
//   - writes THROW on a server error instead of queueing their own retry (D5) —
//     the data store is the only place that enqueues, so a failed replay stays
//     queued instead of being rewritten;
//   - deleteEntry surfaces its errors at all (D6 — it used to ignore them);
//   - habits carry an explicit `position` and getHabits restores it, falling
//     back to created_at order for rows saved before positions existed (D11);
//   - deleting a habit purges that habit's logs, and only that habit's (D12).
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
/** Values passed to `.in('day_bucket', …)`, per call, for the purge test. */
const inFilters: string[][] = [];

interface Builder extends PromiseLike<QueryResult> {
  select: (cols?: string) => Builder;
  insert: (rows: unknown) => Builder;
  upsert: (row: unknown, opts?: unknown) => Builder;
  update: (row: unknown) => Builder;
  delete: () => Builder;
  eq: (col: string, value: unknown) => Builder;
  in: (col: string, values: string[]) => Builder;
  order: (col: string, opts?: unknown) => Builder;
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
    in(_col: string, values: string[]) {
      inFilters.push(values);
      return b;
    },
    order() {
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
const stubs: Record<string, unknown> = {
  "../supabase": {
    isSupabaseConfigured: () => true,
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: USER } } },
        }),
      },
    },
  },
  "../crypto": {
    // Encryption stubbed as JSON so tests can read the intended plaintext.
    AAD: {
      entry: () => "aad:entry",
      habit: () => "aad:habit",
      habitLog: () => "aad:habitLog",
    },
    keyring: { isUnlocked: () => true, getMasterKey: () => new Uint8Array(32) },
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
  },
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

function reset(): void {
  storage.clear();
  replies.clear();
  calls.length = 0;
  inFilters.length = 0;
  habitsDb.clearHabitsCache();
  logsDb.clearHabitLogsCache();
  entriesDb.clearEntriesCache();
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

// ---- habits: position (D11) ------------------------------------------------

suite("habits · durable order (D11)");

test("saveHabits stamps each habit with its array index", async () => {
  reset();
  const list = [
    H("h3", "Walk", "2026-01-03T00:00:00.000Z"),
    H("h1", "Read", "2026-01-01T00:00:00.000Z"),
    H("h2", "Water", "2026-01-02T00:00:00.000Z"),
  ];
  await habitsDb.saveHabits(list);

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
  const list = await habitsDb.getHabits({ force: true });
  assertEq(
    list.map((h) => h.id),
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
  assertEq(
    (await habitsDb.getHabits({ force: true })).map((h) => h.id),
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
  assertEq(
    (await habitsDb.getHabits({ force: true })).map((h) => h.id),
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
    (await messageOf(habitsDb.saveHabits([H("h1", "Read", "2026-01-01")]))).startsWith(
      "Failed to save habits",
    ),
    "clear failure surfaces",
  );

  reset();
  replies.set("habits.insert", { error: { message: "network down" } });
  assertTrue(
    (await messageOf(habitsDb.saveHabits([H("h1", "Read", "2026-01-01")]))).startsWith(
      "Failed to save habits",
    ),
    "insert failure surfaces",
  );
});

test("upsertHabitLog throws on a failed write", async () => {
  reset();
  replies.set("habit_logs.upsert", { error: { message: "network down" } });
  assertTrue(
    (
      await messageOf(
        logsDb.upsertHabitLog({ habitId: "h1", date: "2026-06-16", completed: true }),
      )
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
    (await messageOf(entriesDb.saveEntry(entry))).startsWith("Failed to save entry"),
    "write failure surfaces",
  );

  reset();
  // The merge read failed: saving anyway would wipe the day's other highlights.
  replies.set("entries.select", { error: { message: "network down" } });
  assertTrue(
    (await messageOf(entriesDb.saveEntry(entry))).startsWith("Failed to save entry"),
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
    (await messageOf(entriesDb.deleteEntry("e1", "2026-06-16"))).startsWith(
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
  await entriesDb.deleteEntry("e1", "2026-06-16");
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
  await entriesDb.deleteEntry("e1", "2026-06-16"); // must not throw
  assertTrue(
    !calls.some((c) => c.table === "entries" && c.verb === "delete"),
    "nothing to delete server-side",
  );
});

// ---- habit deletion purges its logs (D12) ----------------------------------

suite("habit deletion purges its logs (D12)");

test("only the target habit's buckets are deleted", async () => {
  reset();
  const log = (habitId: string, date: string) => ({
    day_bucket: `hl:${habitId}:${date}`,
    ciphertext: JSON.stringify({ habitId, date, completed: true }),
    nonce: "nonce",
  });
  replies.set("habit_logs.select", {
    data: [
      log("h1", "2026-06-01"),
      log("h2", "2026-06-01"),
      log("h1", "2026-06-02"),
      { day_bucket: "hl:corrupt", ciphertext: "not json", nonce: "nonce" },
    ],
  });

  await logsDb.deleteHabitLogsForHabit("h1");
  assertEq(inFilters.length, 1, "one chunked delete");
  assertEq(
    inFilters[0],
    ["hl:h1:2026-06-01", "hl:h1:2026-06-02"],
    "h1's logs only — h2 and the unreadable row are left alone",
  );
});

test("a habit with no logs issues no delete at all", async () => {
  reset();
  replies.set("habit_logs.select", { data: [] });
  await logsDb.deleteHabitLogsForHabit("h1");
  assertEq(inFilters.length, 0, "nothing to delete");
});

test("the purge throws when the server rejects it", async () => {
  reset();
  replies.set("habit_logs.select", {
    data: [
      {
        day_bucket: "hl:h1:2026-06-01",
        ciphertext: JSON.stringify({
          habitId: "h1",
          date: "2026-06-01",
          completed: true,
        }),
        nonce: "nonce",
      },
    ],
  });
  replies.set("habit_logs.delete", { error: { message: "network down" } });
  assertTrue(
    (await messageOf(logsDb.deleteHabitLogsForHabit("h1"))).startsWith(
      "Failed to remove habit history",
    ),
    "so the caller can queue the purge",
  );
});

(async () => {
  await run();
})();
