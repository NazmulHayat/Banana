// App-facing types. DB row types live in the per-table modules.

export interface Habit {
  id: string;
  name: string;
  createdAt: string;
}

export interface DailyEntry {
  id: string;
  date: string;
  text: string;
  /**
   * Storage object paths inside the `private-media` bucket
   * (format: "<user_id>/<entry_id>/<media_id>.<ext>"). Resolved to signed
   * URLs at render time via lib/media/storage.getImageUrl().
   */
  mediaPaths: string[];
  createdAt: string;
}

export interface HabitLog {
  habitId: string;
  date: string;
  completed: boolean;
}

export interface AccountRow {
  id: string;
  username: string;
  created_at: string;
}

// Payloads stored as encrypted JSON in `ciphertext` columns
export interface EntryPayload {
  date: string;
  entries: Array<{
    id: string;
    text: string;
    createdAt: string;
    mediaPaths?: string[];
  }>;
}

export interface HabitPayload {
  id: string;
  name: string;
  createdAt: string;
}

export interface HabitLogPayload {
  habitId: string;
  date: string;
  completed: boolean;
}
