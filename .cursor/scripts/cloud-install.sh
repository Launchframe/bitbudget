#!/usr/bin/env bash
# Cursor Cloud environment build: deps + local Postgres packages (no migrations).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

pnpm install

if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client
fi
