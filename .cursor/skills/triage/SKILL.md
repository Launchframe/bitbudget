---
name: triage
description: Investigate BitBudget production incidents — Sentry issues, health checks, cron failures, and ops alerts. Use when the user reports outages, 5xx spikes, login failures, or cron/alert failures.
---

# BitBudget incident triage

## When to use

- Production outage or degraded `/api/health`
- Sentry alert or Discord/Telegram ops ping
- Users can't sign in after deploy
- Cron failure notifications

## Workflow

1. **Health** — Run `pnpm ops:health` (set `OPS_BASE_URL` to prod if needed). Read `ok`, `db`, `schema`, `sha`.
2. **Recent errors** — Run `pnpm ops:errors` (requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`).
3. **Crons** — Run `pnpm ops:crons` (requires `DATABASE_URL`). Inspect latest failures.
4. **Correlate deploy** — `git log --oneline -10` and match `sha` from health response.
5. **Runbook** — Follow [docs/ops/triage.md](../../docs/ops/triage.md) for the matching symptom.
6. **Fix** — Minimal scoped fix on a feature branch; add regression test if logic bug.
7. **Communicate** — Draft short Discord/Telegram update for maintainer (no user PII).

## Privacy

- Do not paste decrypted transaction fields, emails, or keys into alerts or PR comments.
- Sentry issues may contain routes and stack traces only after scrubbing.

## Admin UI

- `/admin/ops` — health tile, cron history, ops events, test alert button.
