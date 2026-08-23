#!/usr/bin/env bash
#
# Turn REAL email verification on for signup (onboarding redesign, 2026-08-23).
#
# Two changes, both Auth config (Management API, like supabase-auth-config.sh):
#
#   mailer_autoconfirm -> false
#     signUp() stops returning an instant session; the client's verify screen
#     (app/auth/verify.tsx) takes over: user types the 6-digit code, verifyOtp
#     creates the session, keyring setup runs after.
#
#   confirmation email template -> shows {{ .Token }} (the 6-digit code)
#     The stock template only carries a confirmation LINK. The app asks for a
#     code, so the email must contain one. Plain text on purpose: it renders
#     everywhere and there is nothing to get wrong.
#
# Safe to re-run (PATCH). Test accounts are unaffected: tests/e2e.test.ts
# creates its users with admin.createUser({ email_confirm: true }).
#
# To roll back (verification off again):
#   patch '{"mailer_autoconfirm": true}'
#
# Usage:  ./scripts/supabase-verify-email-on.sh

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="exdazabuhunsjznxgcjr"

# shellcheck disable=SC1091
set -a; . ./.env.local; set +a

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "error: SUPABASE_ACCESS_TOKEN missing from .env.local" >&2
  exit 1
fi

patch() {
  curl -sS -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -d "$1"
}

echo "turning email verification on for $PROJECT_REF ..."

patch "$(cat <<'JSON'
{
  "mailer_autoconfirm": false,
  "mailer_subjects_confirmation": "Your Aight Bet code: {{ .Token }}",
  "mailer_templates_confirmation_content": "<h2>Almost there</h2><p>Your verification code is:</p><p style=\"font-size:28px;letter-spacing:6px;font-weight:bold\">{{ .Token }}</p><p>Enter it in the app to seal your journal. The code expires in an hour.</p><p>If you didn't create an Aight Bet account, you can ignore this email.</p>"
}
JSON
)" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "message" in d:
    print("FAILED:", d["message"]); raise SystemExit(1)
print("done:")
print("  mailer_autoconfirm:", d.get("mailer_autoconfirm"))
print("  confirmation subject:", d.get("mailer_subjects_confirmation"))
'
