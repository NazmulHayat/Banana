// Calm gamification: journal stats (FR-AN1), records (FR-G2), stamps (FR-G3).
//
// The rule under test everywhere in this file: nothing can ever be lost. A
// stamp survives a broken streak; a record is beaten or tied, never taken.

import "./setup";

import { assertEq, assertTrue, run, suite, test } from "./helpers";
import type { DailyEntry, Habit, HabitLog } from "../lib/db/types";
import { computeJournalStats } from "../lib/journal-stats";
import {
  computeRecords,
  computeStamps,
  earnedStamps,
  nextStamps,
  type PersonalRecord,
  type RecordKey,
  type Stamp,
} from "../lib/gamification";
import { computeHabitStats } from "../lib/stats";

const TODAY = "2026-06-16";

const p2 = (n: number): string => String(n).padStart(2, "0");

function log(habitId: string, date: string, completed = true): HabitLog {
  return { habitId, date, completed };
}

function habit(id: string, createdAt = "2026-01-01"): Habit {
  return { id, name: id, createdAt };
}

function entry(date: string, photos = 0, seq = 0): DailyEntry {
  return {
    id: `${date}-${seq}`,
    date,
    text: "…",
    mediaPaths: Array.from({ length: photos }, (_, i) => `u/${date}/${i}.jpg`),
    createdAt: `${date}T0${seq % 10}:00:00.000Z`,
  };
}

// Completed logs for a habit over an inclusive day range within one month.
function range(
  habitId: string,
  year: number,
  month: number,
  d1: number,
  d2: number,
): HabitLog[] {
  const out: HabitLog[] = [];
  for (let d = d1; d <= d2; d++) out.push(log(habitId, `${year}-${p2(month)}-${p2(d)}`));
  return out;
}

function find(stamps: Stamp[], id: string): Stamp {
  const s = stamps.find((x) => x.id === id);
  if (!s) throw new Error(`no stamp ${id}`);
  return s;
}

function record(records: PersonalRecord[], key: RecordKey): PersonalRecord {
  const r = records.find((x) => x.key === key);
  if (!r) throw new Error(`no record ${key}`);
  return r;
}

// ---------------------------------------------------------------------------
suite("FR-AN1 journal stats");

test("counts entries, days, photos and the busiest months", () => {
  const entries = [
    entry("2026-06-14"),
    entry("2026-06-15", 2),
    entry("2026-06-15", 1, 1), // two entries, one day
    entry("2026-06-16"),
    entry("2026-05-02", 3),
  ];
  const j = computeJournalStats(entries, TODAY);
  assertEq(j.totalEntries, 5);
  assertEq(j.daysJournaled, 4);
  assertEq(j.photos, 6);
  assertEq(j.currentStreak, 3); // 14, 15, 16
  assertEq(j.longestStreak, 3);
  assertEq(j.firstEntryDate, "2026-05-02");
  assertEq(j.mostWrittenMonths[0].key, "2026-06");
  assertEq(j.mostWrittenMonths[0].count, 4);
  assertEq(j.mostWrittenMonths[0].label, "Jun 2026");
});

test("future-dated entries are ignored", () => {
  const j = computeJournalStats([entry(TODAY), entry("2026-06-20", 5)], TODAY);
  assertEq(j.totalEntries, 1);
  assertEq(j.photos, 0);
  assertEq(j.currentStreak, 1);
});

test("empty journal is all zeros, never null-ish", () => {
  const j = computeJournalStats([], TODAY);
  assertEq(j.totalEntries, 0);
  assertEq(j.longestStreak, 0);
  assertEq(j.mostWrittenMonths, []);
  assertEq(j.firstEntryDate, null);
});

// ---------------------------------------------------------------------------
suite("FR-G3 stamps");

test("a 7-day run earns the 7 stamp on the seventh day", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = range("h1", 2026, 6, 1, 7);
  const stamps = computeStamps({ habits, logs, entries: [], today: TODAY });
  const seven = find(stamps, "streak:h1:7");
  assertEq(seven.earned, true);
  assertEq(seven.earnedOn, "2026-06-07");
  assertEq(seven.best, 7);
  assertEq(seven.progress, 1);
});

test("thresholds below the best are earned, those above are not", () => {
  const habits = [habit("h1", "2025-06-01")];
  const logs: HabitLog[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(2026, 4, 18 + i)); // 2026-05-18 .. 2026-06-16
    logs.push(
      log("h1", `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`),
    );
  }
  const stamps = computeStamps({ habits, logs, entries: [], today: TODAY });
  assertEq(find(stamps, "streak:h1:7").earned, true);
  assertEq(find(stamps, "streak:h1:30").earned, true);
  assertEq(find(stamps, "streak:h1:100").earned, false);
  assertEq(find(stamps, "streak:h1:100").progress, 0.3);
  assertEq(find(stamps, "streak:h1:365").earned, false);
});

test("RETENTION: a broken streak never revokes a stamp", () => {
  const habits = [habit("h1", "2026-06-01")];
  // Seven days at the start of June, then nothing for over a week.
  const logs = range("h1", 2026, 6, 1, 7);
  assertEq(computeHabitStats("h1", logs, TODAY).currentStreak, 0); // streak is gone
  const stamps = computeStamps({ habits, logs, entries: [], today: TODAY });
  const seven = find(stamps, "streak:h1:7");
  assertEq(seven.earned, true); // the stamp is not
  assertEq(seven.earnedOn, "2026-06-07"); // and its date never moves
  assertEq(seven.best, 7);
});

test("RETENTION: earning more later can't move an older earn date", () => {
  const habits = [habit("h1", "2026-05-01")];
  const early = range("h1", 2026, 5, 1, 7);
  const withLater = [...early, ...range("h1", 2026, 6, 1, 16)];
  const before = find(
    computeStamps({ habits, logs: early, entries: [], today: TODAY }),
    "streak:h1:7",
  );
  const after = find(
    computeStamps({ habits, logs: withLater, entries: [], today: TODAY }),
    "streak:h1:7",
  );
  assertEq(after.earnedOn, before.earnedOn);
  assertTrue(after.best > before.best); // the best-ever value still grows
});

test("journal stamps: first entry, then ten", () => {
  const one = computeStamps({
    habits: [],
    logs: [],
    entries: [entry("2026-06-10")],
    today: TODAY,
  });
  assertEq(find(one, "journal:1").earned, true);
  assertEq(find(one, "journal:1").earnedOn, "2026-06-10");
  assertEq(find(one, "journal:10").earned, false);
  assertEq(find(one, "journal:10").best, 1);

  const ten = computeStamps({
    habits: [],
    logs: [],
    entries: Array.from({ length: 10 }, (_, i) => entry(`2026-06-${p2(i + 1)}`)),
    today: TODAY,
  });
  assertEq(find(ten, "journal:10").earned, true);
  assertEq(find(ten, "journal:10").earnedOn, "2026-06-10");
});

test("perfect week needs seven perfect days in a row", () => {
  const habits = [habit("h1", "2026-06-01"), habit("h2", "2026-06-01")];
  const six = [...range("h1", 2026, 6, 1, 6), ...range("h2", 2026, 6, 1, 6)];
  assertEq(
    find(computeStamps({ habits, logs: six, entries: [], today: TODAY }), "perfect-week:7")
      .earned,
    false,
  );
  const seven = [...range("h1", 2026, 6, 1, 7), ...range("h2", 2026, 6, 1, 7)];
  const stamp = find(
    computeStamps({ habits, logs: seven, entries: [], today: TODAY }),
    "perfect-week:7",
  );
  assertEq(stamp.earned, true);
  assertEq(stamp.earnedOn, "2026-06-07");
});

test("perfect-week eligibility follows a habit added mid-week", () => {
  // h2 arrives on the 5th: days 1-4 only need h1 and still count as perfect.
  const habits = [habit("h1", "2026-06-01"), habit("h2", "2026-06-05")];
  const logs = [...range("h1", 2026, 6, 1, 7), ...range("h2", 2026, 6, 5, 7)];
  const stamp = find(
    computeStamps({ habits, logs, entries: [], today: TODAY }),
    "perfect-week:7",
  );
  assertEq(stamp.earned, true);
  assertEq(stamp.earnedOn, "2026-06-07");
});

test("50 perfect days: 49 isn't it, 50 is", () => {
  const habits = [habit("h1", "2026-01-01")];
  const days = (n: number): HabitLog[] => {
    const out: HabitLog[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.UTC(2026, 3, 1 + i)); // from 2026-04-01
      out.push(
        log("h1", `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`),
      );
    }
    return out;
  };
  const id = "perfect-days:50";
  assertEq(
    find(computeStamps({ habits, logs: days(49), entries: [], today: TODAY }), id).earned,
    false,
  );
  const fifty = find(
    computeStamps({ habits, logs: days(50), entries: [], today: TODAY }),
    id,
  );
  assertEq(fifty.earned, true);
  assertEq(fifty.earnedOn, "2026-05-20"); // the 50th day from Apr 1
});

test("earned/next helpers sort sensibly and never show empty progress", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = range("h1", 2026, 6, 1, 8);
  const stamps = computeStamps({ habits, logs, entries: [entry("2026-06-02")], today: TODAY });
  const earned = earnedStamps(stamps);
  assertTrue(earned.length >= 2);
  assertTrue(earned.every((s) => s.earned));
  const next = nextStamps(stamps, 3);
  assertTrue(next.every((s) => !s.earned && s.best > 0));
  assertTrue(next.length <= 3);
});

test("a deleted habit takes its stamps with it, and nothing else", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = [...range("h1", 2026, 6, 1, 7), ...range("gone", 2026, 6, 1, 7)];
  const stamps = computeStamps({ habits, logs, entries: [], today: TODAY });
  assertEq(stamps.filter((s) => s.habitId === "gone").length, 0);
  assertEq(find(stamps, "streak:h1:7").earned, true);
});

// ---------------------------------------------------------------------------
suite("FR-G2 records");

test("a live streak at its best reads as tied, not beaten", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = range("h1", 2026, 6, 12, 16); // 5-day run ending today
  const r = record(computeRecords({ habits, logs, entries: [], today: TODAY }), "longestStreak");
  assertEq(r.current, 5);
  assertEq(r.record, 5);
  assertEq(r.atRecord, true);
  assertEq(r.distance, 0);
});

test("a shorter current streak keeps the old record and shows the gap", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = [
    ...range("h1", 2026, 6, 1, 7), // record run of 7
    ...range("h1", 2026, 6, 14, 16), // current run of 3
  ];
  const r = record(computeRecords({ habits, logs, entries: [], today: TODAY }), "longestStreak");
  assertEq(r.current, 3);
  assertEq(r.record, 7);
  assertEq(r.atRecord, false);
  assertEq(r.distance, 4);
});

test("best month: a stronger past month stands until it's beaten", () => {
  const habits = [habit("h1", "2026-05-01")];
  const logs = [
    ...range("h1", 2026, 5, 1, 31), // May: 100%
    ...range("h1", 2026, 6, 1, 8), // June: 8 of 16 -> 50%
  ];
  const r = record(computeRecords({ habits, logs, entries: [], today: TODAY }), "bestMonth");
  assertEq(r.current, 50);
  assertEq(r.record, 100);
  assertEq(r.distance, 50);
  assertEq(r.detail, "May 2026");
  assertEq(r.atRecord, false);
});

test("most habits in one day: today ties the best", () => {
  const habits = [habit("h1"), habit("h2")];
  const logs = [log("h1", TODAY), log("h2", TODAY), log("h1", "2026-06-10")];
  const r = record(
    computeRecords({ habits, logs, entries: [], today: TODAY }),
    "mostHabitsInADay",
  );
  assertEq(r.current, 2);
  assertEq(r.record, 2);
  assertEq(r.atRecord, true);
});

test("journal run and photo month become records too", () => {
  const entries = [
    entry("2026-06-14", 1),
    entry("2026-06-15", 2),
    entry("2026-06-16", 1),
    entry("2026-05-01", 9),
  ];
  const records = computeRecords({ habits: [], logs: [], entries, today: TODAY });
  const runRecord = record(records, "longestJournalRun");
  assertEq(runRecord.current, 3);
  assertEq(runRecord.record, 3);
  assertEq(runRecord.atRecord, true);
  const photos = record(records, "mostPhotosInAMonth");
  assertEq(photos.current, 4);
  assertEq(photos.record, 9);
  assertEq(photos.detail, "May 2026");
});

test("perfect days per month is a record, and future logs can't set it", () => {
  const habits = [habit("h1", "2026-06-01")];
  const logs = [...range("h1", 2026, 6, 1, 5), ...range("h1", 2026, 6, 20, 30)];
  const r = record(
    computeRecords({ habits, logs, entries: [], today: TODAY }),
    "mostPerfectDaysInAMonth",
  );
  assertEq(r.current, 5); // only the five real days
  assertEq(r.record, 5);
});

test("no record is ever lost: record >= current, always", () => {
  const habits = [habit("h1", "2026-05-01"), habit("h2", "2026-05-20")];
  const logs = [
    ...range("h1", 2026, 5, 1, 31),
    ...range("h2", 2026, 5, 20, 31),
    ...range("h1", 2026, 6, 1, 3),
  ];
  const entries = [entry("2026-05-05", 4), entry("2026-06-01")];
  const records = computeRecords({ habits, logs, entries, today: TODAY });
  assertEq(records.length, 6);
  for (const r of records) {
    assertTrue(r.record >= r.current, `${r.key}: record below current`);
    assertEq(r.distance, Math.max(0, r.record - r.current));
  }
});

test("empty data yields six zeroed records, not a crash", () => {
  const records = computeRecords({ habits: [], logs: [], entries: [], today: TODAY });
  assertEq(records.length, 6);
  assertTrue(records.every((r) => r.current === 0 && r.record === 0 && !r.atRecord));
});

(async () => {
  await run();
})();
