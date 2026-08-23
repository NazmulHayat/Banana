#!/usr/bin/env bash
#
# Point Auth at a real SMTP provider.
#
# WHY THIS IS NOT OPTIONAL FOR BETA: Supabase's built-in email service sends
# 2 messages per HOUR for the whole project, with no delivery SLA, and is
# documented as non-production. Every auth email shares that budget — password
# resets and signup confirmations both. With a handful of testers, resets start
# vanishing silently.
#
# Custom SMTP also unlocks email TEMPLATE customization, which the Free plan's
# default provider refuses. That is the thing standing between us and the
# 6-digit signup code (see supabase-verify-email-on.sh), so this one change
# clears both problems at once.
#
# Free tiers that work fine here: Resend (3k/month), Brevo (300/day).
# Both want a verified sender domain or address before they will send.
#
# Put the credentials in .env.local (gitignored — they are secrets):
#
#   SMTP_HOST=smtp.resend.com
#   SMTP_PORT=587
#   SMTP_USER=resend
#   SMTP_PASS=re_xxxxxxxxxxxx
#   SMTP_SENDER_EMAIL=hello@yourdomain.com
#   SMTP_SENDER_NAME=Aight Bet
#
# Then:  ./scripts/supabase-smtp.sh
# After it succeeds, run ./scripts/supabase-verify-email-on.sh to turn the
# 6-digit signup code on.

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="exdazabuhunsjznxgcjr"

# shellcheck disable=SC1091
set -a; . ./.env.local; set +a

missing=""
for var in SUPABASE_ACCESS_TOKEN SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_EMAIL; do
  if [ -z "${!var:-}" ]; then missing="$missing $var"; fi
done
if [ -n "$missing" ]; then
  echo "error: missing from .env.local:$missing" >&2
  echo "       see the comment at the top of this script" >&2
  exit 1
fi

SENDER_NAME="${SMTP_SENDER_NAME:-Aight Bet}"

echo "pointing $PROJECT_REF at $SMTP_HOST ..."

python3 - "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASS" \
          "$SMTP_SENDER_EMAIL" "$SENDER_NAME" <<'PYEOF' > /tmp/smtp-payload.json
import json, sys
host, port, user, password, sender, name = sys.argv[1:7]
print(json.dumps({
    "smtp_host": host,
    "smtp_port": port,
    "smtp_user": user,
    "smtp_pass": password,
    "smtp_admin_email": sender,
    "smtp_sender_name": name,
    "external_email_enabled": True,
}))
PYEOF

curl -sS -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @/tmp/smtp-payload.json | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "message" in d:
    print("FAILED:", d["message"]); raise SystemExit(1)
print("  smtp_host:", d.get("smtp_host"))
print("  sender:", d.get("smtp_admin_email"))
print()
print("done. Custom SMTP starts at 30 messages/hour — raise it under")
print("Dashboard -> Authentication -> Rate Limits if beta needs more.")
print()
print("next: ./scripts/supabase-verify-email-on.sh  (turns on the 6-digit code)")
'

# The payload held the SMTP password; do not leave it lying in /tmp.
rm -f /tmp/smtp-payload.json
