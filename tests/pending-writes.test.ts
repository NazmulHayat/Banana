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
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
  await enqueuePendingWrite(U, { kind: "habitLog", payload: habitLog });
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

(async () => {
  await run();
})();
