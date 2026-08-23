#!/usr/bin/env bash
#
# Apply SQL migration files to the remote project via the Management API.
#
# The repo has no `supabase link` (no CLI login in this workflow), so this
# mirrors scripts/supabase-auth-config.sh: read SUPABASE_ACCESS_TOKEN from
# .env.local and talk to api.supabase.com directly. Pass one or more migration
# files; each is executed as a single query (they all wrap themselves in
# begin/commit already).
#
# Usage:  ./scripts/supabase-db-migrate.sh supabase/migrations/20260823120000_username_optional.sql

set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_REF="exdazabuhunsjznxgcjr"

# shellcheck disable=SC1091
set -a; . ./.env.local; set +a

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "error: SUPABASE_ACCESS_TOKEN missing from .env.local" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <migration.sql> [more.sql ...]" >&2
  exit 1
fi

for file in "$@"; do
  echo "applying $file ..."
  python3 - "$file" <<'PYEOF' > /tmp/migration-payload.json
import json, sys
print(json.dumps({"query": open(sys.argv[1]).read()}))
PYEOF
  curl -sS -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/migration-payload.json
  echo
done

echo "done."
