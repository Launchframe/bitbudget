#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_SERVICE="${BITBUDGET_DB_SERVICE:-db}"
DB_USER="${BITBUDGET_DB_USER:-postgres}"
DB_NAME="${BITBUDGET_DB_NAME:-bitbudget_dev}"
MAX_ATTEMPTS="${BITBUDGET_DB_WAIT_ATTEMPTS:-60}"

echo "Waiting for Postgres (${DB_SERVICE}/${DB_NAME})..."

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  if docker compose exec -T "$DB_SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "Postgres is ready."
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready within ${MAX_ATTEMPTS}s." >&2
exit 1
