// Holds the signup password in memory between the signup form and the
// verification screen so we can derive the encryption keyring AFTER the
// user confirms their email. Cleared after consumption or after 10 minutes.

interface Pending {
  email: string;
  password: string;
  setAt: number;
}

let pending: Pending | null = null;

export const signupTransient = {
  set(data: Omit<Pending, "setAt">): void {
    pending = { ...data, setAt: Date.now() };
  },
  peek(): Pending | null {
    if (!pending) return null;
    // 10-minute timeout
    if (Date.now() - pending.setAt > 10 * 60 * 1000) {
      pending = null;
      return null;
    }
    return pending;
  },
  consume(): Pending | null {
    const x = this.peek();
    pending = null;
    return x;
  },
  clear(): void {
    pending = null;
  },
};
