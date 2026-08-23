// Persisting the onboarding draft — the one save site for everything the
// guest flow collected (habit picks, the first entry).
//
// Two screens call this with the live data store: entry.tsx when the user was
// already signed in, and recovery-setup.tsx right after a new account's
// keyring comes up. Both were about to grow their own copy of the same merge
// logic; this is that logic, once.
//
// The store's write actions never throw — they report WriteOutcomes. `queued`
// counts as success here (the write is durable and replays on reconnect);
// only `failed` reports back, and the caller decides whether to hold the user
// or carry on. The draft is cleared by the CALLER, and only on success, so a
// failure never costs the words.

import { todayKey } from "./dates";
import type { DailyEntry, Habit, WriteOutcome } from "./db";
import { loadOnboardingDraft } from "./onboarding-draft";

/** The slice of the data store this helper needs — structural on purpose. */
export interface DraftPersistStore {
  refreshHabits: (opts?: { force?: boolean }) => Promise<Habit[]>;
  saveHabits: (next: Habit[]) => Promise<WriteOutcome>;
  saveEntry: (entry: DailyEntry) => Promise<WriteOutcome>;
}

export interface DraftPersistResult {
  ok: boolean;
  /** User-safe copy from the failing outcome, when `ok` is false. */
  reason?: string;
  /** True when a first entry existed and was written (or queued). */
  entrySaved: boolean;
  /** True when the entry write landed in the durable queue, not the server. */
  queued: boolean;
}

/**
 * Write the drafted habits and first entry through the store. Habits merge
 * against whatever the account already has (an existing account signing in on
 * a new device must not lose its list to a starter selection).
 */
export async function persistOnboardingDraft(
  store: DraftPersistStore,
): Promise<DraftPersistResult> {
  const draft = await loadOnboardingDraft();

  if (draft.habits.length > 0) {
    const existing = await store.refreshHabits();
    const existingNames = new Set(existing.map((h) => h.name.toLowerCase()));
    const createdAt = new Date().toISOString();
    const fresh: Habit[] = draft.habits
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .map((name, index) => ({
        id: `${Date.now()}${index}`,
        name,
        createdAt,
      }));

    if (fresh.length > 0) {
      const outcome = await store.saveHabits([...existing, ...fresh]);
      if (outcome.status === "failed") {
        return {
          ok: false,
          reason: outcome.reason,
          entrySaved: false,
          queued: false,
        };
      }
    }
  }

  const text = draft.highlight.trim();
  if (!text) return { ok: true, entrySaved: false, queued: false };

  const entry: DailyEntry = {
    id: `onboarding-${Date.now()}`,
    date: todayKey(),
    text,
    mediaPaths: [],
    createdAt: new Date().toISOString(),
  };
  const outcome = await store.saveEntry(entry);
  if (outcome.status === "failed") {
    return { ok: false, reason: outcome.reason, entrySaved: false, queued: false };
  }
  return { ok: true, entrySaved: true, queued: outcome.status === "queued" };
}
