#!/usr/bin/env bash
# Prints the connection string for the project's database through the Supabase
# pooler (the direct host is IPv6 only and GitHub runners have no IPv6).
# Needs SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD. Prints nothing else.
set -euo pipefail
ref="${SUPABASE_PROJECT_REF:?}"
pw="${SUPABASE_DB_PASSWORD:?}"
enc=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$pw")
for host in "${SUPABASE_POOLER_HOST:-}" aws-0-eu-central-1.pooler.supabase.com aws-1-eu-central-1.pooler.supabase.com; do
  [ -z "$host" ] && continue
  url="postgresql://postgres.${ref}:${enc}@${host}:5432/postgres?sslmode=require"
  if out=$(psql "$url" -Atc 'select 1' 2>&1); then echo "$url"; exit 0; fi
  echo "Host ${host}: $(echo "$out" | head -1)" >&2
done
echo "Could not reach the database. Check SUPABASE_DB_PASSWORD." >&2
exit 1
