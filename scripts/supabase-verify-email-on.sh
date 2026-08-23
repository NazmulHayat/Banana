#!/usr/bin/env bash
#
# Turn REAL email verification on for signup (onboarding redesign, 2026-08-23).
#
# Two changes, both Auth config (Management API, like supabase-auth-config.sh),
# and the ORDER is load-bearing:
#
#   1. confirmation email template -> shows {{ .Token }} (the 6-digit code)
#      The stock template only carries a confirmation LINK, no code. The app
#      asks for a code, so the email must contain one.
#
#   2. mailer_autoconfirm -> false, ONLY IF step 1 succeeded
#      Flipping autoconfirm without the template would strand every new user:
#      a link-only email on one side, a code screen on the other. So a failed
#      template patch leaves autoconfirm ON (and this script forces it back on
#      if it ever finds it half-flipped), and signup keeps working instantly.
#
# KNOWN LIMIT (hit 2026-08-23): template customization is refused on the Free
# plan with the default email provider. The ways through:
#   a. configure a custom SMTP provider (Resend/Brevo have free tiers) in
#      Dashboard -> Project Settings -> Auth -> SMTP, then re-run this script;
#   b. or upgrade the plan, then re-run.
# Until one of those happens this script is a safe no-op that reports status.
#
# Test accounts are unaffected either way: tests/e2e.test.ts creates its users
# with admin.createUser({ email_confirm: true }).
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

get_config() {
  curl -sS "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
}

patch() {
  curl -sS -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" -d "$1"
}

echo "current state:"
get_config | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("  mailer_autoconfirm:", d.get("mailer_autoconfirm"))
print("  smtp_host:", d.get("smtp_host") or "(default provider)")
'

echo
echo "step 1: confirmation template with the 6-digit code ..."
TEMPLATE_OK="$(patch "$(cat <<'JSON'
{
  "mailer_subjects_confirmation": "Your Aight Bet code: {{ .Token }}",
  "mailer_templates_confirmation_content": "<h2>Almost there</h2><p>Your verification code is:</p><p style=\"font-size:28px;letter-spacing:6px;font-weight:bold\">{{ .Token }}</p><p>Enter it in the app to seal your journal. The code expires in an hour.</p><p>If you didn't create an Aight Bet account, you can ignore this email.</p>"
}
JSON
)" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "message" in d:
    print("no")
    print("  FAILED:", d["message"], file=sys.stderr)
else:
    print("yes")
')"

if [ "$TEMPLATE_OK" = "yes" ]; then
  echo "  template set."
  echo
  echo "step 2: turning autoconfirm off ..."
  patch '{"mailer_autoconfirm": false}' | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "message" in d:
    print("  FAILED:", d["message"]); raise SystemExit(1)
print("  mailer_autoconfirm:", d.get("mailer_autoconfirm"))
print()
print("done: email verification is ON. New signups get a 6-digit code.")
'
else
  echo
  echo "step 2: SKIPPED. Making sure autoconfirm is still on ..."
  patch '{"mailer_autoconfirm": true}' | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("  mailer_autoconfirm:", d.get("mailer_autoconfirm"))
print()
print("verification stays OFF (signup still works, instantly, no code email).")
print("to enable it: add a custom SMTP provider (free: Resend, Brevo) under")
print("Dashboard -> Project Settings -> Auth -> SMTP, then re-run this script.")
'
fi
