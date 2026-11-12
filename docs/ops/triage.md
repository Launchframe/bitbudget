# BitBudget ops triage runbook

Quick paths for production incidents. Pair with `pnpm ops:health`, `pnpm ops:errors`, and `pnpm ops:crons`.

## Users can't sign in / stuck on auth

**Symptoms:** Valid session but app redirects to `/auth`, or onboarding gate shows server error.

1. Run `pnpm ops:health` against production (`OPS_BASE_URL=https://bitbudget.io`).
2. If `schema: false` or Prisma `Unknown field` in Sentry → **schema drift**: code deployed before `prisma migrate deploy`. Fix: run migrations on prod DB, redeploy if needed.
3. Check Sentry for `GET /api/user/settings` 500s (`cause: schema_drift` tag).
4. Confirm `OnboardingGate` shows retry UI for 5xx (not auth Configuration error).

## Cron failure

**Symptoms:** Discord/Telegram alert `Cron failed: <name>`, or `/admin/ops` shows red cron row.

1. `pnpm ops:crons --name recurring` (or failing job name).
2. Read `errorClass` / `errorMessage` in admin ops or Sentry (`cron` tag).
3. Re-run manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://bitbudget.io/api/cron/<name>`.
4. If recurring/Plaid/BTC — check external API status and env vars.

## 5xx spike

1. Sentry → sort by frequency last 1h.
2. `git log --since="2 hours ago" --oneline` on deployed SHA (`VERCEL_GIT_COMMIT_SHA` in `/api/health`).
3. Roll back deploy or hotfix; verify `/api/health` returns 200.

## Discord / Telegram delivery failure

1. `/admin/ops` → **Send test alert**.
2. Verify env: `DISCORD_OPS_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPS_CHAT_ID`.
3. Check `OpsEvent.channelStatus` JSON — which channel returned false.
4. Email fallback uses admin users with `role=admin` and `GMAIL_*` configured.

## Better Stack setup (free tier)

1. Create uptime monitor: `GET https://bitbudget.io/api/health` every 3 minutes.
2. On down → webhook to `POST https://bitbudget.io/api/alerts/incoming` with header `Authorization: Bearer $OPS_ALERTS_INCOMING_SECRET` and JSON body `{ "source": "betterstack", "severity": "page", "title": "Health check failed", "body": "..." }`.

## Sentry alert rules

1. **New issue in production** → webhook to `/api/alerts/incoming` (same bearer secret).
2. **Issue spike** → same endpoint with `severity: page`.

## Agent-assisted triage

Use the Cursor **triage** skill (`.cursor/skills/triage/SKILL.md`): pull recent Sentry issues, correlate commits, propose minimal fix branch, draft Discord update.
