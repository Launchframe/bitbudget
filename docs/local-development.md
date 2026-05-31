# Local development

BitBudget needs **Node.js 22+**, **pnpm**, and **PostgreSQL 16**. The app runs on your Mac with `pnpm dev`; only the database needs to be installed separately.

## Choose your Postgres setup

| Setup | Best for |
|-------|----------|
| **Native Postgres (Postgres.app)** | Older Macs (macOS 12), machines without Docker Desktop |
| **Docker Compose (`pnpm docker:up`)** | macOS 14+ with Docker Desktop, Linux dev boxes |

`docker compose` alone is **not** enough — it still requires a container runtime (Docker Desktop or Colima). On a 2015 MacBook Pro capped at macOS 12.7.6, **use native Postgres**.

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Node.js 22+](https://nodejs.org/) | App runtime (see `.nvmrc`). Must include **npm**. |
| [pnpm 9](https://pnpm.io/) | `npm install -g pnpm` after Node is installed |
| **PostgreSQL 16** | [Postgres.app](https://postgresapp.com/) (recommended on Mac) or Docker |

Optional integrations: Gmail (OTP), Nostr DMs, OAuth — see [outbound-messaging.md](./outbound-messaging.md).

## Install Node and pnpm on macOS

If `npm: command not found`, install a full Node.js build (Cursor’s bundled Node is not enough).

**Easiest:** macOS Installer (.pkg) for Node 22 from [nodejs.org/en/download](https://nodejs.org/en/download), then:

```bash
npm install -g pnpm
```

**Without Homebrew / Xcode CLT** (Intel Mac tarball example):

```bash
mkdir -p ~/.local
curl -fsSL https://nodejs.org/dist/v22.22.0/node-v22.22.0-darwin-x64.tar.gz \
  | tar -xz -C ~/.local
echo 'export PATH="$HOME/.local/node-v22.22.0-darwin-x64/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm install -g pnpm
```

## Install Postgres natively (recommended on older Macs)

### Postgres.app

1. Download **Postgres.app** with **PostgreSQL 16** from [postgresapp.com/downloads.html](https://postgresapp.com/downloads.html).
2. Drag **Postgres.app** to `/Applications` and open it.
3. Click **Start** (menu bar elephant icon).
4. Optional — expose `psql` / `createdb` in every terminal:

```bash
sudo mkdir -p /etc/paths.d
echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
```

5. From the repo root:

```bash
pnpm setup:dev
pnpm dev
```

`setup:dev` creates `.env.local` with a connection string like:

```bash
DATABASE_URL="postgresql://YOUR_MAC_USERNAME@127.0.0.1:5432/bitbudget_dev"
```

Postgres.app’s default superuser is your macOS username with trust auth on localhost.

### Official PostgreSQL installer

Alternative: [postgresql.org/download/macos](https://www.postgresql.org/download/macos/). After install, create `bitbudget_dev` and point `.env.local` at it.

## Quick start

```bash
pnpm setup:dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

`setup:dev` will:

1. Create `.env.local` + symlink `.env` for Prisma
2. Run `pnpm install`
3. **If Docker is running:** start Postgres via Compose and migrate
4. **Else if native Postgres is up:** create `bitbudget_dev` (if needed) and migrate
5. **Else:** print Postgres.app install steps

## Docker Compose (optional)

For machines with Docker Desktop (macOS 14+):

```bash
pnpm docker:up          # Postgres only
pnpm docker:down
pnpm docker:reset       # wipe DB volume
pnpm docker:app         # optional full-stack image
```

Docker `.env.local` URLs:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/bitbudget_dev"
DATABASE_URL_UNPOOLED="postgresql://postgres:postgres@127.0.0.1:5432/bitbudget_dev"
```

## Environment variables

Minimum for local dev:

```bash
DATABASE_URL="postgresql://YOU@127.0.0.1:5432/bitbudget_dev"
DATABASE_URL_UNPOOLED="postgresql://YOU@127.0.0.1:5432/bitbudget_dev"
AUTH_SECRET="..."   # ≥ 32 chars — npx auth secret
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"
```

Never set `E2E_TEST=true` in `.env.local` for manual development.

## Common commands

```bash
pnpm dev
pnpm test
pnpm lint
pnpm db:studio
pnpm test:e2e         # needs Postgres; uses port 3100 — stop pnpm dev first
```

## Troubleshooting

**Docker requires macOS 14+** — current Docker Desktop will not run on macOS 12. Use Postgres.app instead.

**`pnpm setup:dev` stops after install** — Postgres is not running. Open Postgres.app and click Start, then re-run `pnpm setup:dev`.

**Port 5432 in use** — another Postgres may be running. Stop it or set `BITBUDGET_DB_PORT` and update `.env.local`.

**Login OTP with no Gmail vars** — codes print in the terminal running `pnpm dev`.
