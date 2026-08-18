// Calendar day keys — pure, no network, no crypto.
//
// These lock in bug D1: a user-facing day key is the user's LOCAL calendar
// date, never the UTC one. The zone-sensitive cases below (23:59 / 00:01 local,
// DST transitions, year boundaries) are exactly the windows where the old
// `toISOString().split("T")[0]` disagreed with the habit grid's local keys.

import "./setup";

import {
  daysInMonth,
  fromDayKey,
  isFutureDay,
  monthKeyOf,
  monthKeyOfParts,
  parseDayKey,
  toDayKey,
  todayKey,
} from "../lib/dates";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

// --- harness ---------------------------------------------------------------

/** Run `fn` with the process timezone pinned, then restore it. */
function withTZ(tz: string, fn: () => void): void {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Run `fn` with `new Date()` / `Date.now()` frozen at an absolute instant. */
function atInstant(utcInstant: string, fn: () => void): void {
  const RealDate = Date;
  const fixed = new RealDate(utcInstant).getTime();
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return Reflect.construct(target, args.length === 0 ? [fixed] : args);
    },
    get(target, prop, receiver) {
      if (prop === "now") return () => fixed;
      return Reflect.get(target, prop, receiver);
    },
  });
  try {
    fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/**
 * Independent oracle for "what does the local wall calendar say?" — the en-CA
 * locale formats as YYYY-MM-DD, so it never touches our own implementation.
 */
function localCalendarDate(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

const TOKYO = "Asia/Tokyo"; // UTC+9, no DST
const UTC = "UTC";
const LA = "America/Los_Angeles"; // UTC-8 / -7 with DST

// --- todayKey --------------------------------------------------------------

suite("dates: todayKey is the local calendar date");

for (const tz of [TOKYO, UTC, LA]) {
  test(`todayKey matches the local wall calendar in ${tz}`, () => {
    withTZ(tz, () => {
      assertEq(todayKey(), localCalendarDate(new Date()), tz);
      assertEq(todayKey(), toDayKey(new Date()), `${tz} todayKey/toDayKey`);
    });
  });
}

test("todayKey at 23:59 and 00:01 local is the same day (Los Angeles)", () => {
  withTZ(LA, () => {
    // 2026-03-04 00:01 PST and 2026-03-04 23:59 PST — one local day, two
    // different UTC days. The old UTC key returned 2026-03-05 for the latter.
    atInstant("2026-03-04T08:01:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "00:01 local");
    });
    atInstant("2026-03-05T07:59:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "23:59 local");
      // Proof this is the bug D1 window: UTC would have said the 5th.
      assertEq(new Date().toISOString().slice(0, 10), "2026-03-05", "utc drift");
    });
  });
});

test("todayKey at 23:59 and 00:01 local is the same day (Tokyo)", () => {
  withTZ(TOKYO, () => {
    // 2026-03-04 00:01 JST is still 2026-03-03 in UTC — drift the other way.
    atInstant("2026-03-03T15:01:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "00:01 local");
      assertEq(new Date().toISOString().slice(0, 10), "2026-03-03", "utc drift");
    });
    atInstant("2026-03-04T14:59:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "23:59 local");
    });
  });
});

test("todayKey at 23:59 and 00:01 in UTC matches the UTC date", () => {
  withTZ(UTC, () => {
    atInstant("2026-03-04T00:01:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "00:01");
    });
    atInstant("2026-03-04T23:59:00Z", () => {
      assertEq(todayKey(), "2026-03-04", "23:59");
    });
  });
});

test("the key never changes across a full local day (Los Angeles)", () => {
  withTZ(LA, () => {
    for (let hour = 0; hour < 24; hour++) {
      const local = new Date(2026, 6, 15, hour, 30);
      assertEq(toDayKey(local), "2026-07-15", `hour ${hour}`);
    }
  });
});

// --- DST -------------------------------------------------------------------

suite("dates: DST transitions (America/Los_Angeles)");

test("spring forward 2026-03-08 keeps one stable day key", () => {
  withTZ(LA, () => {
    // 01:59 PST and 03:01 PDT — the 2am hour never exists locally.
    assertEq(toDayKey(new Date("2026-03-08T09:59:00Z")), "2026-03-08", "before");
    assertEq(toDayKey(new Date("2026-03-08T10:01:00Z")), "2026-03-08", "after");
    // Local midnight of a spring-forward day still round-trips.
    assertEq(toDayKey(fromDayKey("2026-03-08")), "2026-03-08", "round trip");
    assertEq(toDayKey(new Date("2026-03-09T06:59:00Z")), "2026-03-08", "23:59");
    assertEq(toDayKey(new Date("2026-03-09T07:01:00Z")), "2026-03-09", "next day");
  });
});

test("fall back 2026-11-01 keeps one stable day key", () => {
  withTZ(LA, () => {
    // 00:59 PDT and 01:01 PST — the 1am hour happens twice locally.
    assertEq(toDayKey(new Date("2026-11-01T07:59:00Z")), "2026-11-01", "before");
    assertEq(toDayKey(new Date("2026-11-01T09:01:00Z")), "2026-11-01", "after");
    assertEq(toDayKey(fromDayKey("2026-11-01")), "2026-11-01", "round trip");
    assertEq(toDayKey(new Date("2026-11-02T07:59:00Z")), "2026-11-01", "23:59");
  });
});

// --- leap day, month and year boundaries -----------------------------------

suite("dates: boundaries");

test("leap day 2028-02-29 round-trips and pads correctly", () => {
  for (const tz of [TOKYO, UTC, LA]) {
    withTZ(tz, () => {
      assertEq(toDayKey(new Date(2028, 1, 29)), "2028-02-29", tz);
      assertEq(toDayKey(fromDayKey("2028-02-29")), "2028-02-29", `${tz} rt`);
      assertEq(daysInMonth(2028, 2), 29, `${tz} leap`);
      assertEq(daysInMonth(2027, 2), 28, `${tz} non-leap`);
      assertEq(daysInMonth(2100, 2), 28, `${tz} century non-leap`);
      assertEq(daysInMonth(2000, 2), 29, `${tz} century leap`);
    });
  }
});

test("month boundaries roll over in local time", () => {
  withTZ(LA, () => {
    assertEq(toDayKey(new Date(2026, 0, 31)), "2026-01-31", "jan 31");
    // Day 32 of January normalises to Feb 1 — the local rollover.
    assertEq(toDayKey(new Date(2026, 0, 32)), "2026-02-01", "feb 1");
    // 2026-01-31 23:00 PST is already 2026-02-01 in UTC.
    assertEq(toDayKey(new Date("2026-02-01T07:00:00Z")), "2026-01-31", "no drift");
    assertEq(monthKeyOf(new Date("2026-02-01T07:00:00Z")), "2026-01", "month");
  });
});

test("year boundaries roll over in local time", () => {
  withTZ(LA, () => {
    // 2026-12-31 20:00 PST — UTC already says 2027.
    assertEq(toDayKey(new Date("2027-01-01T04:00:00Z")), "2026-12-31", "la day");
    assertEq(monthKeyOf(new Date("2027-01-01T04:00:00Z")), "2026-12", "la month");
  });
  withTZ(TOKYO, () => {
    // 2027-01-01 00:30 JST — UTC still says 2026.
    assertEq(toDayKey(new Date("2026-12-31T15:30:00Z")), "2027-01-01", "jp day");
    assertEq(monthKeyOf(new Date("2026-12-31T15:30:00Z")), "2027-01", "jp month");
  });
});

test("single-digit months and days are zero-padded", () => {
  withTZ(UTC, () => {
    assertEq(toDayKey(new Date(2026, 0, 1)), "2026-01-01", "jan 1");
    assertEq(toDayKey(new Date(2026, 8, 7)), "2026-09-07", "sep 7");
    assertEq(monthKeyOf(new Date(2026, 4, 9)), "2026-05", "may");
    assertEq(monthKeyOfParts(2026, 5), "2026-05", "parts padded");
    assertEq(monthKeyOfParts(2026, 12), "2026-12", "parts wide");
  });
});

// --- round trips -----------------------------------------------------------

suite("dates: fromDayKey / toDayKey round trip");

const ROUND_TRIP_KEYS = [
  "2026-01-01",
  "2026-01-31",
  "2026-02-28",
  "2026-03-08", // DST spring forward (LA)
  "2026-03-09",
  "2026-06-30",
  "2026-11-01", // DST fall back (LA)
  "2026-12-31",
  "2027-01-01",
  "2028-02-29", // leap day
  "2028-03-01",
];

for (const tz of [TOKYO, UTC, LA]) {
  test(`round trips in ${tz}`, () => {
    withTZ(tz, () => {
      for (const key of ROUND_TRIP_KEYS) {
        assertEq(toDayKey(fromDayKey(key)), key, `${tz} ${key}`);
      }
    });
  });
}

test("every day of a DST year round-trips (Los Angeles)", () => {
  withTZ(LA, () => {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= daysInMonth(2026, month); day++) {
        const key = `${2026}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        assertEq(toDayKey(fromDayKey(key)), key, key);
      }
    }
  });
});

test("fromDayKey returns local midnight (or the DST-shifted start of day)", () => {
  withTZ(LA, () => {
    const d = fromDayKey("2026-07-15");
    assertEq(d.getFullYear(), 2026, "year");
    assertEq(d.getMonth(), 6, "month index");
    assertEq(d.getDate(), 15, "day");
    assertEq(d.getHours(), 0, "hour");
    assertEq(d.getMinutes(), 0, "minute");
  });
});

// --- parsing + predicates --------------------------------------------------

suite("dates: parsing and predicates");

test("parseDayKey accepts strict keys and rejects everything else", () => {
  assertEq(parseDayKey("2026-09-07"), { year: 2026, month: 9, day: 7 }, "valid");
  assertEq(parseDayKey("2026-9-7"), null, "unpadded");
  assertEq(parseDayKey("2026-09"), null, "month key");
  assertEq(parseDayKey("2026-09-07T00:00:00Z"), null, "timestamp");
  assertEq(parseDayKey(""), null, "empty");
  assertEq(parseDayKey("not-a-date"), null, "garbage");
});

test("fromDayKey degrades to an Invalid Date, never a throw", () => {
  assertTrue(Number.isNaN(fromDayKey("garbage").getTime()), "garbage");
  assertTrue(Number.isNaN(fromDayKey("").getTime()), "empty");
});

test("isFutureDay compares calendar order", () => {
  assertEq(isFutureDay("2026-03-05", "2026-03-04"), true, "tomorrow");
  assertEq(isFutureDay("2026-03-04", "2026-03-04"), false, "same day");
  assertEq(isFutureDay("2026-03-03", "2026-03-04"), false, "yesterday");
  assertEq(isFutureDay("2027-01-01", "2026-12-31"), true, "next year");
  assertEq(isFutureDay("2026-09-07", "2026-10-01"), false, "padding safe");
});

test("isFutureDay defaults to the local today", () => {
  withTZ(LA, () => {
    atInstant("2026-03-05T07:59:00Z", () => {
      // 23:59 local on the 4th: the 5th is still the future here, even though
      // UTC has already rolled over.
      assertEq(isFutureDay("2026-03-05"), true, "utc-rolled day is future");
      assertEq(isFutureDay("2026-03-04"), false, "today");
    });
  });
});

test("daysInMonth covers every month", () => {
  withTZ(LA, () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let month = 1; month <= 12; month++) {
      assertEq(daysInMonth(2026, month), lengths[month - 1], `month ${month}`);
    }
  });
});

(async () => {
  await run();
})();
