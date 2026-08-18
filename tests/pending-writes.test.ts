// Tests for the pending-writes retry queue (NFR-1: no silent data loss).
//
// AsyncStorage handling: tests/setup.ts does NOT shim AsyncStorage, and the real
// @react-native-async-storage/async-storage module talks to a native bridge that
// doesn't exist headless. So at module load we replace the AsyncStorage default
// export's methods with a simple in-memory Map-backed mock. pending-writes.ts is
// statically imported but only *calls* AsyncStorage inside its functions (never
// at load), so patching the shared object before any test runs is sufficient —
// the module hits our in-memory mock, no native bridge, fully headless.

import "./setup";
import { assertEq, assertTrue, run, test } from "./helpers";

import AsyncStorageReal from "@react-native-async-storage/async-storage";
import {
  clearPendingWrites,
  enqueuePendingWrite,
  flushPendingWrites,
  getPendingWrites,
  type PendingWrite,
  pendingWriteCount,
  pendingWriteKey,
  removePendingWrite,
} from "../lib/db/pending-writes";

// ---- in-memory AsyncStorage mock -------------------------------------------
const store = new Map<string, string>();
let failNextSet = false; // toggle to simulate a write failure

const mock = {
  async getItem(key: string): Promise<string | null> {
    return store.has(key) ? (store.get(key) as string) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (failNextSet) {
      failNextSet = false;
      throw new Error("simulated storage failure");
    }
    store.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    store.delete(key);
  },
};

// Overwrite the methods on the live AsyncStorage object so the module under test
// (which calls AsyncStorage.getItem/setItem/removeItem) hits our in-memory mock.
Object.assign(AsyncStorageReal, mock);

const U = "user-1";

async function reset(): Promise<void> {
  store.clear();
  failNextSet = false;
}

// ---- fixtures --------------------------------------------------------------
const entry = {
  id: "e1",
  date: "2026-06-16",
  text: "hello",
  mediaPaths: ["u/e1/m1.jpg"],
  createdAt: "2026-06-16T10:00:00.000Z",
};
const habits = [{ id: "h1", name: "Read", createdAt: "2026-06-01T00:00:00.000Z" }];
const habitLog = { habitId: "h1", date: "2026-06-16", completed: true };

// ---- tests -----------------------------------------------------------------

test("enqueue→get round-trips all 3 kinds, order preserved, ids/queuedAt set", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habits", payload: habits });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });

  const q = await getPendingWrites(U);
  assertEq(q.length, 3, "three queued");
  assertEq(
    q.map((w) => w.kind),
    ["entry", "habits", "habitLog"],
    "oldest-first order preserved",
  );
  // payloads survive the round-trip (narrow by kind first, then compare payload)
  const [w0, w1, w2] = q;
  assertTrue(w0.kind === "entry", "first is entry");
  assertEq(w0.payload, entry, "entry payload");
  assertTrue(w1.kind === "habits", "second is habits");
  assertEq(w1.payload, habits, "habits payload");
  assertTrue(w2.kind === "habitLog", "third is habitLog");
  assertEq(w2.payload, habitLog, "habitLog payload");
  // generated fields populated and unique
  for (const w of q) {
    assertTrue(typeof w.id === "string" && w.id.length > 0, "id populated");
    assertTrue(
      typeof w.queuedAt === "string" && !Number.isNaN(Date.parse(w.queuedAt)),
      "queuedAt is an ISO date",
    );
  }
  assertEq(new Set(q.map((w) => w.id)).size, 3, "ids are unique");
});

test("pendingWriteCount reflects queue length", async () => {
  await reset();
  assertEq(await pendingWriteCount(U), 0, "starts at 0");
  // Two DIFFERENT keys (same habit, different days) → two queued items.
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  await enqueuePendingWrite(U, {
    kind: "habitLog",
    payload: { ...habitLog, date: "2026-06-17" },
  });
  assertEq(await pendingWriteCount(U), 2, "two after enqueues");
});

test("removePendingWrite removes one by id, leaves the rest", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  const q = await getPendingWrites(U);
  await removePendingWrite(U, q[0].id);
  const after = await getPendingWrites(U);
  assertEq(after.length, 1, "one remains");
  assertEq(after[0].kind, "habitLog", "the right one remains");
  // removing a non-existent id is a no-op
  await removePendingWrite(U, "does-not-exist");
  assertEq(await pendingWriteCount(U), 1, "no-op for unknown id");
});

test("clearPendingWrites empties the queue", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habits", payload: habits });
  await clearPendingWrites(U);
  assertEq(await pendingWriteCount(U), 0, "cleared");
  assertEq((await getPendingWrites(U)).length, 0, "empty list");
});

test("flush where executor always succeeds: queue empties, flushed=N", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habits", payload: habits });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });

  const seen: string[] = [];
  const res = await flushPendingWrites(U, async (item) => {
    seen.push(item.kind);
  });
  assertEq(res, { flushed: 3, remaining: 0 }, "all flushed");
  assertEq(seen, ["entry", "habits", "habitLog"], "processed oldest-first");
  assertEq(await pendingWriteCount(U), 0, "queue empty after flush");
});

test("flush where executor always throws: nothing removed, flushed=0", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });

  const res = await flushPendingWrites(U, async () => {
    throw new Error("network down");
  });
  assertEq(res, { flushed: 0, remaining: 2 }, "nothing flushed, all remain");
  assertEq(await pendingWriteCount(U), 2, "queue intact after failed flush");
});

test("flush with mixed success/failure keeps only the failures", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry }); // ok
  await enqueuePendingWrite(U, { kind: "habits", payload: habits }); // fail
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog }); // ok

  const res = await flushPendingWrites(U, async (item: PendingWrite) => {
    if (item.kind === "habits") throw new Error("transient");
  });
  assertEq(res, { flushed: 2, remaining: 1 }, "2 flushed, 1 kept");
  const left = await getPendingWrites(U);
  assertEq(left.length, 1, "one survivor");
  assertEq(left[0].kind, "habits", "the failed one stayed");
});

test("flush on empty queue is a clean no-op", async () => {
  await reset();
  const res = await flushPendingWrites(U, async () => {
    throw new Error("should not be called");
  });
  assertEq(res, { flushed: 0, remaining: 0 }, "empty flush returns zeros");
});

test("missing storage → reads return [] / 0, never throw", async () => {
  await reset();
  assertEq(await getPendingWrites(U), [], "no key → empty list");
  assertEq(await pendingWriteCount(U), 0, "no key → 0");
});

test("corrupt storage → reads degrade to [] / 0, never throw", async () => {
  await reset();
  // not valid JSON
  store.set("banana_pending_writes_v1:" + U, "{not json");
  assertEq(await getPendingWrites(U), [], "corrupt JSON → empty list");
  assertEq(await pendingWriteCount(U), 0, "corrupt JSON → 0");
  // valid JSON but not an array
  store.set("banana_pending_writes_v1:" + U, '{"foo":1}');
  assertEq(await getPendingWrites(U), [], "non-array JSON → empty list");
  // flush over corrupt storage is a safe no-op
  const res = await flushPendingWrites(U, async () => {});
  assertEq(res, { flushed: 0, remaining: 0 }, "flush over corrupt → zeros");
});

test("per-user isolation: queues keyed by userId", async () => {
  await reset();
  await enqueuePendingWrite("alice", { kind: "habitLog", payload: habitLog });
  await enqueuePendingWrite("bob", { kind: "entry", payload: entry });
  await enqueuePendingWrite("bob", { kind: "habits", payload: habits });
  assertEq(await pendingWriteCount("alice"), 1, "alice has 1");
  assertEq(await pendingWriteCount("bob"), 2, "bob has 2");
  await clearPendingWrites("bob");
  assertEq(await pendingWriteCount("alice"), 1, "alice untouched");
  assertEq(await pendingWriteCount("bob"), 0, "bob cleared");
});

test("flush never throws even if persisting the trimmed queue fails", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  // make the final writeQueue setItem throw; flush must still resolve with counts
  failNextSet = true;
  const res = await flushPendingWrites(U, async () => {});
  assertEq(res.flushed, 1, "still reports the flushed write");
  assertEq(res.remaining, 0, "no survivors");
});

// ---- coalescing by key (D7) ------------------------------------------------

test("keys identify the target row, not the revision", async () => {
  assertEq(pendingWriteKey({ kind: "entry", payload: entry }), "entry:e1", "entry key");
  assertEq(
    pendingWriteKey({ op: "delete", kind: "entry", payload: { id: "e1", date: entry.date } }),
    "entry:e1",
    "an entry delete shares the entry's key",
  );
  assertEq(pendingWriteKey({ kind: "habits", payload: habits }), "habits", "one habits key");
  assertEq(
    pendingWriteKey({ kind: "habitLog", payload: habitLog }),
    "habitLog:h1:2026-06-16",
    "habitLog key is habit + day",
  );
  assertEq(
    pendingWriteKey({ op: "delete", kind: "habitLogs", payload: { habitId: "h1" } }),
    "habitLogs:h1",
    "habit-log purge key",
  );
});

test("repeated writes to one key coalesce: 1 item, last payload wins", async () => {
  await reset();
  // Toggling one cell 4 times offline must leave ONE queued write, not four.
  for (const completed of [true, false, true, false]) {
    await enqueuePendingWrite(U, {
      kind: "habitLog",
      payload: { ...habitLog, completed },
    });
  }
  const q = await getPendingWrites(U);
  assertEq(q.length, 1, "coalesced to one");
  assertTrue(q[0].kind === "habitLog", "still a habitLog");
  assertEq(q[0].payload, { ...habitLog, completed: false }, "last write wins");

  // Same for the whole-list habits write.
  await enqueuePendingWrite(U, { kind: "habits", payload: habits });
  await enqueuePendingWrite(U, {
    kind: "habits",
    payload: [...habits, { id: "h2", name: "Walk", createdAt: habits[0].createdAt }],
  });
  const q2 = await getPendingWrites(U);
  assertEq(q2.length, 2, "one habitLog + one habits");
  const habitsItem = q2.find((w) => w.key === "habits");
  assertTrue(habitsItem?.kind === "habits", "habits item present");
  assertEq(
    habitsItem?.kind === "habits" ? habitsItem.payload.length : 0,
    2,
    "the newest list is the queued one",
  );
});

test("coalescing keeps the slot + queuedAt, but takes a new id", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  const before = (await getPendingWrites(U))[0];

  await enqueuePendingWrite(U, {
    kind: "entry",
    payload: { ...entry, text: "edited" },
  });
  const after = await getPendingWrites(U);
  assertEq(after.length, 2, "still two items");
  assertEq(after[0].key, "entry:e1", "replacement kept its oldest-first slot");
  assertEq(
    after[0].queuedAt,
    before.queuedAt,
    "queuedAt preserved so 'pending since' stays truthful",
  );
  assertTrue(after[0].id !== before.id, "new revision gets a new id");
  assertTrue(
    after[0].kind === "entry" &&
      after[0].op === "save" &&
      after[0].payload.text === "edited",
    "newest text",
  );
});

// ---- delete ops (D6) -------------------------------------------------------

test("delete ops round-trip and replay through the executor", async () => {
  await reset();
  await enqueuePendingWrite(U, {
    op: "delete",
    kind: "entry",
    payload: { id: "e1", date: entry.date },
  });
  await enqueuePendingWrite(U, {
    op: "delete",
    kind: "habitLogs",
    payload: { habitId: "h1" },
  });

  const q = await getPendingWrites(U);
  assertEq(q.length, 2, "two deletes queued");
  assertEq(
    q.map((w) => w.op),
    ["delete", "delete"],
    "both marked as deletes",
  );

  const seen: string[] = [];
  const res = await flushPendingWrites(U, async (item) => {
    seen.push(`${item.op}:${item.kind}`);
  });
  assertEq(seen, ["delete:entry", "delete:habitLogs"], "executor sees the op");
  assertEq(res, { flushed: 2, remaining: 0 }, "both flushed");
});

test("a delete supersedes a pending save for the same key", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, {
    op: "delete",
    kind: "entry",
    payload: { id: entry.id, date: entry.date },
  });
  const q = await getPendingWrites(U);
  assertEq(q.length, 1, "one item for that entry");
  assertEq(q[0].op, "delete", "the delete won — the entry must not come back");
});

test("a save supersedes a pending delete for the same key", async () => {
  await reset();
  await enqueuePendingWrite(U, {
    op: "delete",
    kind: "entry",
    payload: { id: entry.id, date: entry.date },
  });
  await enqueuePendingWrite(U, {
    kind: "entry",
    payload: { ...entry, text: "rewritten" },
  });
  const q = await getPendingWrites(U);
  assertEq(q.length, 1, "one item for that entry");
  assertEq(q[0].op, "save", "the re-save won");
  assertTrue(
    q[0].kind === "entry" && q[0].op === "save" && q[0].payload.text === "rewritten",
    "with the new text",
  );
});

// ---- D5 regression: a failed replay is RETRIED, not rewritten ---------------

test("D5: a failed replay stays queued verbatim across repeated flushes", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  const before = await getPendingWrites(U);

  // Still offline: every replay throws. Nothing may be removed, and — the bug —
  // nothing may be re-appended with a fresh id/queuedAt either.
  for (let i = 0; i < 3; i++) {
    const res = await flushPendingWrites(U, async () => {
      throw new Error("still offline");
    });
    assertEq(res, { flushed: 0, remaining: 2 }, `flush ${i + 1} kept both`);
  }

  const after = await getPendingWrites(U);
  assertEq(after.length, 2, "queue did not grow or shrink");
  assertEq(
    after.map((w) => w.id),
    before.map((w) => w.id),
    "same ids — retried, not re-queued as new writes",
  );
  assertEq(
    after.map((w) => w.queuedAt),
    before.map((w) => w.queuedAt),
    "queuedAt untouched, so the age of a stuck write is knowable",
  );

  // Network returns: the same items flush and the queue empties.
  const ok = await flushPendingWrites(U, async () => {});
  assertEq(ok, { flushed: 2, remaining: 0 }, "drains once the server answers");
  assertEq(await pendingWriteCount(U), 0, "queue empty");
});

test("a write queued during a flush survives that flush", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "entry", payload: entry });

  const res = await flushPendingWrites(U, async () => {
    // The user edits the same entry again while the replay is in flight.
    await enqueuePendingWrite(U, {
      kind: "entry",
      payload: { ...entry, text: "edited mid-flush" },
    });
  });
  assertEq(res.flushed, 1, "the replayed revision counted as flushed");
  const left = await getPendingWrites(U);
  assertEq(left.length, 1, "the newer revision is still queued");
  assertTrue(
    left[0].kind === "entry" &&
      left[0].op === "save" &&
      left[0].payload.text === "edited mid-flush",
    "and it is the newer one",
  );
});

test("overlapping flushes share one run (no double replay)", async () => {
  await reset();
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  let calls = 0;
  const exec = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
  };
  const [a, b] = await Promise.all([
    flushPendingWrites(U, exec),
    flushPendingWrites(U, exec),
  ]);
  assertEq(calls, 1, "executor ran once");
  assertEq(a, b, "both callers got the same result");
});

// ---- old on-disk formats ---------------------------------------------------

test("pre-coalescing rows on disk migrate instead of crashing", async () => {
  await reset();
  // Exactly what the shipped v1 queue wrote: no `op`, no `key`.
  store.set(
    "banana_pending_writes_v1:" + U,
    JSON.stringify([
      { id: "old-1", kind: "entry", payload: entry, queuedAt: "2026-06-16T10:00:00.000Z" },
      { id: "old-2", kind: "habits", payload: habits, queuedAt: "2026-06-16T10:01:00.000Z" },
      { id: "old-3", kind: "habitLog", payload: habitLog, queuedAt: "2026-06-16T10:02:00.000Z" },
    ]),
  );

  const q = await getPendingWrites(U);
  assertEq(q.length, 3, "all three old writes survive the upgrade");
  assertEq(
    q.map((w) => w.op),
    ["save", "save", "save"],
    "old rows default to save",
  );
  assertEq(
    q.map((w) => w.key),
    ["entry:e1", "habits", "habitLog:h1:2026-06-16"],
    "keys derived from the payloads",
  );
  assertEq(
    q.map((w) => w.id),
    ["old-1", "old-2", "old-3"],
    "ids and order preserved",
  );
  assertEq(q[0].queuedAt, "2026-06-16T10:00:00.000Z", "original age preserved");

  // A new write to a migrated key coalesces with it rather than duplicating.
  await enqueuePendingWrite(U, { kind: "habitLog", payload: { ...habitLog, completed: false } });
  assertEq(await pendingWriteCount(U), 3, "still three");

  // And they replay normally.
  const res = await flushPendingWrites(U, async () => {});
  assertEq(res, { flushed: 3, remaining: 0 }, "migrated rows flush");
});

test("garbage rows are dropped without taking the queue with them", async () => {
  await reset();
  store.set(
    "banana_pending_writes_v1:" + U,
    JSON.stringify([
      null,
      "nope",
      { id: "x", kind: "entry" }, // no payload
      { id: "y", kind: "wat", payload: { id: "z" } }, // unknown kind
      { id: "z", kind: "habitLog", payload: { habitId: "h1" } }, // payload missing date
      { id: "good", kind: "entry", payload: entry, queuedAt: "2026-06-16T10:00:00.000Z" },
    ]),
  );
  const q = await getPendingWrites(U);
  assertEq(q.length, 1, "only the readable write survives");
  assertEq(q[0].id, "good", "and it's the right one");
});

test("duplicate keys already on disk collapse to the newest", async () => {
  await reset();
  store.set(
    "banana_pending_writes_v1:" + U,
    JSON.stringify([
      { id: "a", kind: "habitLog", payload: habitLog, queuedAt: "2026-06-16T10:00:00.000Z" },
      {
        id: "b",
        kind: "habitLog",
        payload: { ...habitLog, completed: false },
        queuedAt: "2026-06-16T10:05:00.000Z",
      },
    ]),
  );
  const q = await getPendingWrites(U);
  assertEq(q.length, 1, "the old queue's duplicates collapse");
  assertEq(q[0].id, "b", "newest wins");
});

(async () => {
  await run();
})();
