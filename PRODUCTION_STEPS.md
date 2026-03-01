All done. Here's a summary of everything that was changed:

---

### Database: SQLite to PostgreSQL

- **`prisma/schema.prisma`** — Switched the datasource from `sqlite` to `postgresql`, added `directUrl` for migration connections (Neon uses connection pooling by default, but migrations need a direct connection).
- **`prisma/migrations/0_init/migration.sql`** — Created the baseline migration with the full schema as PostgreSQL DDL.
- **`prisma/migrations/migration_lock.toml`** — Prisma migration lock file.

### Vercel Cron Jobs

- **`vercel.json`** — Configured two cron jobs:
  - `/api/cron/recurring` — runs daily at 6:00 AM UTC to process recurring transactions for all users.
  - `/api/cron/btc-backfill` — runs every 6 hours to fetch/refresh BTC price data.
- **`app/api/cron/recurring/route.ts`** — New endpoint secured with `CRON_SECRET`. Calls `processAllRecurringTransactions()` to handle all users.
- **`app/api/cron/btc-backfill/route.ts`** — New endpoint secured with `CRON_SECRET`. Fetches recent prices via CoinGecko, then runs up to 5 backfill chunks via CryptoCompare. Has `maxDuration = 60` for Vercel's function timeout.
- **`lib/recurring.ts`** — Added `processAllRecurringTransactions()` which finds all users with active recurring transactions and processes them.

### Build Fixes

- **`next.config.mjs`** — Removed `ignoreBuildErrors: true` so TypeScript errors are caught at build time.
- **`lib/crypto.ts`** — Fixed `Uint8Array`/`BufferSource` type incompatibility with Node 22 by adding a `toBuffer()` helper.
- **`components/envelopes-page.tsx`** — Fixed invalid `ringColor` CSS property (replaced with Tailwind CSS variable approach).
- **`app/api/recurring/route.ts`** — Fixed narrowing issue where `session.user.id` wasn't assignable inside `$transaction` callback.

### Updated Config

- **`package.json`** — Build script now runs `prisma migrate deploy` before `next build`. Added `db:migrate` script.
- **`.env.example`** — Updated with PostgreSQL connection strings, `DIRECT_DATABASE_URL`, and `CRON_SECRET`.

### Deployment Steps

1. Create a **Vercel Postgres** (Neon) database from the Vercel dashboard — Storage tab, "Create Database", pick Postgres.
2. Vercel will auto-inject `DATABASE_URL` and `POSTGRES_URL_NON_POOLED`. Map `DIRECT_DATABASE_URL` to the non-pooled URL in your Vercel project settings.
3. Set `AUTH_SECRET` (run `npx auth secret` to generate one).
4. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` as you configure those.
5. `CRON_SECRET` is auto-set by Vercel when you have cron jobs configured.
6. Push to your connected repo — the build script handles `prisma generate`, `prisma migrate deploy`, and `next build`.