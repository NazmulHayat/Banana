// "Download my journal" — the pressure valve for the one unrecoverable failure
// in the whole system.
//
// Everything is encrypted with a key only the user holds. Lose the password AND
// the recovery key and the ciphertext in Supabase becomes permanent noise:
// readable by nobody, us included. A plain file sitting in their Files app is
// the only thing that survives that, and the only honest answer to "can I
// leave?".
//
// Two formats on purpose:
//   markdown — for a person. Opens anywhere, readable in fifty years.
//   json     — for a machine. Lossless, re-importable if we ever build import.
//
// Photos are NOT included. They are outside the zero-knowledge promise, they'd
// turn a 200 KB text file into a multi-hundred-megabyte archive, and the
// originals are already in the user's own Photos library.

import type { DailyEntry, Habit, HabitLog } from "./db";

export type ExportFormat = "markdown" | "json";

export interface JournalExport {
  entries: DailyEntry[];
  habits: Habit[];
  logs: HabitLog[];
  /** Who it belongs to — helps when a file is found years later. */
  username: string | null;
  exportedAt: Date;
}

/** `2026-08-20` — filenames sort chronologically this way. */
function fileDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function exportFileName(format: ExportFormat, at: Date): string {
  return `aight-bet-journal-${fileDate(at)}.${format === "json" ? "json" : "md"}`;
}

function longDate(dayKey: string): string {
  // Day keys are local-time `YYYY-MM-DD`; parse the parts rather than letting
  // Date treat the string as UTC and shift it a day.
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * A journal a human can actually read: one section per day, entries in the
 * order they were written, habits ticked underneath.
 */
export function toMarkdown(data: JournalExport): string {
  const { entries, habits, logs, username, exportedAt } = data;
  const habitName = new Map(habits.map((h) => [h.id, h.name] as const));

  const byDay = new Map<string, DailyEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.date);
    if (list) list.push(entry);
    else byDay.set(entry.date, [entry]);
  }

  const doneByDay = new Map<string, string[]>();
  for (const log of logs) {
    if (!log.completed) continue;
    // A habit deleted since is skipped rather than exported as a raw id.
    const name = habitName.get(log.habitId);
    if (!name) continue;
    const list = doneByDay.get(log.date);
    if (list) list.push(name);
    else doneByDay.set(log.date, [name]);
  }

  const days = [...new Set([...byDay.keys(), ...doneByDay.keys()])].sort();

  const out: string[] = [
    "# My journal",
    "",
    username ? `**${username}**  ` : "",
    `Exported ${exportedAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })} from Aight Bet.`,
    "",
    `${entries.length} ${entries.length === 1 ? "entry" : "entries"} across ${
      days.length
    } ${days.length === 1 ? "day" : "days"}.`,
    "",
    "---",
    "",
  ];

  for (const day of days) {
    out.push(`## ${longDate(day)}`, "");

    for (const entry of byDay.get(day) ?? []) {
      const time = entry.createdAt ? clockTime(entry.createdAt) : "";
      const place = entry.place ? ` · ${entry.place.heading}` : "";
      if (time || place) out.push(`**${time}${place}**`, "");
      if (entry.text.trim()) out.push(entry.text.trim(), "");
      const count = entry.mediaPaths?.length ?? 0;
      if (count > 0) {
        out.push(
          `*${count} photo${count === 1 ? "" : "s"} — in your Photos app, not in this file.*`,
          "",
        );
      }
    }

    const done = doneByDay.get(day);
    if (done && done.length > 0) {
      out.push(`**Habits:** ${done.join(", ")}`, "");
    }
  }

  if (days.length === 0) out.push("*Nothing written yet.*", "");
  return out.join("\n");
}

/** Lossless, and the format an importer would read if we ever build one. */
export function toJson(data: JournalExport): string {
  return JSON.stringify(
    {
      app: "Aight Bet",
      formatVersion: 1,
      exportedAt: data.exportedAt.toISOString(),
      username: data.username,
      note: "Photos are not included — they live in your device's photo library.",
      habits: data.habits,
      entries: data.entries,
      habitLogs: data.logs,
    },
    null,
    2,
  );
}

export function buildExport(
  data: JournalExport,
  format: ExportFormat,
): string {
  return format === "json" ? toJson(data) : toMarkdown(data);
}
