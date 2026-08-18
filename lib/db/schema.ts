import { monthKeyOf, monthKeyOfParts, toDayKey } from "../dates";

export const UsernameRules = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 20,
  PATTERN: /^[a-z0-9_]{3,20}$/,
  validate(username: string): { valid: boolean; error?: string } {
    const normalized = username.toLowerCase();
    if (normalized.length < this.MIN_LENGTH) {
      return {
        valid: false,
        error: `Username must be at least ${this.MIN_LENGTH} characters`,
      };
    }
    if (normalized.length > this.MAX_LENGTH) {
      return {
        valid: false,
        error: `Username must be at most ${this.MAX_LENGTH} characters`,
      };
    }
    if (!this.PATTERN.test(normalized)) {
      return {
        valid: false,
        error: "Username can only contain letters, numbers, and underscores",
      };
    }
    return { valid: true };
  },
} as const;

export const HabitLimits = {
  MAX_NAME_LENGTH: 20,
} as const;

// Calendar keys are LOCAL, always — these delegate to lib/dates.ts, the single
// sanctioned source. They used to build keys from `toISOString()` (UTC), which
// disagreed with the habit grid's local keys for part of every day (bug D1).
// Prefer importing from "@/lib/dates" directly in new code.
export const DateFormats = {
  formatDate(date: Date): string {
    return toDayKey(date);
  },
  formatMonth(date: Date): string {
    return monthKeyOf(date);
  },
  formatYearMonth(year: number, month: number): string {
    return monthKeyOfParts(year, month);
  },
} as const;
