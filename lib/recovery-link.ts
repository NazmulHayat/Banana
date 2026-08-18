// Hand-off slot for a password-recovery deep link.
//
// The reset screen can catch a link two ways on its own: `getInitialURL()`
// (cold start — the common case, tapping the email from a closed app) and its
// own `url` listener (a link arriving while it is already open). Neither
// covers the warm start: the app is running on some other screen when the
// link arrives. The root layout listens globally for that case, parks the URL
// here, and routes to the reset screen, which drains it on mount.
//
// A module-level slot rather than a route param on purpose: recovery tokens
// are live credentials, and a param would put them in navigation state and
// any router logging. Nothing here is ever logged.

let pending: string | null = null;

/** True if the URL carries recovery credentials or a Supabase refusal. */
export function isRecoveryLink(url: string): boolean {
  return (
    url.includes("access_token=") ||
    url.includes("code=") ||
    url.includes("error_code=") ||
    url.includes("type=recovery") ||
    url.includes("reset-password")
  );
}

/** Park a link for the reset screen to pick up when it mounts. */
export function stashRecoveryLink(url: string): void {
  pending = url;
}

/** Take the parked link, if any. Single-use — clears as it returns. */
export function takeRecoveryLink(): string | null {
  const url = pending;
  pending = null;
  return url;
}
