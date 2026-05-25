#!/bin/sh
set -e

if [ -n "${DATABASE_URL}" ]; then
  echo "Running database migrations..."
  node ./node_modules/prisma/build/index.js migrate deploy
else
  echo "WARNING: DATABASE_URL is unset; skipping prisma migrate deploy"
fi

exec "$@"
