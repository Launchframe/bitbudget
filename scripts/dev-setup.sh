#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NATIVE_DB_NAME="${BITBUDGET_DB_NAME:-bitbudget_dev}"
NATIVE_DB_USER="${BITBUDGET_DB_USER:-$(whoami)}"
NATIVE_DB_HOST="${BITBUDGET_DB_HOST:-127.0.0.1}"
NATIVE_DB_PORT="${BITBUDGET_DB_PORT:-5432}"

postgres_app_bin="/Applications/Postgres.app/Contents/Versions/latest/bin"
if [[ -d "$postgres_app_bin" ]]; then
  export PATH="$postgres_app_bin:$PATH"
fi

find_psql() {
  if command -v psql >/dev/null 2>&1; then
    command -v psql
    return 0
  fi
  return 1
}

wait_for_native_postgres() {
  local psql_bin="$1"
  echo "Waiting for native Postgres at ${NATIVE_DB_HOST}:${NATIVE_DB_PORT}..."
  for _ in $(seq 1 60); do
    if "$psql_bin" -h "$NATIVE_DB_HOST" -p "$NATIVE_DB_PORT" -U "$NATIVE_DB_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
      echo "Native Postgres is ready."
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_native_database() {
  local psql_bin="$1"
  if "$psql_bin" -h "$NATIVE_DB_HOST" -p "$NATIVE_DB_PORT" -U "$NATIVE_DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${NATIVE_DB_NAME}'" | grep -q 1; then
    echo "Database ${NATIVE_DB_NAME} already exists."
    return 0
  fi
  echo "Creating database ${NATIVE_DB_NAME}..."
  "$psql_bin" -h "$NATIVE_DB_HOST" -p "$NATIVE_DB_PORT" -U "$NATIVE_DB_USER" -d postgres -c \
    "CREATE DATABASE \"${NATIVE_DB_NAME}\";"
}

write_env_local() {
  local db_url="postgresql://${NATIVE_DB_USER}@${NATIVE_DB_HOST}:${NATIVE_DB_PORT}/${NATIVE_DB_NAME}"
  cp .env.example .env.local
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -base64 32)"
    if [[ "$OSTYPE" == darwin* ]]; then
      sed -i '' "s|AUTH_SECRET=\"your-secret-here-at-least-32-characters\"|AUTH_SECRET=\"${SECRET}\"|" .env.local
      sed -i '' "s|DATABASE_URL=\"postgresql://user:password@host:5432/dbname?sslmode=require\"|DATABASE_URL=\"${db_url}\"|" .env.local
      sed -i '' "s|DATABASE_URL_UNPOOLED=\"postgresql://user:password@host:5432/dbname?sslmode=require\"|DATABASE_URL_UNPOOLED=\"${db_url}\"|" .env.local
    else
      sed -i "s|AUTH_SECRET=\"your-secret-here-at-least-32-characters\"|AUTH_SECRET=\"${SECRET}\"|" .env.local
      sed -i "s|DATABASE_URL=\"postgresql://user:password@host:5432/dbname?sslmode=require\"|DATABASE_URL=\"${db_url}\"|" .env.local
      sed -i "s|DATABASE_URL_UNPOOLED=\"postgresql://user:password@host:5432/dbname?sslmode=require\"|DATABASE_URL_UNPOOLED=\"${db_url}\"|" .env.local
    fi
  fi
  echo "Created .env.local (${db_url})."
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required (.nvmrc)." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  NODE_LOCAL_BIN="$HOME/.local/node-v22.22.0-darwin-x64/bin"
  if [[ -x "$NODE_LOCAL_BIN/pnpm" ]]; then
    export PATH="$NODE_LOCAL_BIN:$PATH"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found." >&2
  echo "Install Node.js 22 (includes npm), then run: npm install -g pnpm" >&2
  echo "See docs/local-development.md" >&2
  exit 1
fi

if [[ ! -f .env.local ]]; then
  write_env_local
else
  echo "Using existing .env.local."
fi

if [[ ! -e .env ]]; then
  ln -sf .env.local .env
  echo "Linked .env -> .env.local for Prisma CLI."
fi

echo "Installing dependencies..."
pnpm install

USE_DOCKER=false
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    USE_DOCKER=true
  fi
fi

if [[ "$USE_DOCKER" == true ]]; then
  echo "Docker is available — starting Postgres container..."
  docker compose up -d db
  bash scripts/wait-for-postgres.sh
  pnpm exec prisma migrate deploy
  cat <<'EOF'

Local dev environment is ready (Docker Postgres).

Next steps:
  pnpm dev          # http://localhost:3001
  pnpm db:studio
  pnpm docker:down  # stop Postgres when done

EOF
  exit 0
fi

PSQL_BIN="$(find_psql || true)"
if [[ -n "$PSQL_BIN" ]]; then
  if wait_for_native_postgres "$PSQL_BIN"; then
    ensure_native_database "$PSQL_BIN"
    pnpm exec prisma migrate deploy
    cat <<EOF

Local dev environment is ready (native Postgres).

Next steps:
  pnpm dev          # http://localhost:3001
  pnpm db:studio

If Postgres.app is installed, keep it running from the menu bar.

EOF
    exit 0
  fi
fi

cat <<'EOF'

Dependencies and .env.local are ready, but Postgres is not running yet.

Recommended on older Macs (macOS 12, no Docker Desktop):

  1. Install Postgres.app (includes PostgreSQL 16):
     https://postgresapp.com/downloads.html
  2. Open Postgres.app from Applications and click Start
  3. Optional — add CLI tools to your shell:
     sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
  4. Re-run: pnpm setup:dev

Alternative: install Node from nodejs.org if npm/pnpm are missing.
Docker Desktop requires macOS 14+ on current releases — use native Postgres instead.

EOF
exit 1
