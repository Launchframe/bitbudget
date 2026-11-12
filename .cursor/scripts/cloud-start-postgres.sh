#!/usr/bin/env bash
# Cursor Cloud agent start: ensure local Postgres is up (no prisma migrate).
set -euo pipefail

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "cloud-start-postgres: PostgreSQL not installed; rerun environment build (install script)." >&2
  exit 1
fi

PG_VER=""
for ver in 16 15 14; do
  if [ -d "/etc/postgresql/${ver}" ]; then
    PG_VER="$ver"
    break
  fi
done

if [ -z "$PG_VER" ]; then
  echo "cloud-start-postgres: no PostgreSQL cluster directory under /etc/postgresql" >&2
  exit 1
fi

sudo pg_ctlcluster "$PG_VER" main start

ensure_db() {
  local db="$1"
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
    sudo -u postgres createdb "$db"
  fi
}

ensure_db bitbudget_dev
ensure_db bitbudget_e2e
