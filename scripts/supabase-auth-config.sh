#!/usr/bin/env bash
#
# Apply the Auth settings that can't live in a migration.
#
# Everything in `supabase/migrations/` covers schema, RLS and grants. Auth
# config (password rules, redirect URLs, email behaviour) lives in the project
# settings instead, reachable only through the Management API — so it gets a
# script rather than SQL, and this file is the record of what we set and why.
#
# Reads SUPABASE_ACCESS_TOKEN from .env.local. Safe to re-run; it PATCHes, so
# unmentioned settings are left alone. Prints the resulting config.
#
# Usage:  ./scripts/supabase-auth-config.sh

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="exdazabuhunsjznxgcjr"

# shellcheck disable=SC1091
set -a; . ./.env.local; set +a

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "error: SUPABASE_ACCESS_TOKEN missing from .env.local" >&2
  echo "       create one at https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# The Expo Go reset-password link resolves to exp://<lan-ip>:8081, so the
# allow-list needs whichever address this machine is on right now. Specific
# entries, never a wildcard — a loose redirect allow-list is an open-redirect
# hole, and these URLs carry live recovery tokens.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"

ALLOW_LIST="aightbet://auth/reset-password,exp://127.0.0.1:8081/--/auth/reset-password"
if [ -n "$LAN_IP" ]; then
  ALLOW_LIST="$ALLOW_LIST,exp://$LAN_IP:8081/--/auth/reset-password"
  echo "including this machine's LAN address: $LAN_IP"
else
  echo "warning: could not detect a LAN IP; Expo Go reset links won't resolve" >&2
fi

patch() {
  curl -sS -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -d "$1"
}

# password_min_length 8  — matches every client screen (app/auth/signup.tsx,
#   app/auth/recover-with-key.tsx, app/security/index.tsx). The master key is
#   scrypt-derived from this password, so the server must not be laxer than
#   the UI.
# site_url               — was the http://localhost:3000 default; this is a
#   mobile app, so the fallback redirect should be the app's own scheme.
#
# Deliberately NOT set here: mailer_autoconfirm. Turning email verification on
# is a launch gate, not a hardening step — flip it as the last pre-ship change,
# once throwaway test accounts no longer need to sign up instantly.
echo "patching auth config for $PROJECT_REF ..."

patch "$(cat <<JSON
{
  "password_min_length": 8,
  "site_url": "aightbet://",
  "uri_allow_list": "$ALLOW_LIST"
}
JSON
)" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "message" in d:
    print("FAILED:", d["message"]); raise SystemExit(1)
print("\nresulting config:")
for k in ("site_url", "uri_allow_list", "password_min_length",
          "mailer_autoconfirm"):
    print(f"  {k}: {d.get(k)}")
'

# Leaked-password protection (HaveIBeenPwned) is a Pro-plan feature. Attempt it
# separately so a Free project still gets everything above, and report rather
# than fail — this is the one hardening item the plan, not the code, gates.
echo
echo "attempting leaked-password protection (Pro plan only) ..."
patch '{"password_hibp_enabled": true}' | python3 -c '
import json, sys
d = json.load(sys.stdin)
msg = d.get("message", "")
if "Pro Plan" in msg or "available on" in msg:
    print("  skipped: needs a Pro plan. Still OFF — revisit if you upgrade.")
elif msg:
    print("  FAILED:", msg)
else:
    print("  enabled:", d.get("password_hibp_enabled"))
'

echo
echo "mailer_autoconfirm is still true — email verification stays off by design"
echo "until launch. See the comment in this script."
