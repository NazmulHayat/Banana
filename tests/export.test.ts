// "Download my journal" formatting.
//
// This file is the last copy of someone's writing if they ever lose their keys,
// so the bar is: nothing silently dropped, and nothing leaked that shouldn't be.

import "./setup";

import type { DailyEntry, Habit, HabitLog } from "../lib/db";
import { buildExport, exportFileName, toJson, toMarkdown } from "../lib/export";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

const AT = new Date("2026-08-20T12:00:00.000Z");

function entry(over: Partial<DailyEntry> = {}): DailyEntry {
  return {
    id: "e1",
    date: "2026-08-20",
    text: "Just sitting at the cafe",
    mediaPaths: [],
    createdAt: "2026-08-20T06:37:00.000Z",
    ...over,
  };
}

const HABITS: Habit[] = [
  { id: "h1", name: "Gym", createdAt: "2026-08-01T00:00:00.000Z" },
  { id: "h2", name: "Prayer", createdAt: "2026-08-01T00:00:00.000Z" },
];

function base(over: Partial<Parameters<typeof toMarkdown>[0]> = {}) {
  return {
    entries: [entry()],
    habits: HABITS,
    logs: [] as HabitLog[],
    username: "nazmul",
    exportedAt: AT,
    ...over,
  };
}

// ============================================================================
suite("markdown");
// ============================================================================
test("keeps the entry text verbatim", () => {
  assertTrue(toMarkdown(base()).includes("Just sitting at the cafe"));
});

test("writes a readable date heading, not a raw day key", () => {
  const md = toMarkdown(base());
  assertTrue(md.includes("Thursday, August 20, 2026"), md.slice(0, 300));
});

test("does not shift the date across a timezone", () => {
  // A day key parsed as UTC would render as the 19th west of Greenwich.
  assertTrue(!toMarkdown(base()).includes("August 19"), "date must not shift");
});

test("includes the place when there is one", () => {
  const withPlace = entry({
    place: {
      heading: "Haneda Airport",
      address: "Ota, Tokyo",
      latitude: 35.549,
      longitude: 139.779,
    },
  });
  assertTrue(toMarkdown(base({ entries: [withPlace] })).includes("Haneda Airport"));
});

test("names completed habits, and only completed ones", () => {
  const logs: HabitLog[] = [
    { habitId: "h1", date: "2026-08-20", completed: true },
    { habitId: "h2", date: "2026-08-20", completed: false },
  ];
  const md = toMarkdown(base({ logs }));
  assertTrue(md.includes("Gym"), "completed habit must appear");
  assertTrue(!md.includes("Prayer"), "an unticked habit is not an achievement");
});

test("a log for a deleted habit is skipped, never dumped as a raw id", () => {
  const logs: HabitLog[] = [
    { habitId: "gone-forever", date: "2026-08-20", completed: true },
  ];
  assertTrue(!toMarkdown(base({ logs })).includes("gone-forever"));
});

test("says where the photos are instead of pretending they're included", () => {
  const withPhotos = entry({ mediaPaths: ["a/b/1.jpg", "a/b/2.jpg"] });
  const md = toMarkdown(base({ entries: [withPhotos] }));
  assertTrue(md.includes("2 photos"), "photo count must be stated");
  assertTrue(md.includes("Photos app"), "must point at where they actually are");
});

test("never leaks a storage path", () => {
  const withPhotos = entry({ mediaPaths: ["27b443c6/e1/9f8e.jpg"] });
  assertTrue(!toMarkdown(base({ entries: [withPhotos] })).includes("9f8e.jpg"));
});

test("an empty journal still produces a valid file, not a crash", () => {
  const md = toMarkdown(base({ entries: [], logs: [] }));
  assertTrue(md.includes("Nothing written yet"));
});

test("days come out in chronological order", () => {
  const md = toMarkdown(
    base({
      entries: [
        entry({ id: "b", date: "2026-08-20" }),
        entry({ id: "a", date: "2026-06-16" }),
      ],
    }),
  );
  // Match the day HEADINGS, not bare dates — the file's own header line says
  // "Exported August 20, 2026", which a loose search hits first.
  const june = md.indexOf("## Tuesday, June 16");
  const august = md.indexOf("## Thursday, August 20");
  assertTrue(june >= 0 && august >= 0, "both day headings must be present");
  assertTrue(june < august, "oldest first");
});

test("a day with only habits still gets a section", () => {
  const logs: HabitLog[] = [
    { habitId: "h1", date: "2026-01-05", completed: true },
  ];
  assertTrue(toMarkdown(base({ entries: [], logs })).includes("January 5, 2026"));
});

// ============================================================================
suite("json");
// ============================================================================
test("is valid JSON and round-trips the entries", () => {
  const parsed = JSON.parse(toJson(base()));
  assertEq(parsed.entries.length, 1);
  assertEq(parsed.entries[0].text, "Just sitting at the cafe");
  assertEq(parsed.formatVersion, 1);
});

test("carries habits and logs so a re-import could rebuild the grid", () => {
  const logs: HabitLog[] = [
    { habitId: "h1", date: "2026-08-20", completed: true },
  ];
  const parsed = JSON.parse(toJson(base({ logs })));
  assertEq(parsed.habits.length, 2);
  assertEq(parsed.habitLogs.length, 1);
});

// ============================================================================
suite("file names");
// ============================================================================
test("are dated and sort chronologically", () => {
  assertEq(exportFileName("markdown", AT), "aight-bet-journal-2026-08-20.md");
  assertEq(exportFileName("json", AT), "aight-bet-journal-2026-08-20.json");
});

test("buildExport picks the format asked for", () => {
  assertTrue(buildExport(base(), "json").startsWith("{"));
  assertTrue(buildExport(base(), "markdown").startsWith("# My journal"));
});

void run();
