// The old front door, kept as a forwarding address.
//
// The welcome screen (onboarding/welcome) is the app's landing now — it works
// with no session and offers Get started, the tour, and Sign in. But a dozen
// code paths still land on "/auth/login" when a session ends (sign out, setup
// abandoned, recovery cancelled), and each of them means "back to the start".
// Forwarding here keeps every one of those call sites working without a sweep,
// and keeps the route valid for anything external that ever linked it.

import { Href, Redirect } from "expo-router";

export default function LoginScreen() {
  return <Redirect href={"/onboarding/welcome" as Href} />;
}
