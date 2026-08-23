// Email sanity checks — all on-device, no network, no third party.
//
// There is exactly one way to prove an address is real: send mail to it and
// have someone act on it. Everything here is heuristics ahead of that, and the
// point is NOT to police fake accounts. This app is zero-knowledge: a bogus
// email costs us nothing and costs the USER their only password-reset channel
// (the recovery key is the other, and they may well lose that too). So the job
// is to stop someone locking themselves out with a typo.
//
// Which is why the strongest signal here is `suggestion`, not `disposable`:
// "did you mean gmail.com?" saves accounts, and refusing throwaway domains
// mostly annoys the privacy-minded people this app is built for. Callers block
// on `valid: false` and merely WARN on everything else.
//
// Deliberately not done: MX/DNS lookups or an address-verification API. Both
// mean handing every user's email to a third party, which is not a trade this
// product gets to make for a heuristic.

/** Local part, then domain with at least one dot and a 2+ letter final label. */
const SHAPE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Domains people actually mistype. Kept short on purpose: every entry is a
 * chance to "correct" someone's real, valid address, so this is the top of the
 * distribution and nothing else.
 */
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "fastmail.com",
  "hey.com",
  "yandex.com",
] as const;

/**
 * Throwaway inbox providers. Not blocked, only flagged — see the header. The
 * list is illustrative rather than exhaustive (there are thousands); it covers
 * the handful someone reaches for without thinking.
 */
const DISPOSABLE_DOMAINS = new Set([
  "10minutemail.com",
  "dispostable.com",
  "discard.email",
  "emailondeck.com",
  "fakeinbox.com",
  "getnada.com",
  "guerrillamail.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailnesia.com",
  "moakt.com",
  "sharklasers.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "trashmail.com",
  "yopmail.com",
]);

/**
 * Local parts that are outbound-only by convention — mail sent there bounces
 * or vanishes, so a reset link would never arrive.
 */
const UNDELIVERABLE_LOCALS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "mailer-daemon",
]);

export type EmailProblem =
  /** Structurally not an address. The only state callers should block on. */
  | "invalid"
  /** Looks like a near-miss of a common domain; `suggestion` holds the fix. */
  | "typo"
  /** A throwaway inbox. Fine by us, risky for them. */
  | "disposable"
  /** An address that by convention cannot receive mail. */
  | "undeliverable";

export interface EmailCheck {
  /** False only for structural nonsense — never for a warning. */
  valid: boolean;
  problem?: EmailProblem;
  /** The corrected address to offer as a one-tap fix, for `typo` only. */
  suggestion?: string;
  /** User-facing copy. Calm, never accusatory. */
  message?: string;
}

/** Trim + lowercase. Addresses are compared and stored in this form. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Levenshtein distance, capped work — the strings here are domain names. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  // One row of the matrix, rolled forward.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // insert
        previous[j] + 1, // delete
        previous[j - 1] + cost, // substitute
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Short domains are never suggested against. Every real short domain sits one
 * edit from a common one (`hey.co` from `hey.com`, `gmx.net` from `gmx.com`,
 * `aol.de` from `aol.com`), so below this length the matcher does more harm
 * than good. Eight keeps the catches that matter — `gmai.com`, `yaho.com` —
 * and drops the whole false-positive class.
 */
const MIN_DOMAIN_FOR_SUGGESTION = 8;

/**
 * The closest common domain within one or two edits, or null.
 *
 * Two edits only for longer candidates: at 9+ characters a two-character slip
 * is still obviously a slip, while at 8 or fewer it starts "correcting"
 * domains that simply are not on the list.
 */
function closestDomain(domain: string): string | null {
  if (domain.length < MIN_DOMAIN_FOR_SUGGESTION) return null;
  if (COMMON_DOMAINS.includes(domain as (typeof COMMON_DOMAINS)[number])) {
    return null;
  }
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    const limit = candidate.length >= 9 ? 2 : 1;
    if (distance <= limit && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Check an address without sending anything to it.
 *
 * `valid: false` means "this cannot be an email"; a `problem` with
 * `valid: true` is a warning the UI should show while still letting the user
 * continue — they may well know something we don't.
 */
export function checkEmail(input: string): EmailCheck {
  const email = normalizeEmail(input);

  if (!SHAPE.test(email)) {
    return {
      valid: false,
      problem: "invalid",
      message: "That doesn't look like an email address.",
    };
  }

  const atIndex = email.lastIndexOf("@");
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  // Consecutive dots, or a dot against the @ or the end, are invalid in the
  // parts of the spec anyone actually uses.
  if (
    email.includes("..") ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    domain.startsWith(".") ||
    domain.startsWith("-") ||
    domain.endsWith("-")
  ) {
    return {
      valid: false,
      problem: "invalid",
      message: "That doesn't look like an email address.",
    };
  }

  if (UNDELIVERABLE_LOCALS.has(local)) {
    return {
      valid: true,
      problem: "undeliverable",
      message:
        "That kind of address can't receive mail, so a password reset would never reach you.",
    };
  }

  const suggestion = closestDomain(domain);
  if (suggestion) {
    return {
      valid: true,
      problem: "typo",
      suggestion: `${local}@${suggestion}`,
      message: `Did you mean ${local}@${suggestion}?`,
    };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      valid: true,
      problem: "disposable",
      message:
        "Temporary inboxes expire. If you lose your password, this is where the reset would go.",
    };
  }

  return { valid: true };
}

/** Shorthand for the places that only care whether it's shaped like an email. */
export function isEmailShaped(input: string): boolean {
  return checkEmail(input).valid;
}
