# QA: Recurring transactions

Use this on **staging** or **local dev** only. Do **not** run ad hoc SQL against production.

## Why you do not need to wait a week

- The app triggers `POST /api/recurring/process` during a full data refresh (same logic as the daily cron).
- Posting depends on `RecurringTransaction.nextDueDate` being **on or before** the end of “today” (server local day). The bottleneck is calendar time until the next due date—not the cron schedule.
- Shortest product cadence is **weekly**, so for faster validation you **move the due date in the database** or use the helper script below.

## Tier 1 — Manual checklist (no deploy)

### Prerequisites

- Staging URL and a test account with envelopes.
- Optional: Prisma Studio or read/write DB access (`DATABASE_URL`) for staging.

### Steps

1. **Create a rule**  
   New Transaction → enable Recurring → save. Confirm **Upcoming Recurring** on the Transactions page lists the next occurrence.

2. **Make the next run “due” without waiting**  
   In Prisma Studio (or SQL), set `RecurringTransaction.nextDueDate` to **yesterday** or **today** (date semantics match how rows are stored—typically midnight UTC for date-only intent).  
   Example SQL (replace IDs):

   ```sql
   UPDATE "RecurringTransaction"
   SET "nextDueDate" = CURRENT_TIMESTAMP - INTERVAL '1 day'
   WHERE id = '<recurring_id>';
   ```

3. **Process**  
   Reload the app (or navigate away and back) so a full refresh runs, or call `POST /api/recurring/process` while authenticated.

4. **Expected**  
   - A new **Transaction** row with `recurringId` set.  
   - **Upcoming Recurring** shows the **next** `nextDueDate` (one cadence step after the occurrence that posted).

5. **Post now**  
   From Upcoming Recurring, use **Post Now**, adjust notes/amount if needed, submit.  
   - A new transaction is created **linked to the rule**.  
   - `nextDueDate` advances by **one** cadence (the scheduled auto-occurrence is skipped).

6. **Edit / delete**  
   Edit the rule (payee, envelope, cadence, end date) and confirm the list updates.  
   Delete the rule and confirm it disappears and no new auto-posts occur after process.

### Safety

- Confirm environment (staging vs prod) before any `UPDATE`.  
- Never paste real user IDs from production into staging tickets.

## Tier 2 — Bump due date script

Maintainers can move due dates without writing SQL by hand:

```bash
pnpm qa:recurring:bump -- --userId <user_cuid> [--recurringId <id>] --days <n>
```

Subtracts `n` days from `nextDueDate` (defaults to all active recurrings for that user). Requires `DATABASE_URL` (e.g. from `.env`). See [scripts/qa-bump-recurring-due.ts](../../scripts/qa-bump-recurring-due.ts).

## Automated coverage

- **Vitest:** `lib/__tests__/recurring.test.ts` — `advanceDate` and `processRecurringTransactions` (with mocks / injectable `asOf`).
- **Playwright:** `e2e/recurring.lifecycle.spec.ts` — signed-in flow against a seeded `@bitbudget.test` user (requires Postgres + `E2E_TEST` server).
