# AGENTS.md — BitBudget

## Core Ethos

BitBudget is a **privacy-first, user-sovereign budgeting app**. Every change must uphold these principles:

- **User data is theirs alone.** Transaction details (payee, notes) are encrypted client-side before touching the server. The server stores ciphertext it cannot read. Encryption keys are never logged, transmitted in plaintext, or stored unencrypted on the backend.
- **Nostr users never share their nsec.** The app uses the browser extension (nos2x, Alby, Keys.band) for signing and NIP-04 encryption. The server only stores the npub.
- **Web 2.0 users derive keys from a PIN/password.** The derived key wraps a random privacy key via PBKDF2 + AES-GCM. The encrypted privacy key is stored server-side; only the client can unwrap it.
- **Backend-created transactions** (Plaid, email forwarding, SMS) encrypt sensitive fields with the user's public key (X25519 + XSalsa20-Poly1305). Only the client holding the private key can decrypt.
- **No ad-tech or cross-site tracking.** We use privacy-preserving, aggregate Vercel Analytics for basic usage and performance telemetry; no budgeting data or user identifiers are logged.
- **Warn before privacy is weakened.** Any flow that trades privacy/anonymity for convenience, recovery, integrations, or support must clearly explain the trade-off before the user proceeds. For example, a Nostr-only account is represented server-side by an npub; linking email, Google, GitHub, Plaid, SMS, receipt inbox, or other identifying/recovery methods stores additional identifiers and weakens anonymity. Users must see an explicit, plain-language warning and have a chance to cancel before taking that step.

If a change would cause sensitive data to be logged, stored in plaintext, or readable by the server, **stop and redesign**.

## Savings as core mechanic

BitBudget treats **pay yourself first** as a non-negotiable budgeting principle, not an optional mode:

- **Ledger accounting is always on.** Income credits land in the system **Savings** envelope first; envelope funding allocation legs run from Savings. There is no user-facing toggle to disable this.
- **Savings is its own UI primitive** — hero card on Envelopes, pinned filter pill on Transactions, dashboard tile, savings-mode chart — **not** a member of the discretionary envelope grid.
- **`User.savingsExperience`** (`engaged` | `dismissed`, default `engaged`) controls the **motivational narrative** only: goals, streaks, achievements, year-end recap, sweep ritual UI. When `dismissed`, the ledger still works; hero/goals/recap UI is hidden; dismissing also sets `sweepDefaultPolicy: carry_forward` so envelopes stop auto-draining on payday.
- **Do not reintroduce a ledger funding flag.** All server paths (`envelope-funding`, irregular income, cron) assume funding is active.

### Envelope balances: remaining vs current month

Discretionary envelopes and Savings are **running balances** (credits minus expenses over time). Sweep policy (reset / carry forward / capped) and monthly top-ups can leave **unspent money across calendar months** — especially with **carry forward**, which keeps leftovers in the envelope until spent or manually swept.

Use two scopes consistently:

| Concept | Meaning | When to use |
|--------|---------|-------------|
| **Remaining** (spendable) | All-time credits − expenses for the envelope, **including carryover** | “$X left”, “Remaining”, “Balance”, sweep amounts, dashboard Remaining tile, Savings total |
| **Current month** | Net activity dated in `YYYY-MM` only | Monthly Income / Monthly Spend, savings-goal period math, spend analytics buckets, **pacing** (not spendable totals) |

**Helpers (client):**

- **Remaining:** `getEnvelopeBalanceAllTime()` in `lib/data.ts`; `savingsBalance()` and `sumRemainingDiscretionary()` in `lib/savings-ui-metrics.ts`; `envelopeBudgetProgressPct()` / `envelopeHealthColor()` in `lib/envelope-card-metrics.ts` (progress vs monthly allotment; may exceed 100% with carryover).
- **Current month:** `getEnvelopeBalance(transactions, envelopeId, monthKey)` with `getCurrentMonthKey()` / `getMonthKey()`.
- **Pacing:** `monthProgressMarkerPct()` and `targetBalanceForMonthPace()` in `lib/envelope-sweep.ts` — compare remaining to where the user “should” be by day-of-month; do not substitute month-scoped balance for remaining.

**Server:** sweep and funding decisions use all-time balances (`envelopeBalancesAllTimeBatch`, `savingsEnvelopeBalanceBefore`, etc. in `lib/envelope-balance-server.ts`). Client remaining UI must match that scope.

**UI pattern:** Envelope cards and detail pages show **remaining (all-time)** for dollar amounts; the progress bar fill uses remaining ÷ monthly allotment, with the white marker for **month pacing** only.

**Do not** use month-scoped balance for remaining labels — it ignores prior-month carryover and diverges from sweep/funding behavior.

### Ledger periods (agent vocabulary)

Two automatic rhythms — **do not** use these terms in user-facing UI:

| Period | When (UTC) | What moves | Helpers / idempotency |
|--------|------------|------------|------------------------|
| **PayPeriod** | User paydays (`isPaydayForUser`) | Paycheck slice → **Savings only** (no allocation legs) | `creditPaycheckToSavings` in `lib/envelope-funding.ts`; batch keys `pay-YYYY-MM-DD` (legacy `fund-YYYY-MM-DD` guarded) |
| **BudgetPeriod** | Calendar **day 1** | Auto sweep (policy) then **gap-only** top-up Savings → envelopes | `sweepDiscretionaryEnvelopesForUser` + `processMonthlyBudgetAllocations`; keys `sweep-YYYY-MM`, `alloc-YYYY-MM` via `lib/budget-period.ts` |

**User-facing copy:** paydays grow Savings; spending envelopes refill on the **1st**. Progress bars use **calendar-month** balance ÷ `monthlyAllotment` (`lib/envelope-card-metrics.ts`).

**Manual flows (separate from cron):**

- **Extra income** — default Savings (`distributionMode: "savings"`); optional envelope legs via `lib/move-funds-math.ts` + irregular-income API.
- **Move funds** — `POST /api/transactions/move-funds`; sources `envelope_transfer_in` / `out` or Savings legs (`move_funds` batch kind).
- **Deficit cover** — manual only, month balance → **$0** (`deficitCoverAmount`, `TX_SOURCE_DEFICIT_COVER`); not a full refill.
- **Income import** — Savings credits only; no immediate envelope legs (wait for next BudgetPeriod cron).

**Cron:** `lib/envelope-funding-cron.ts` — on 1st: sweep → alloc; on paydays: paycheck only. Goal maintenance stays on UTC 1st (`lib/funding-cron-schedule.ts`).

### Transaction visibility, analytics, and lifecycle

Not every `Transaction` row belongs in every feed. Ledger funding creates **batches**: an income header (`income_import`, `irregular_income`, etc.) plus hidden allocation legs (`envelope_funding_out` / `envelope_funding_in`). Getting visibility wrong leaks allocation legs into spend charts or leaves orphan legs after delete.

**Visibility scopes (use the right helper — do not re-filter ad hoc):**

| Scope | Meaning | Helpers |
|--------|---------|---------|
| **Main history** | Global transaction lists, dashboard recent, exports default | `transactionsVisibleInMainHistory()` — `excludeFromMainHistory === false` |
| **Envelope list** | Envelope detail / filtered Transactions; shows funding legs tied to that envelope | `transactionsForTransactionList()` |
| **User-facing spend** | Monthly Spend, OC/spending chart, top opportunity costs | `isUserFacingExpense()` / `filterUserFacingExpenses()` in `lib/transaction-visibility.ts` |
| **Cash flow chart** | Signed net of external inflows minus user-facing outflows (excludes paycheck ledger credits) | `buildCumulativeCashFlowSeries()` — uses `isCashInflowCredit` + `isUserFacingExpense`; USD only |
| **Spending chart** | Cumulative user expenses only | `buildCumulativeSpendingSeries()` in `lib/cumulative-spending-series.ts` |
| **Envelope balance** | All credits/expenses for an envelope (includes funding legs) | `getEnvelopeBalanceAllTime()` / server batch helpers — **never** filter `excludeFromMainHistory` here |

**Chart time bounds:** Dashboard series are **historical through today (UTC calendar date)** only. Never plot future-dated rows (`todayUtcIso()` / `todayIso` param). Future-dated funding legs from bad imports must not extend the x-axis.

**Deleting income headers:** Deleting a credit that is an **income header** with a `fundingBatchId` must remove the **entire batch** (header + all legs) on server (`deleteTransactionForUser` in `lib/transaction-batch-delete-server.ts`) and optimistically on client (`AppContext.deleteTransaction`). UI must confirm when funding legs exist (`useTransactionDeleteConfirm`). Users cannot delete individual funding legs from the detail dialog — they are managed by the income row.

**Checklist when adding or changing `Transaction.source` or row shapes:**

1. Set **`excludeFromMainHistory`** correctly on create (allocation legs: `true`; user-visible income/expense: `false`).
2. If rows form a batch, set shared **`fundingBatchId`** and implement batch reset on re-import / overwrite (see `lib/income-import.ts`).
3. Declare which feeds include the new source (main history, envelope list, spend analytics, cash flow, savings inflow) and wire through the helpers above — **do not** assume `type === "expense"` means user spending.
4. Add or extend **Vitest** coverage for visibility helpers and any new series builder.
5. If delete semantics apply, extend **`shouldCascadeDeleteFundingBatch`** / server delete and the confirm dialog copy.
6. Run dashboard + Transactions manually after changes — funding legs are the most common source of chart spikes and orphan rows.

**`csv_import` source:** CSV imports create plain user-facing rows (`source: "csv_import"`, `excludeFromMainHistory: false`, no `fundingBatchId`). They count in main history, envelope lists, spend analytics, and cash flow like any manual expense/credit.

### CSV import: chunking + privacy-preserving idempotency

Large imports (thousands of rows) used to time out the serverless function and leave partial, then duplicated, data on client retries. The hardened flow:

- **Chunked upload.** `components/csv-import-dialog.tsx` encrypts every row, computes a dedupe key, then POSTs `/api/import` in sequential chunks (`IMPORT_CHUNK_SIZE`, ~250). Each chunk is small enough to finish well under the timeout; envelopes created by an earlier chunk are visible to later chunks. `/api/import` also sets `export const maxDuration = 60` as a safety net.
- **HMAC dedupe key (`Transaction.dedupeKey`, nullable).** The client derives `HMAC-SHA256(privacyKeySeed, "bitbudget-dedupe-v1|" + transactionCollisionKey + "#" + occurrence)` (`lib/import-dedupe-key.ts`, truncated to 128 bits). The server **cannot** recompute it (the HMAC key is the client-only privacy-key seed), so it stays privacy-preserving while still being deterministic for the same row from the same client. An **occurrence counter** keeps genuinely-identical in-file repeats distinct while re-imports of the same file map to the same keys.
- **Server idempotency.** A **partial unique index** `(userId, dedupeKey) WHERE dedupeKey IS NOT NULL` + `createMany({ skipDuplicates: true })` makes chunk retries and whole-file re-imports no-ops. The route returns `{ imported, skipped, duplicates }` (`duplicates = data.length − inserted`); null-key rows are never deduped. BTC prices are looked up once per distinct date. The index lives in committed migration SQL (`prisma/migrations/20260531130000_transaction_dedupe_key/`) — Prisma schema cannot express partial unique indexes, so **do not use `db push` to sync this table** (see **Database → Local schema sync**).
- **Seed access.** `resolveImportCrypto()` (`lib/resolve-import-encrypt-fn.ts`) returns `{ encrypt, seedHex }` for the onboarding/standalone path; signed-in callers pass `AppContext.makeImportDedupeKeyComputer()` (built from the cached seed) to the dialog. Never send the seed or raw key to the server.
- **Manual cleanup.** Existing duplicate messes are fixed in-app: Settings → Data & Security → **Find duplicate transactions** (`components/duplicate-cleanup-card.tsx`, clustering in `lib/duplicate-clusters.ts`) groups decrypted rows by `transactionCollisionKey`, keeps the earliest by default, and bulk-deletes the rest via `POST /api/transactions/bulk-delete` + `AppContext.bulkDeleteTransactions`. Locked rows and funding-batch rows are excluded so plain bulk delete never orphans paired ledger entries.

## Project Structure

```
app/                     Next.js App Router pages and API routes
  api/                   REST endpoints (auth check → prisma → response)
  auth/                  Authentication page
  landing/               Bitcoin-focused landing page
  welcome/               Vanilla budgeting landing page
  onboarding/            Multi-step onboarding wizard
  admin/                 Admin dashboard (gated by isAdmin)
components/              React client components (all "use client")
lib/                     Shared logic — types, crypto, contexts, helpers
  app-context.tsx        Global state provider (single React context)
  btc-price-context.tsx  BTC price data provider (separate context)
  crypto.ts              Client-side E2E encryption (PBKDF2, AES-GCM, NaCl)
  data.ts                Core type definitions and formatting utilities
  constants.ts           Shared constants (used by both client and server)
prisma/                  Schema, migrations, seeds
public/                  Static assets (icons, onboarding screenshots)
styles/                  Tailwind globals
docs/                    Operator and integrator guides (see Outbound messaging below)
```

### Outbound messaging (email & Nostr)

Product notifications (referrals, premium trial/gratis reminders, notification-email verification, login OTP) use **Gmail SMTP** (`lib/email.ts`) and/or **NIP-04 DMs** (`lib/nostr-dm.ts`), orchestrated by `lib/notify.ts`. Users opt in under **Settings → Communications**; Nostr users may link **multiple** verified notification emails (`UserNotificationEmail`) **and** enable Nostr DMs independently (both channels can fire for the same event).

**Integrator / maintainer guide:** [docs/outbound-messaging.md](docs/outbound-messaging.md) — env vars, local setup, preview vs production on Vercel, deployment checklist, manual tests, troubleshooting.

**Env vars (see also `.env.example`):** `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `NEXTAUTH_URL` (unsubscribe + auth URLs), `BITBUDGET_NOSTR_NSEC`, optional `BITBUDGET_NOSTR_RELAYS`, `CRON_SECRET` for `/api/cron/referral-expiry`. Without Gmail vars, `lib/email.ts` logs to the console (subject/recipient for HTML mail; 6-digit code only for OTP/verify — not full bodies). Without `BITBUDGET_NOSTR_NSEC`, DMs are skipped with a warning.

**Local dev quick start:** Postgres + `AUTH_SECRET` in `.env.local` → `pnpm prisma migrate deploy` → `pnpm dev`. Add Gmail and/or Nostr vars only when testing real delivery. Never set `E2E_TEST` in `.env.local` for manual messaging tests (Playwright sets it automatically).

**Preview vs production:** Use separate databases, Gmail senders, and Nostr service `nsec` values per environment; set `NEXTAUTH_URL` to each deploy’s canonical HTTPS origin so unsubscribe links work. Full checklist in the doc above.

**Nostr relays (MVP):** Publish DMs through default or well-known **public** clearnet relays (`BITBUDGET_NOSTR_RELAYS` optional). **Tor-only / `.onion` relays are not supported** in code today (no SOCKS/Tor WebSocket); they are documented as post-MVP for operators who want a non-discoverable relay — see [Tor-only relays (post-MVP)](docs/outbound-messaging.md#tor-only-relays-post-mvp).

**Agents:** When helping developers set up outbound messaging, walk through [docs/outbound-messaging.md](docs/outbound-messaging.md) in order (local → preview → production). Do not put service `nsec` or app passwords in client code, logs, or PR descriptions. Do not promise Tor relay publish on Vercel without custom Tor-capable infrastructure.

### Android bank notification forwarding (DIY ingest)

BitBudget **cannot** read other apps’ notifications from the web app. Users on Android may forward **bank app notifications** to BitBudget via **Tasker**, **MacroDroid**, or **Automate** (notification listener + HTTP POST). This is a **premium/trial** capture path; transaction source is `notification_forward`.

**Integrator / support / chatbot guide:** [docs/android-notification-forwarding.md](docs/android-notification-forwarding.md) — prerequisites, privacy warnings, per-app setup (Tasker / MacroDroid / Automate), webhook JSON contract, troubleshooting playbook, curl tests.

**API surface:**

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET` / `POST` `/api/user/notification-ingest` | Session | Issue or rotate `notificationIngestToken`; returns `webhookUrl` |
| `POST` `/api/webhooks/notification-ingest` | `Authorization: Bearer <token>` or `X-BitBudget-Ingest-Token` | Ingest alert JSON → parse → `routeTransaction` (pending or live) |

**Code:** `lib/bank-alert-parser.ts`, `lib/notification-ingest.ts`, `lib/ingest-token.ts`, `User.notificationIngestToken` in Prisma. Trial monthly cap uses the same bucket as email/SMS (`PREMIUM_CAPTURE_SOURCES` in `lib/subscription.ts`).

**Agents helping users:**

1. Confirm **premium or trial**, encryption setup, and that the bank app actually posts **notifications** (not toast-only).
2. Walk through the **privacy** section — notification access is granted to the automation app, not BitBudget.
3. Use the doc’s **Tasker / MacroDroid / Automate** sections; adapt variable names to the user’s app version.
4. Token via authenticated `GET /api/user/notification-ingest` (Settings UI may not exist yet — do not invent URLs).
5. Test with **curl** from the doc before debugging phone automation.
6. Never ask users to paste ingest tokens in public channels; never log notification bodies or tokens.

**Not supported:** iOS notification forwarding (no equivalent user automation to a custom webhook without a native helper app), reading **toasts**, BitBudget listening without user-installed automation.

## Tech Stack

- **Framework:** Next.js (App Router), React, TypeScript
- **Styling:** Tailwind CSS + shadcn/ui components
- **Auth:** Auth.js v5 (NextAuth) — Credentials, Google, GitHub, Nostr, Email OTP
- **ORM:** Prisma (PostgreSQL in prod and for local dev / e2e)
- **Package manager:** pnpm
- **Runtime:** Node.js ≥ 20
- **Testing:** Vitest (unit), Playwright (e2e)
- **CI:** GitHub Actions — lint, Vitest, and Playwright e2e on PRs and pushes to main

## Testing

**Unit tests are critical for production stability.** Add or extend Vitest coverage **as you build** each change—not only before merge or in a follow-up. Treat untested new logic in shared code as incomplete work.

- **When to test:** New or changed behavior in `lib/` (crypto, helpers, parsers, matchers), API input handling, pure utilities, and any regression-prone branch should have tests that fail if the behavior breaks.
- **Where:** Follow existing layout under `lib/__tests__/` (or the project’s co-located `*.test.ts` pattern).
- **How:** Run `pnpm test` (or a scoped path, e.g. `pnpm test -- lib/__tests__/foo.test.ts`) while developing; CI runs the full suite on PRs.
- **Quality:** Prefer small, focused cases; mock network/DB where appropriate; keep crypto and time-dependent tests deterministic.

Skipping unit tests for non-trivial changes should be the exception and called out explicitly in the PR if unavoidable.

### End-to-end (Playwright)

- **Layout:** Specs live under `e2e/` (see `playwright.config.ts` and [docs/testing/e2e-v1-coverage-plan.md](docs/testing/e2e-v1-coverage-plan.md)). **Current specs on `main`:** Referral-program coverage is in `e2e/referrals.program.spec.ts` (validate/redeem flows, settings flags, `activateReferral` / trial months, referral-code API, auth via email OTP). **`e2e/new-transaction.manual-entry.spec.ts`** covers opening New Transaction with **no payee prefill** and typing in the payee field (guards against regressions where keystrokes were cleared). **`e2e/receipt-scan.prefill.spec.ts`** mocks **`POST /api/receipts/scan`** and asserts PNG/PDF upload flows open New Transaction with prefilled fields (and image receipt preview for PNG). `e2e/recurring.lifecycle.spec.ts` covers a signed-in `@bitbudget.test` user with a due seeded rule. `e2e/walkthrough.per-user.spec.ts` covers per-user `walkthroughCompleted` persistence. Onboarding/landing coverage is in `e2e/landing-auth.smoke.spec.ts`, `e2e/onboarding.income-matrix.spec.ts`, and `e2e/onboarding.import-branches.spec.ts`. Envelope coverage is in `e2e/envelopes.lifecycle.spec.ts` and `e2e/envelopes.archive.spec.ts`. **`e2e/income-importer.spec.ts`** covers the income calendar importer (paint range, cell edit, review/confirm, draft persistence, Clear All, past-only vs current-month Monthly Income gate, success → Dashboard Savings + All range). **Planned specs (in stacked e2e implementation PRs, not yet on `main`):** transactions (`transactions.filters.spec.ts`, `new-transaction.features.spec.ts`), payee mappings (`payee-mappings.spec.ts`), analytics/settings (`analytics.ranges.spec.ts`, `settings.tabs.spec.ts`). See the coverage plan for the full phased roadmap.
- **Commands:** `pnpm exec playwright install` once per machine (CI installs Chromium automatically). Run `pnpm test:e2e` (or `pnpm test:e2e:ui`). Locally Playwright runs `next build` then `next start` on port **3100** by default (see `playwright.config.ts`) so it does not fight `next dev`’s `.next/dev/lock` — **GitHub Actions** runs **`pnpm exec next build`** as its own workflow step (clear failure logs) and sets **`PW_WEBSERVER_SKIP_BUILD`** so Playwright only runs **`next start`** — **avoid running `pnpm test:e2e` while `pnpm dev` is building/watching the same tree**, or override `PW_WEBSERVER_COMMAND` (e.g. `PW_WEBSERVER_COMMAND="pnpm dev"` on port `PW_SERVER_PORT` after stopping the other dev). **`config.webServer` uses stdout/stderr `pipe`** so `next build` / `next start` logs appear in the test runner (Playwright does not forward `inherit` for web servers). Use **`PW_WEBSERVER_STDIO=ignore`** to silence them; **`DEBUG=pw:webserver`** adds Playwright web-server debug logs. If you see “Process from config.webServer was not able to start”, check `.env`/`.env.local` for **`DATABASE_URL`** (global setup), **`AUTH_SECRET`** (≥32 chars), and **`DATABASE_URL_UNPOOLED`** per CI; confirm nothing else is bound to **`PW_SERVER_PORT`** (default **3100**). The server runs with `E2E_TEST=true` so `/api/auth/send-code` accepts fixed OTPs for addresses ending in `@bitbudget.test` (see `app/api/auth/send-code/route.ts`), and `lib/notify.ts` skips all outbound email/Nostr DMs so referral and cron-style notifications do not hit real inboxes. **Never set `E2E_TEST` in production.**
- **Database:** E2E requires PostgreSQL (`DATABASE_URL` and `DATABASE_URL_UNPOOLED`; `AUTH_SECRET` ≥ 32 chars). Global setup runs `prisma migrate deploy` and reseeds referral fixtures (`e2e/seed-referral-e2e.ts`), recurring QA fixtures (`e2e/seed-recurring-e2e.ts`), app-user fixtures (`e2e/seed-app-e2e.ts`), and income-importer fixtures (`e2e/seed-income-importer-e2e.ts`).
- **Manual recurring QA:** See [docs/testing/recurring-qa.md](docs/testing/recurring-qa.md) (staging DB bump, `pnpm qa:recurring:bump`, and the checklist). **`pnpm test`** includes `lib/__tests__/recurring.test.ts`; **`e2e/recurring.lifecycle.spec.ts`** covers a signed-in `@bitbudget.test` user with a due seeded rule.
- **Local referral code (manual QA):** When asked for a referral code for local/staging testing, run **`pnpm referral:admin-code`** (`scripts/print-admin-referral-code.ts`). It ensures a valid user referral code owned by the earliest `createdAt` admin (reuses an active unused code or creates one via `ensureUserReferralCode`). Prints the code on **stdout** (owner line on stderr); capture with `CODE=$(pnpm referral:admin-code 2>/dev/null)`. Requires **`DATABASE_URL`**. If no admin exists, promote one with **`ADMIN_EMAILS`** + **`pnpm db:seed-admin`** first.
- **Maintenance:** When you change referral rules, Plaid activation, onboarding gates, auth email flow, **transaction dialog prefill / payee canonicalization**, or manual entry UX, **update or extend the Playwright specs and seed constants** so CI keeps enforcing the product contract. Treat failing e2e the same as failing unit tests. Once the stacked e2e implementation PRs land, this also applies to **layout/navigation on core pages** (settings tabs, mobile nav, onboarding steps).
- **Responsive checks:** Playwright runs at a desktop viewport by default. For layout-heavy UI changes, **manually verify at 390px and 320px** (DevTools device mode) before merge; add or extend e2e viewport coverage when a regression has happened or the layout contract is easy to assert (e.g. no document scroll width exceeding viewport on settings).
- **Pull requests:** **`pnpm lint`, `pnpm test`, and `pnpm test:e2e` should all pass** before a change is considered ready to merge (unless a PR explicitly documents an exception and follow-up).
- **Outbound messaging QA:** Changing `lib/notify.ts`, `lib/email.ts`, `lib/nostr-dm.ts`, notification-email APIs, or communication preferences requires updating [docs/outbound-messaging.md](docs/outbound-messaging.md) when behavior or env vars change, and extending `lib/__tests__/notify-e2e-skip.test.ts` (or related tests) for routing regressions.

## Cursor Cloud specific instructions

Cloud agents use the saved environment **update script for dependency install only** — do **not** put `prisma migrate deploy` in the update script. Migrations need a live DB and block every agent boot when the database is unreachable.

**Update script (dashboard / `environment.json` `install`):**

```bash
pnpm install
```

`postinstall` runs `prisma generate`; that does not require a database connection.

**Run migrations on demand** when the task needs a synced schema (dev server, API routes, e2e, seed scripts):

```bash
pnpm exec prisma migrate deploy
```

Run this **before** `pnpm dev`, manual DB work, or `pnpm test:e2e` if migrations may be pending. Playwright global setup also runs `migrate deploy`, but a cloud agent starting the app directly should migrate first.

**Secrets** (Cursor Cloud Agents → Secrets — not committed `.env` files):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Pooled Postgres URL (app runtime) |
| `DATABASE_URL_UNPOOLED` | Direct Postgres URL (required by `prisma/schema.prisma` `directUrl`; use Neon/Vercel **non-pooler** host for migrations) |
| `AUTH_SECRET` | Auth.js secret (≥ 32 characters) |

Both DB URLs are required for `migrate deploy`. If `DATABASE_URL_UNPOOLED` is missing, Prisma fails with **P1012** before connecting.

**Typical cloud workflow:** `pnpm install` (update script) → `pnpm exec prisma migrate deploy` (when DB needed) → `pnpm dev` or targeted tests.

## Code Conventions

### Imports
- Keep imports at the top of every file. No inline `import()` inside functions or render bodies.
- Use `@/` path aliases (`@/lib/...`, `@/components/...`).

### Components
- Components that use React hooks, local state, or browser-only APIs must be client components (include the `"use client"` directive at the top of the file). Purely presentational components that don't rely on client-only features can be server components.
- Page-level components live in `components/` (e.g. `dashboard-page.tsx`, `transactions-page.tsx`).
- The app uses hash-based routing managed by `AppContext` (`navigateTo`, `currentPage`), not the Next.js file-based router, for in-app navigation after auth.
- **Envelope transaction drill-ins** use **`#/envelope/<id>`** (`navigateTo("envelope-detail", envelopeId)`). Do not rewrite these to `#/transactions` with an envelope filter; the scoped envelope view reuses the main Transactions list behavior.
- `app/page.tsx` is the shell: `OnboardingGate → AppProvider → EncryptionGate → BtcPriceProvider → layout`.
- When changing interactive UI, keep accessibility state and labels current: update `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-pressed`, `aria-selected`, and related screen-reader text alongside visible labels and control state.

### User-facing copy
- **Write for people, not engineers.** Labels, hints, empty states, errors, onboarding steps, and settings help must use plain language anyone can understand on first read.
- **Do not expose implementation vocabulary** in the UI: avoid terms like “bounded sliders,” “ledger,” “allocation legs,” “capacity,” “batch,” “ciphertext,” “envelope funding,” API field names, or other internal mechanic names unless the product explicitly teaches that term (e.g. “envelope” as a budgeting concept users already chose).
- **Explain outcomes, not plumbing.** Say what the app will do for the user (“We’ll use this to build a rough budget”) rather than how the code works (“Powers bounded allocation sliders”).
- **Keep tone calm and optional where fields are optional.** Make it clear they can skip or change things later without jargon or pressure.
- **Technical accuracy belongs in code comments, AGENTS.md, and PRs** — not in strings users see in the app.

### State Management
- `AppContext` (`lib/app-context.tsx`) is the single source of truth for app state. It holds transactions, envelopes, tags, user settings, encryption state, and navigation.
- Prefer optimistic UI updates (update local state immediately, then fire the API call) with rollback on failure.
- `BtcPriceContext` is a separate provider for BTC price data. `useBtcPrices()` **should** be called within `BtcPriceProvider`. If it runs outside the provider (e.g. vanilla mode or a missing wrapper), it returns **`NOOP_PRICES`** (zeros / no-op helpers) and logs a **dev-time warning** — it does not throw. Still wrap components that need real BTC data in `BtcPriceProvider` when `opportunityCostEnabled` is on.

### Transaction dates (calendar day vs instant; agents)

- **Display and filters in the browser:** use `lib/transaction-dates.ts` (`transactionCalendarDay`, `formatTransactionTableDate`, `todayTransactionCalendarDay`, etc.) so list and filter “days” match the **user’s local calendar** where those helpers run client-side.
- **Storage for calendar-only semantics:** prefer `calendarDateToStorageInstant` / `parseTransactionDateInput` for `YYYY-MM-DD` inputs so the DB instant is not naive-UTC-midnight drift (see comments in `transaction-dates.ts`).
- **User-initiated server writes** (rebalance, move-funds, manual transaction POST bodies, etc.): the server **must not** infer the user’s posting calendar day from `new Date().toISOString().slice(0, 10)` (UTC day). Send an explicit calendar string from the client (`postedOn`, `date`, etc.) validated like other transaction inputs, or document a single timezone contract for the endpoint.
- **Cron / BudgetPeriod / payday automation** intentionally uses **UTC calendar boundaries** for schedule math where documented in this file — do not conflate that with interactive posting-date UX.

### Smart defaults must never overwrite explicit user choices

Any feature that infers or suggests a value — envelope auto-assignment from payee history, payee alias inference, smart duplicate detection, AI/LLM categorization — **must not overwrite a value the user has already set**. User intent is sacrosanct.

**The rule:** track which values the user has explicitly touched (e.g. a `manuallySetRows: Set<number>` exclusion set, an `overrides` map, or a boolean "touched" flag per field) and gate every automated update behind it. If a field is in the user-touched set, no background inference may alter it.

**Propagation:** smart defaults that apply to multiple rows (e.g. "all rows with the same payee inherit the same envelope") must still respect the exclusion set for each individual row. Changing one row should propagate to all sibling rows that have NOT been manually set; it must never overwrite a row the user individually changed.

**UI hint:** when a value was set by inference (not the user), show a subtle source label (e.g. "From Whole Foods Market history") so the user understands where it came from and can override it. Once the user changes the value, treat it as manually set — clear the hint and add it to the exclusion set.

**Implementation pattern:**
- Keep a `manuallySetRows` (or `touched`) set/map in component state.
- When a smart default fires, check `!touched.has(id)` before applying.
- When a user event fires (onChange, onClick accept), add the id to `touched` before writing the value.
- Never reset `touched` due to background re-computation (e.g. re-loading envelope suggestions).
- When the draft is hydrated from sessionStorage, restore `touched` alongside the values.

### Input persistence for multi-field flows

Any multi-step or multi-field input flow (onboarding, income import, transaction batch entry, future wizards) **must** cache in-progress state so accidentally closing the dialog or refreshing the page does not destroy the user's work.

- **Default storage tier:** `sessionStorage` via [`lib/draft-storage.ts`](lib/draft-storage.ts). Survives accidental close + page refresh; dies on browser close. Use `localStorage` only when the value is explicitly meant to persist across sessions (e.g. dashboard chart prefs).
- **Required UI affordance:** a visible **Clear All** (or **Reset**) button whenever working state diverges from defaults. It must trigger an `<AlertDialog>` confirmation explaining what will be discarded before clearing.
- **Lifecycle:** save on every change (debounced ~400ms); hydrate on open; clear on successful submit, on Clear All confirm, and on logout (`clearAllDrafts()` in `AppContext.logout`).
- **Privacy:** never persist decrypted sensitive data (PINs, raw nsec, decrypted transaction notes) in drafts. Source labels and amounts are fine.
- **Validation:** load helpers must validate the deserialized shape and silently drop drafts that fail (schema bumps must not break the dialog).
- **Examples:** [`app/onboarding/page.tsx`](app/onboarding/page.tsx) (`ONBOARDING_SESSION_STORAGE_KEY`), [`components/income-importer/income-importer-dialog.tsx`](components/income-importer/income-importer-dialog.tsx) (`bitbudget-income-importer-draft`).

### Nested dialogs and modal stacks

Stacked dialogs (edit sheet on top of a wizard, confirm on top of a form) are easy to get wrong. **Dismissal on the child must never close the parent** unless that is explicit product intent.

- **Nest child dialogs inside the parent `DialogContent`** when they belong to the same flow (see income importer cell edit).
- **Guard the parent `onOpenChange`:** if a child modal is open, ignore `false` from the parent root (`if (!next && childOpen) return`).
- **On the child `DialogContent`:** call `e.preventDefault()` on `onInteractOutside` and `onPointerDownOutside` so overlay clicks do not fall through to the parent; call `e.stopPropagation()` on `onEscapeKeyDown`.
- **Cancel / Save buttons:** use `type="button"`, `e.stopPropagation()` on handlers, and never rely on unscoped `DialogClose` for nested layers.
- **Header actions vs. close (X):** reserve space for the built-in close control (`pr-10` on `DialogHeader` or similar) so custom buttons (e.g. Clear All) do not overlap the X.

### Setup guide & walkthrough

- **Checklist UI is server-authoritative.** Task completion comes from `GET` / `POST` `/api/user/setup-status` (`lib/setup-guide-status-api.ts`, `lib/setup-guide-server.ts`). The client hook `useSetupGuideStatus` (`lib/use-setup-guide-status.ts`) refetches when relevant local signals change; do not drive checklist completion from client-only guesses.
- **Editing transactions can change setup tasks without changing txn count.** `editTransaction` keeps `activeTransactions.length` the same; refetch deps must not rely on length alone.
- **`SETUP_GUIDE_TRANSACTION_TASK_IDS`** (`lib/setup-guide-status.ts`) lists tasks whose completion can change when transaction fields change (`type`, `date`, `source`, `excludeFromMainHistory`, `envelopeId`, etc.). `needsTransactionSetupTracking()` uses it to decide whether `activeTransactionSetupSignature()` runs (full **O(n)** scan on each txn list change).
  - **New transaction-related setup goal → add its task id to `SETUP_GUIDE_TRANSACTION_TASK_IDS`.** Otherwise edits (e.g. recategorizing an expense as a paycheck) will not refetch setup status and the checklist can stay stale (same class of bug as refetching on `activeTransactions.length` only).
  - **New non–transaction-related setup goal (e.g. a future multi-week streak) → do not add it to `SETUP_GUIDE_TRANSACTION_TASK_IDS`.** If it is listed, users pay txn signature overhead for the whole time that goal stays open, even after all txn tasks are done.
  - **`income` is special:** tracking continues while income is complete but only via paycheck credits (`monthlyIncome` still zero), so edits can revoke completion; once settings income is set, txn scanning for income stops.
- **Other client refetch gates:** `needsAllotmentSetupTracking()` (open `allocations` task) drives allotment signature; `needsMonthlyIncomeSetupTracking()` drives `state.monthlyIncome` refetch. Auto polling stops when `remote.allComplete`; manual `loadStatus()` still works for snooze/dismiss prefs.
- **Walkthrough** is separate: per-user `walkthroughCompleted`, `components/walkthrough-overlay.tsx`, `lib/walkthrough-steps.ts`. Use distinct `data-walkthrough` ids for nav vs in-page anchors (`lib/walkthrough-target.ts` prefers visible nodes in `<main>`).

### React effects and `setState` (`react-hooks/set-state-in-effect`)

ESLint flags **calling `setState` synchronously inside `useEffect` or `useLayoutEffect`** (including via helpers that set state in the same tick as the effect runs). The goal is to avoid **effects whose only job is to copy props/other state into local state**, which tends to cause extra render passes, harder-to-follow data flow, and sometimes **cascading updates** (effect → setState → render → effect → …) or tight loops in Strict Mode.

**Prefer (in order):**

1. **Derive during render** — If UI can be computed from props + existing state, compute it in the render body instead of mirroring into state in an effect. For “draft” values that diverge from props, use an **overrides map** (or similar): keep only user edits in state; the displayed value is `overrides[id] ?? propValue`, so you never need a sync effect when props change.
2. **User-driven updates** — Set state in event handlers (`onClick`, `onChange`, etc.). No lint issue; the rule targets effect bodies specifically.
3. **Defer when you must measure the DOM then update** — If you need `getBoundingClientRect()`, `ResizeObserver`, etc., schedule the `setState` **outside** the synchronous effect body so the linter is satisfied and you avoid stacking updates in the same commit:
   - `requestAnimationFrame(() => { … setState(…) })` (good for layout/position after paint)
   - `setTimeout(() => { … setState(…) }, 0)` (macrotask; allows paint before heavy work)
  - Nested `requestAnimationFrame` when a second pass needs measured node size after the first paint (e.g. walkthrough tooltip positioning).
 4. **Refs for non-render values** — If a value does not need to trigger a re-render, store it in `useRef` instead of `useState` + effect.

**Avoid:** `useLayoutEffect(() => { setX(…); })` with no deferral — fix by one of the patterns above. **Examples in this repo:** `components/walkthrough-overlay.tsx` (deferred `positionTooltip` / `setTooltipPos` via nested `requestAnimationFrame`), `components/envelope-allocations-page.tsx` (draft allotments via overrides, no sync-from-props effect).

### TypeScript
- Use exhaustive `switch` handling for union types and enums (use `default` with a `never` assertion or handle all cases explicitly).
- Prefer `interface` for object shapes in `lib/data.ts`; use `type` for unions and aliases.

### Styling
- Dark theme only. Background: `#0D0D0D`, cards: `bg-[#0D0D0D] rounded-2xl`.
- Accent color: `#F7931A` (Bitcoin orange), used for CTAs, active states, and BTC-related highlights.
- **Savings gold accent:** `SAVINGS_GOLD_ACCENT` (`#D4AF37` in `lib/constants.ts`) — use sparingly for Savings hero card border, pinned Savings filter pill, savings-mode chart lines, and Savings dashboard tile highlights. Distinct from Bitcoin orange.
- Success/credit color: `#22C55E`. Blue accent: `#3B82F6`.
- Monospace text (BTC/sats, codes, tabular numbers) uses `font-mono` (JetBrains Mono via `next/font/google`).
- **Use `Switch` for boolean settings**, not `<input type="checkbox">`. Native checkboxes are off-brand; the shadcn `Switch` component (`components/ui/switch.tsx`) fits the dark-theme design language.
- **Mobile-first responsive design is required**, not optional. Default styles target narrow viewports; use Tailwind breakpoints (`sm:`, `md:`, `lg:`) to enhance layout on larger screens. Most signed-in users reach the app on phones — a page that only looks correct on desktop is a bug.

### Responsive UI (mobile-first)

Treat horizontal overflow, clipped controls, and fixed-width layouts on small screens as **release-blocking UI defects**, on par with broken auth or data loss flows.

**Design defaults**
- Start from ~390px width (iPhone 12/13/14 class). Also sanity-check ~320px (small Android) and tablet widths before calling UI work done.
- Prefer stacked layouts (`flex-col`) on mobile; switch to side-by-side (`sm:flex-row`, `lg:grid-cols-…`) only when there is room.
- Use tighter padding on small screens (`p-4 sm:p-6`, `px-3 md:px-6`) so cards and forms retain usable inner width.
- Full-width CTAs on mobile (`w-full sm:w-auto`) when a button sits beside descriptive copy on larger breakpoints.
- Long text (emails, referral URLs, monospace addresses) must wrap or truncate: `min-w-0`, `break-all`, or `truncate` on the text node — never rely on the parent growing wider than the viewport.

**Flex / grid overflow (common bug class)**
- Flex and grid children default to `min-width: auto`, which prevents shrinking below content size and causes **page-level horizontal overflow** even when a child has `overflow-x-auto`.
- Any column inside the app shell or a page grid that should shrink with the viewport needs **`min-w-0`** (and usually `w-full max-w-full`). The main content column in `app/page.tsx` already sets this — new page roots and nested layout wrappers must continue the chain.
- **`overflow-x-auto` only works inside a bounded width.** If the scroll container’s ancestors can grow with content, the row expands the whole page instead of scrolling internally. Fix by constraining ancestors (`min-w-0 max-w-full`) or by changing mobile layout (e.g. vertical tab lists instead of a horizontal chip row).
- Horizontal nav/tab rows on mobile: either **stack vertically**, or put `overflow-x-auto` on a **`min-w-0`** wrapper with **`shrink-0`** items. Do not assume five labeled buttons fit in one row below `sm` (~640px).
- Side-by-side rows with an input + button should stack on narrow screens (`flex-col sm:flex-row`) when the pair would crowd the line.

**Shell & shared layout**
- Below `md`, navigation is **`MobileNav`** (bottom bar) + **`Header`**; the sidebar is hidden. Pages must not depend on desktop-only chrome for core actions.
- Dialogs and sheets: use responsive max widths (`max-w-[min(96vw,…)]`, `sm:max-w-lg`) and scrollable bodies (`max-h-[…] overflow-y-auto`) so content fits short viewports.
- Data tables may scroll horizontally inside a **`overflow-x-auto`** wrapper scoped to the table — not by widening the entire page. Update empty-state `colSpan` when columns are conditionally hidden.
- **Stable chrome:** Prefer **fixed-height** or **always-present** regions for **dialog headers, footers, and summary strips** so lists and charts do not jump vertically when helper text appears or values update.
- **Layout shift (CLS):** Avoid **per-row conditional blocks** that grow only some rows (for example funding hints on envelope cards). Put summaries **once** at the top or bottom of a list, or reserve **`min-height`** when optional copy must stay inline.
- **Charts:** Summary lines above a plot (for example **Saved** / cumulative totals on `components/opportunity-cost-chart.tsx`) should use a **reserved band** so toggling overlay data does not resize the chart body.

### Power users (hash routing, drafts, keyboard)

- **Signed-in navigation** uses hash routes in the shell (for example `/#/envelopes/allocations`, `/#/transactions`, `/#/envelope/<envelopeId>`). When linking from static routes into the app, use `next/link` with `href="/#/<page>"` so it matches `AppContext` navigation.
- **Draft persistence:** Multi-step flows may cache in `sessionStorage` under keys like `bitbudget-<feature>-draft`. Irregular income uses `bitbudget-irregular-income-draft` (`lib/irregular-income-draft.ts`). Logout runs `clearAllDrafts()` in `lib/draft-storage.ts`, which removes `bitbudget-*-draft` keys.
- **Enter to submit:** On supported dialogs, **Enter** (without Shift) triggers the primary action for the current step when focus is not in a `TEXTAREA`, a `contentEditable` region, or an element inside `[data-no-enter-submit]`. Shared helper: `handleDialogEnterToPrimary` in `lib/dialog-enter-submit.ts`. Initial coverage: irregular income, rebalance, and fill-envelope preview confirm.

**Before finishing UI work**
- Resize the browser (or DevTools device mode) to **390px and 320px** on every touched screen, dialog, and banner — including Settings, onboarding steps, and modals.
- Confirm there is **no horizontal page scroll** (content clipped on the right is the usual symptom).
- If you fix a responsive regression, note the viewport(s) checked in the PR test plan.

### Marketing routes & `bitbudget_visited`
- **`/welcome`** and **`/landing`** are public for everyone (including logged-in users). Middleware must not redirect authenticated users away from them.
- **`bitbudget_visited`** is set only after a **successful sign-in** (`components/returning-user-cookie.tsx`). Middleware uses it so unauthenticated visits to **`/`** go to **`/auth`** instead of **`/welcome`**. Do **not** set this cookie on `/auth` page load or from “Get Started” alone — that trapped users who hadn’t logged in yet and blocked re-reading the landing pages.

### API Routes
- Every **user-scoped** API route starts with `const session = await auth()` and returns 401 if unauthenticated.
- All **user-scoped** Prisma queries filter by `userId: session.user.id` — never trust the client to scope user data.
- Non–user-scoped routes (webhooks, cron jobs, health checks) must use appropriate verification (shared secret, signature, or IP allowlist) instead of user sessions, and be reviewed carefully before accessing or mutating data.
- Validate all input fields explicitly (type, range, format). Do not trust client payloads.
- Use `NextResponse.json()` for all responses. Return appropriate HTTP status codes.
- Parse JSON fields (like `tags`) defensively with try/catch — database rows may contain malformed data from older versions.

### Database

- Prisma schema is the source of truth for **columns and relations**. **Merged** schema changes must ship with a committed migration. Some constraints (partial unique indexes, guarded DDL) live only in migration SQL — see **Local schema sync** below.
- Migrations must be **idempotent** (`ADD COLUMN IF NOT EXISTS`, etc.) to survive re-runs during deployment.
- After changing `schema.prisma`, always run `pnpm prisma generate` before testing types.
- Use `cuid()` for IDs. Dates are stored as `DateTime` and formatted as `YYYY-MM-DD` strings at the API boundary.
- **System Savings envelope:** created idempotently via `ensureSystemSavingsEnvelope()` on first session (see `lib/auth.ts`). Prisma `Envelope.systemRole = 'savings'`; reserved name `"Savings"`. Protected from rename, archive, merge, and delete in envelope API routes. **`activeEnvelopes`** includes Savings; **`discretionaryEnvelopes`** (`AppContext`) excludes it — use `discretionaryEnvelopes` for budget grids, sweep targets, and allotment totals.
- **`SavingsGoal`** rows keyed by `periodKey` (`'YYYY-MM'` or `'default'`). Per-period lifecycle (grace, upward-only edits, close snapshots) is enforced in `lib/savings-goal.ts` and the savings-goal API routes.

#### Local schema sync (`migrate deploy`, not `db push`)

**Default for local dev, CI, staging, and production:** apply committed migrations with **`pnpm exec prisma migrate deploy`** (requires `DATABASE_URL` and `DATABASE_URL_UNPOOLED` in `.env` / `.env.local`).

Use **`migrate deploy`** — not **`pnpm db:push`** — when:

- Pulling `main` or any branch with new migration folders.
- Starting the dev server, running e2e, or testing API routes against Postgres.
- The feature adds **raw SQL** Prisma cannot model (e.g. partial unique index on `Transaction.dedupeKey` for CSV import idempotency). `db push` syncs from `schema.prisma` only and may **drop** indexes/constraints that exist in the DB but not in the schema file.

**`db push` is only for rapid WIP iteration** on schema-only changes while a feature is still evolving and **before** a migration is committed — and only when you are not relying on migration-only DDL. Once a migration folder exists on the branch, switch to **`migrate deploy`**.

#### Schema changes during development

While a feature is still evolving, **do not** run `pnpm db:migrate` on every schema tweak. That creates migration files and checksum history that are painful to revise.

**Default loop (schema-only WIP, no committed migration yet):**

1. Edit `prisma/schema.prisma`.
2. Apply locally with **`pnpm db:push`** (optional shortcut — see **Local schema sync** for when to skip it).
3. Run **`pnpm prisma generate`** and continue building/testing.

**Once the shape is stable or includes raw SQL:**

1. Add an idempotent migration folder (hand-written or `pnpm db:migrate --name <descriptive_name>` with SQL edited for idempotency).
2. Apply with **`pnpm exec prisma migrate deploy`** locally and in CI — do not rely on `db push` afterward.

**Before creating a migration file, ask the maintainer:**

- **Create migration now** — schema shape is stable enough for CI, another developer, or a shared environment. Run `pnpm db:migrate --name <descriptive_name>`, then hand-edit the generated SQL for idempotency if needed (partial indexes, `IF NOT EXISTS`, etc.).
- **Wait until later** — still iterating on columns Prisma models directly; keep using `db push` only until PR finalization, then consolidate into committed migrations and use **`migrate deploy`**.

#### PR finalization: migrations (without resetting local dev data)

**Never edit a migration after it has been applied** (local, CI, staging, or prod). Prisma stores a checksum in `_prisma_migrations`; changing the file causes “migration was modified after it was applied” errors. For fixes after apply, add a **new** migration instead.

Before merge, the branch must have clean, reviewable migration(s) that match final `schema.prisma`. Consolidate WIP history **without** asking the developer to wipe their database:

1. **Confirm final schema** — `schema.prisma` on the branch is the intended end state (usually already true after `db push`).
2. **Consolidate migration folders** — if the branch has multiple experimental migrations that never reached `main`, replace them with one (or a few logical) idempotent migration(s):
   - Remove superseded migration folders from the branch (only those not yet on `main`).
   - Create fresh SQL for the feature, e.g. `pnpm exec prisma migrate dev --create-only --name <feature>` against a DB at `main`'s migration baseline, or compose idempotent DDL by hand from the diff.
   - Ensure every statement is safe to re-run (`IF NOT EXISTS`, guarded `DO $$ … EXCEPTION … $$` blocks, etc.).
3. **Reconcile the maintainer's local DB** (preserve data):
   - If their DB already has the columns (from `db push` and/or WIP migrations), the consolidated migration should be a **no-op** on apply.
   - Delete `_prisma_migrations` rows for removed WIP migration names.
   - Mark the consolidated migration applied: `pnpm exec prisma migrate resolve --applied <migration_folder_name>`, or update the checksum row if the migration was already applied manually (see **Common Pitfalls**).
   - Verify with **`pnpm exec prisma migrate deploy`** — expect pending migrations to apply cleanly or “Already in sync”, not a reset prompt.
4. **PR checklist** — migration(s) committed with schema + code; PR description notes **`pnpm exec prisma migrate deploy`** for deploy targets and local setup after merge.

CI, fresh clones, and **local dev after merge** use **`prisma migrate deploy`**; idempotent consolidated migrations must apply cleanly from `main`'s baseline.

## Feature Gating: Opportunity Cost

**Only opportunity cost is gated.** Ledger funding (pay-yourself-first, Savings envelope, allocation legs) is **always on** for every user regardless of tier or entry point. Do not add flags or UI that disable the ledger.

Bitcoin/sats/opportunity-cost features are controlled by `User.opportunityCostEnabled` (default `false`). New users get it from **entry point**: `/welcome` or app shell `/` → off; `/landing` → on. **Referral referees** inherit the flag from the **referrer** (code owner) at redeem and during onboarding via validate. **Premium** users can change it in Settings; free users do not see that control.

**Savings narrative UI** (hero card, goals, streaks, achievements, year-end recap) is controlled separately by `User.savingsExperience` (`engaged` | `dismissed`). When dismissed, the underlying ledger and Savings envelope still work; only motivational surfaces are hidden.

When `opportunityCostEnabled` is off, the app is a **vanilla budgeting tool** — no Bitcoin mentions anywhere:

- Sidebar: BTC Price nav item hidden
- Dashboard: chart shows "Your Expenses" (cumulative spent, single line, no BTC data dependency); `RecentTransactions` replaces `TopOpportunityCosts`
- Dashboard metrics: only Monthly Income + Monthly Spend tiles
- Analytics: Opportunity Cost bar chart hidden
- Transaction tables: Amount (sats) and Opportunity Cost columns hidden
- Transaction detail dialog: BTC section hidden
- Settings: Opportunity Cost + BTC Display toggles hidden for free tier (premium-only)
- Favicon: switches dynamically between Bitcoin icon and vanilla envelope icon

When adding **any** Bitcoin, sats, or opportunity-cost content, wrap it with `state.opportunityCostEnabled`. The vanilla experience must be completely clean of BTC references.

Onboarding no longer has a separate opportunity-cost step; the flag is saved from `sessionStorage` `onboardingSource` (`btc` from `/landing`, otherwise vanilla). Premium users toggle in Settings.

## Financial Runway (bitcoin feature)

**Runway** answers "how long would my money last if I stepped back from work, and what does it take to get there?" It blends the user's cash, their bitcoin, and a short questionnaire into a plan with a **cash gap** and a **bitcoin gap**. It is a **bitcoin experience**: all Runway UI is gated behind `state.opportunityCostEnabled`. The ledger (pay-yourself-first, Savings envelope) and `savingsExperience` are **independent** — Runway never turns either on or off, and a dismissed savings experience does not hide Runway.

### Mix and questionnaire defaults

The persisted plan lives in `RunwayPlan` and is served by `GET`/`PUT /api/runway/plan`. Server defaults are the **middle path** (`RUNWAY_PLAN_DEFAULTS` in `lib/runway-plan.ts`): `dipResponse: "cut"`, `btcSharePreference: "half"`, `borrowStance: "deep_drop"`, `inflationRateYear: 0.05`, `stressPercent: 0.5`, `horizonMonths: 24`, `growthRateYear: null`. These must match the Prisma column defaults.

The setup wizard (`components/runway-setup-dialog.tsx`) **pre-selects** middle-path answers so a user can finish fast, but any answer the user actually picks is a **user-specific choice**, not a default — do not treat a selected/highlighted answer in the UI as "the default", and do not overwrite a saved answer with a default on re-open. `PUT` replaces the whole row, so echo unspecified fields back (`buildPlanPutBody` in `lib/runway-ui.ts`) rather than resetting them.

### Known totals and overrides

Runway resolves holdings from the budget: **envelope cash** = Savings remaining + discretionary remaining (all-time, genesis-floored), and **wallet sats** from the client watch list (`runwayWalletSats` in `lib/wallet-confirmed-sats.ts`, stored in `localStorage` under `bitbudget-wallet-watch:<userId>` and cleared on logout). An exchange watch that still shows coins in an open sale is reduced by that sale so those sats live only in the placeholder. A typed **override replaces one side only**: `cashOverrideUsd` replaces the cash total, `bitcoinOverrideSats` replaces the bitcoin total; the other side still comes from the budget. See `knownCashUsd` / `knownBitcoinSats` in `lib/runway-ui.ts` and the holdings resolution in `computeRunwayNeed`. Descriptors (address or xpub) stay in the browser. No server route accepts them. Address watch (`components/runway-address-watch.tsx`) looks up confirmed sats from mempool.space in the browser and warns that a single address misses change and that the explorer sees the address with the user's IP. Seeds and private keys are rejected. Chain rows are not spending and not income until the user marks a spend (`chainActivityCountsAsSpending`).

Plaid depository balances (`depositoryCashUsd`) are a bank snapshot on the connection card. They do **not** replace envelope remaining. Plaid inflows are stored as **credits** (`plaidAmountToLedger`: positive Plaid amount = money out). Credit-card rows show what is owed and stay out of that cash sum.

### Cash floor vs required bitcoin — keep them separate

The **cash floor** (months of spending kept in cash before leaning on bitcoin) and the **required bitcoin** (sats needed to fund the draw over the horizon) are reported as **two independent gaps** everywhere (`cashGapUsd` and `bitcoinGapUsd`). A bold bitcoin target must never mask a short cash floor, and vice-versa. `gapSummaryLine` phrases them as distinct shortfalls; the gap math (`lib/runway-gap.ts`) fills the cash floor **first**, then buys bitcoin, and keeps the bitcoin side Infinity-safe (a 100% stress drop yields an Infinity bitcoin requirement, never NaN).

### Loans are balloon loans

Tracked bitcoin-backed loans (`BtcLoan`, `GET`/`POST`/`DELETE /api/runway/loans`) are **balloon loans**: the user pays the bill at **maturity** (`maturityOn`), not as a monthly draw. `payoffStyle` is `accrued` (interest-to-date) or `full_bill` (fixed maturity bill). Collateral sats a lender holds (`collateralSats` → `lenderHeldSats`) are still the user's **bitcoin exposure** for the mix; the amount due (`amountDueUsd`) is a **liability** that reduces the stack. Do not model loan repayment as a recurring monthly expense in the draw.

### Journal is ciphertext

Monthly checkup reflections (`RunwayJournal`) store an **encrypted body only**. The client encrypts the note like a transaction note before sending; the server stores and returns the opaque string and never decrypts or inspects it (`lib/runway-journal.ts` validates `encryptedBody` as an opaque bounded string). Never write decrypted journal text to drafts, logs, alerts, or PRs.

### Posting semantics (stack moves — not income or spending)

A Runway **stack move** rearranges the user's stack (cash + bitcoin + loan liability) without being income the user earned or money they spent. The contract:

- **Selling bitcoin is a conversion into cash** (`TX_SOURCE_BTC_SALE_CONVERSION`). It is **excluded from income and from the savings goal** — it changes the form the stack is held in, it does not grow net worth.
- **Loan open / roll / payoff / liquidation** (`TX_SOURCE_LOAN_OPEN` / `_ROLL` / `_PAYOFF` / `_LIQUIDATION`) move the stack together (cash ↔ liability ↔ collateral). None of these legs are income or spending.

`lib/runway-posting.ts` is the single source of truth for these source sets and predicates (`isBtcSaleConversion`, `isLoanStackMove`, `isRunwayStackMove`, `classifyRunwayPosting`, and the `countsAs…` contract predicates). Enforcement relies on two mechanisms:

- **Allowlists stay narrow.** Income (`MONTHLY_INCOME_SOURCES`), savings inflow (`SAVINGS_INFLOW_SOURCES`), and cash-inflow (`CASH_INFLOW_SOURCES`) are allowlists — runway stack-move sources are deliberately **not** in them, so conversions/loan moves never count as income or savings-goal credits. A Vitest asserts they remain absent.
- **Spending is denylisted.** `isUserFacingExpense` (`lib/transaction-visibility.ts`) excludes runway stack moves alongside funding legs and internal transfers, so a loan payoff/liquidation or sale proceeds leg can never leak into Monthly Spend, spend charts, or OC totals. This does **not** change existing funding-leg visibility.

If you add a new runway source, add it to the appropriate set in `lib/runway-posting.ts` (and the `TransactionSource` union / `TX_SOURCE_*` constants) — do **not** add it to any income/savings/cash-inflow allowlist.

### Default stress from drawdowns

A **new** plan's `stressPercent` (the crash-test drop used by `computeRunwayNeed`) can be seeded from how far bitcoin has actually fallen, instead of always starting at the middle `0.5`. `lib/runway-stress.ts` (`suggestStressFromPrices` / `suggestedStressPercent`) walks the trailing **`STRESS_WINDOW_YEARS` (4y, ~one halving cycle)** of a daily price series, takes the **max peak-to-trough drawdown**, and **clamps it to `[STRESS_MIN, STRESS_MAX]` = `[0.30, 0.70]`**. With too little history (fewer than `STRESS_MIN_POINTS` in-window points or under `STRESS_MIN_SPAN_DAYS` of span) it returns `STRESS_DEFAULT` (`0.5`) and `sufficient: false`.

`useRunway` derives `suggestedStressPercent` from `useBtcPrices().priceHistory` and passes it to `RunwaySetupDialog`, which seeds it **only for a brand-new plan** (`!isRunwayConfigured(plan)`). An already-configured plan keeps its saved, possibly user-edited, stress — **never overwrite user-edited stress**. The questionnaire's dip-response bands remain labels; this does not change the risk-profile math.

### Key libraries (pure math + glue)

| Module | Responsibility |
|--------|----------------|
| `lib/runway-plan.ts` | Plan types, middle-path defaults, body validation (no throw, plain-language errors) |
| `lib/runway-posting.ts` | Posting semantics: stack-move classification + income/savings/spend contract predicates |
| `lib/runway-stress.ts` | Suggest a default stress percent from historical BTC drawdowns (banded, degrades to middle) |
| `lib/runway-risk.ts` | Questionnaire → risk profile (target bitcoin share, cash-floor months, borrow cap) |
| `lib/runway-need.ts` | Core need math: monthly draw, resolved holdings, required cash + required bitcoin, months-left at spot/stress/growth |
| `lib/runway-gap.ts` | Quit-day projection: where cash/bitcoin land, separate cash and bitcoin gaps, scenario closures |
| `lib/runway-expense-impact.ts` | Expense-impact previews: savings-goal out-of-reach / behind-pace and months-left delta (pure, degrades silently) |
| `lib/runway-checkup.ts` | Monthly checkup readiness and summary |
| `lib/runway-journal.ts` | Encrypted journal validators (ciphertext only) |
| `lib/loan-health.ts` | Loan evaluation: amount due today, liquidation room, rollover coverage |
| `lib/btc-loan.ts` | Loan row ↔ loan-health input mapping |
| `lib/runway-ui.ts` | UI glue: plan→computation, summary strings, PUT body builder (pure, unit-tested) |
| `lib/use-runway.ts` | Client hook: loads plan + loans, resolves holdings, exposes `compute(scenarioMode)` |

All of the `lib/runway-*` math is pure (no React/Prisma/network) and shared by server and client; add or extend Vitest in `lib/__tests__/runway-*.test.ts` whenever you change behavior.

## Encryption Rules

These are **non-negotiable**:

- `Transaction.payee` and `Transaction.notes` are **always encrypted** at the client before storage.
- CSV import parses and encrypts on the client side before sending to the server.
- Backend-sourced transactions (Plaid, email, SMS) encrypt sensitive fields using the user's public key via `lib/server-encrypt.ts`. These arrive as `PendingTransaction` for client-side review and decryption.
- Never add `console.log` or logging that would print decrypted user data, encryption keys, PINs, or passwords.
- The `encryptForStorage` function in `AppContext` and the `decryptFieldAsymmetric` helper used in refresh/add flows are the canonical entry points for client-side encryption and decryption.

## Privacy key custody & safeguard (expected behavior)

**Goal:** The server must never be able to decrypt user transaction fields. The **privacy key** (NaCl seed) lives only on the client; the server may store a **wrapped** copy (`User.encryptedPrivacyKey`, optional `User.privacyKeySalt` for passphrase users). Nostr accounts may also have `User.nostrPubkey`; the wrap can be NIP-04 to that pubkey or PIN-derived AES for nsec-fallback.

### `POST /api/user/encryption` — no silent overwrites

Implementation: `app/api/user/encryption/route.ts`.

- If `encryptedPrivacyKey` is already **non-empty**, the handler returns **409** with `ENCRYPTION_ALREADY_CONFIGURED` and does **not** replace the blob. This applies to **both** email/passphrase and Nostr-linked accounts (the check is before Nostr-specific branching).
- Updates use `updateMany` with `emptyKeyWhere`: only rows where `encryptedPrivacyKey` is **null or `""`** can be written. First-time setup only.
- **Do not** weaken these guards for “convenience.” Accidental re-onboarding or a bug that shows **Secure Your Data** again must **not** rotate keys through this route.

| Situation | Server replaces existing wrapped key? |
|-----------|--------------------------------------|
| User already has non-empty `encryptedPrivacyKey`; onboarding/security UI submits again | **No** — 409 |
| Nostr extension user wrongly submits PIN/passphrase on a security screen | **No** — same 409 if a key exists |
| `encryptedPrivacyKey` is **null/empty** (setup never completed) | **Yes** — first successful POST may set it (by design) |
| `encryptedPrivacyKey` is **corrupt** (non-empty garbage) | **No** in-app fix via this route; user is stuck until **recovery** (below) |

### Session vs server

- Client caches the raw privacy key hex in **`localStorage` with a 7-day rolling expiry** (`bitbudget-privacy-key`, `bitbudget-privacy-user`, `bitbudget-privacy-unlock-expires`) via `lib/privacy-key-storage.ts`; legacy `sessionStorage`-only entries migrate on read. Falls back to `sessionStorage` if `localStorage` is unavailable. Import and other flows may re-hydrate via NIP-04 decrypt using the extension (`lib/resolve-import-encrypt-fn.ts`, `lib/app-context.tsx`). Keys are cleared on `userId` mismatch, expiry, or logout. **Security:** readable by any script on the origin—raw key here widens XSS blast radius versus session-only cache; rely on a strict CSP, no unsafe-inline, and dependency hygiene. `resolveEncryptFnForImport` skips `getSession()` when no cached key material exists so import avoids an extra `/api/auth/session` round-trip.
- Losing session storage does **not** mean losing the account if the wrapped key on the server is valid and the user can still decrypt (passphrase / NIP-04).

### Recovery (product direction — not fully built)

If keys are **lost** or **mismatched** (undecryptable blob), the generic onboarding `POST` must **not** be the fix.

1. **Destructive reset** — After strong identity proof (email OTP, Nostr-signed challenge, etc.), ops or a dedicated endpoint clears `encryptedPrivacyKey` / `privacyKeySalt` and runs a **single** controlled re-setup flow. **All existing server ciphertext** for that user tied to the old privacy key becomes **unreadable**; UX must state that clearly.
2. **Re-key / rotate (non-destructive)** — User proves identity, then in-session: decrypt with old key, generate new privacy key, re-wrap for server, **batch re-encrypt** all encrypted fields (or a background job). Preserves data; heavier to build.
3. **Support / admin** — Manual repair (wrong `nostrPubkey` vs ciphertext), restore from backup, or reset flags **only** with explicit user consent.

When designing new endpoints, **never** allow replacing `encryptedPrivacyKey` without explicit recovery semantics and user understanding of data loss or migration.

## Envelope Archiving and Deletion

These are two distinct operations with different ledger semantics:

- **Archive** (`archived: true`) — hides the envelope from the active budget grid (`activeEnvelopes` excludes it) but **keeps its transactions in the ledger**. Archived-envelope transactions remain in `activeTransactions` and therefore count toward Monthly Spend, charts, and analytics. Users can restore or permanently delete archived envelopes from the Envelopes page.
- **Soft-delete** (`deletedAt: DateTime`) — initiated by "Delete" from the archived section. Sets a server-side timestamp and **excludes the envelope's transactions from `activeTransactions`** (and therefore from all spend analytics and charts). The envelope is hidden from all active views and shows in a "Recently deleted" section for up to 30 days (`ENVELOPE_DELETE_GRACE_DAYS`). Restoring clears `deletedAt` and returns the envelope and its transactions to the ledger. A daily purge cron (`/api/cron/envelope-purge`) hard-deletes envelopes whose `deletedAt` is older than the grace window.
- **Hard-delete** (cron purge only, or `DELETE ?all=true` for full data reset) — permanently removes the envelope and cascades to transactions, recurring rules, and payee mappings. `TransactionShortcut` and `PendingTransaction.suggestedEnvelopeId` are cleaned up explicitly (no cascade).

**Key invariants:**
- `activeEnvelopes` = envelopes where `!archived && !deletedAt`
- `activeTransactions` = transactions whose envelope does not have `deletedAt` set
- The system Savings envelope cannot be archived, soft-deleted, or hard-deleted via user-facing routes.
- `DELETE /api/envelopes?id=` performs a soft-delete (sets server-timestamped `deletedAt`); `PUT /api/envelopes` with `deletedAt: null` restores; non-null `deletedAt` values are rejected (clients cannot back-date deletes).
- Restoring an envelope whose `deletedAt` is older than `envelopeDeletePurgeCutoff()` returns HTTP 410.

## Observability and alerting

Production ops visibility uses **Sentry** (stack traces), **`GET /api/health`** (uptime monitors), and **`lib/alert.ts`** (Discord, Telegram, email to DB admins). See [docs/ops/triage.md](docs/ops/triage.md) and the **triage** Cursor skill (`.cursor/skills/triage/SKILL.md`).

**Privacy guardrails (non-negotiable for ops telemetry):**

- Never log or alert on decrypted payee/notes, encryption keys, PINs, `encryptedPrivacyKey`, or raw request bodies.
- Sentry `beforeSend` and `scrubAlertText` in `lib/sentry-scrub.ts` redact emails, npubs/nsecs, tokens, and sensitive header names.
- Health checks and ops events must not include user identifiers beyond hashed/internal IDs when absolutely necessary.
- `E2E_TEST=true` skips outbound Discord/Telegram/email alerts but still persists `OpsEvent` rows for CI.

**When investigating production issues:** use `pnpm ops:health`, `pnpm ops:errors`, and `pnpm ops:crons` (see runbook). Admin ops dashboard: `/admin/ops`.

## Parallel agents and git isolation

Work in the **primary clone** by default (dev server + IDE). **One task → one branch → one concern**. **Worktrees are opt-in**: use one only when the maintainer asks, or when colliding sessions would clobber a shared tree — when unsure, stay primary and ask. Do not use `git stash` as agent handoff — commit WIP to a topic branch instead. Detail: [`.cursor/rules/agent-git-hygiene.mdc`](.cursor/rules/agent-git-hygiene.mdc).

Passive maintenance: `.cursor/hooks.json` runs a **dry-run** `git-prune` on session start and writes `.cursor/git-prune-status.md`. Never auto-`--apply`.

## Commit and PR Workflow

### Branches and commits

- **Commit often.** Each logical unit of work (a bug fix, a feature slice, a refactor) gets its own commit. Don't batch unrelated changes.
- **Commit messages** should be concise and describe the "what" and "why": `fix(receipts): validate file type from magic bytes, not Content-Type` or `feat: add vanilla "Your Expenses" chart for non-OC users`.
- **Agents: commit only when the maintainer asks.** Do not create commits proactively; if intent is unclear, ask first.
- **Do not continue work directly on non-feature branches.** If the current branch is not a feature branch (for example `main`, a release branch, or another shared integration branch), create a feature branch from the tip of `main` before committing/pushing.
- **Large features:** slice into stacked, reviewable PRs per the [feature-slice skill](.cursor/skills/feature-slice/SKILL.md); keep each commit scoped to one layer or one slice.

### Push and pull requests

- **When the maintainer says a code change "looks good" or otherwise approves the work, push the committed changes to the upstream branch.**
- **After pushing a feature branch, ensure a PR exists.** If there is no open PR for the branch, open one against `main`.
- **Keep PR descriptions current.** If newly pushed changes are not described in the PR body, update the PR description to explain what changed and how it fits the broader purpose of the branch.
- **PR descriptions** should have a Summary (bullet points of what changed) and a Test Plan (checkboxes).
- **Never force-push to main.**

### Before you push

- **Run `pnpm lint`, `pnpm test`, and `pnpm test:e2e`** (e2e needs Postgres + env; CI runs all three).
- **Unit-test incrementally** — add or update tests alongside the code (see **Testing**); don't rely on manual checks alone for production-critical behavior.
- **Never commit secrets or user data** — no `.env` / `.env.local`, nsec, privacy keys, service tokens, decrypted exports, or personal transaction CSVs.

### Schema and migrations

- **Schema during development:** optional **`pnpm db:push`** only for early WIP on schema-modeled columns before a migration exists; once migrations are committed (especially raw SQL / partial indexes), use **`pnpm exec prisma migrate deploy`** locally (see **Database → Local schema sync**). Ask the maintainer whether to **`pnpm db:migrate`** now or defer until PR finalization.
- **Before merge:** consolidate branch migrations into clean idempotent file(s) and reconcile the maintainer's local `_prisma_migrations` without a full DB reset (see **Database → PR finalization**).
- **Database migrations** on the merged branch must be committed alongside the schema change and the code that uses the new field.

### Cursor plan bookkeeping

When a Cursor plan is **fully implemented** (all todos done, verification passed):

1. **Rename the plan file** by inserting `_done` before the `.plan.md` extension — e.g. `fix_review-inbox_build_607a6e40.plan.md` → `fix_review-inbox_build_607a6e40_done.plan.md`.
2. Do this **at the end of the session** that completes the plan, before moving on to unrelated work.
3. **Do not edit the plan body** to mark completion; the `_done` suffix is the source of truth for backlog tracking.
4. Plans live under **`~/.cursor/plans/`** (Cursor’s user-level plan directory — canonical home for BitBudget). Do **not** write plans under the repo’s `.cursor/plans/` unless the user explicitly asks for a workspace copy. Leave unimplemented plans unchanged so the maintainer can tell at a glance which backlog items remain.

### Addressing open PR review comments

When a maintainer asks the agent to address open comments on a PR:

1. **Evaluate accuracy** — Read each comment in context and decide whether the concern is valid.
2. **Decide on a fix** — Implement a code change when warranted; skip changes when the comment is incorrect or already handled (document why).
3. **Reply on the thread** — Post a brief reply on behalf of the maintainer: what was fixed, or why no change is needed. Keep replies factual and concise.
4. **Commit and push** — Land valid fixes on the PR branch with tests/lint as appropriate; push so CI runs on the updated branch.
5. **Leave threads unresolved** — Do **not** resolve review threads. The maintainer will groom and resolve them after review.

Use `gh api graphql` (`addPullRequestReviewThreadReply`) for replies. Do not call `resolveReviewThread` unless the maintainer explicitly asks to resolve threads.

## Common Pitfalls

- **Adding a Prisma field but forgetting `pnpm prisma generate`** — TypeScript won't see the new field until the client is regenerated.
- **Calling `useBtcPrices()` outside `BtcPriceProvider`** — the hook returns **`NOOP_PRICES`** and warns in development; it does not throw. Real prices and OC math need `BtcPriceProvider`; gate Bitcoin UI with `state.opportunityCostEnabled` so vanilla mode does not depend on live BTC data.
- **Rendering Savings inside the discretionary envelope grid** — use `<SavingsHeroCard>` instead. Grid lists, sweep dialogs, and allotment math should use `discretionaryEnvelopes`, not `activeEnvelopes`.
- **`activeEnvelopes` vs `discretionaryEnvelopes`** — `activeEnvelopes` includes the system Savings envelope; `discretionaryEnvelopes` filters `systemRole !== 'savings'`. Use the latter for budget envelopes; use Savings-specific helpers (`findSavingsEnvelope`, hero card) for the hub.
- **Gating ledger funding or Savings accounting** — there is no ledger toggle. Gate motivational Savings UI with `state.savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED`; never tie funding to `opportunityCostEnabled`.
- **Month-scoped balance for “remaining”** — `getEnvelopeBalance(..., monthKey)` only counts the current calendar month, so it **under-reports spendable money** when carry-forward or capped policy leaves balance from prior months (and diverges from server sweep math). Use `getEnvelopeBalanceAllTime` for “$X left”, dashboard **Remaining**, Savings totals, and sweep UI; reserve month scope for Monthly Income/Spend, goal periods, and pacing markers (see **Envelope balances: remaining vs current month**).
- **Counting funding legs as user spending** — `envelope_funding_out` rows are `type: "expense"` with `excludeFromMainHistory: true`. Never feed them into spend charts, Monthly Spend, or OC totals. Use `isUserFacingExpense()` / `buildCumulativeSpendingSeries()` and cap series at `todayUtcIso()`. Deleting an income header must cascade the whole `fundingBatchId` (see **Transaction visibility, analytics, and lifecycle**).
- **Forgetting to encrypt a new sensitive field** — if you add a field to `Transaction` that contains user-identifiable data, it must be encrypted client-side before storage.
- **Non-idempotent migrations** — `ALTER TABLE ... ADD COLUMN` will fail on re-deploy if the column already exists. Always use `IF NOT EXISTS`.
- **Editing an applied migration** — Prisma checksums migration files; edits after apply block `migrate dev` / `migrate deploy`. Do not rewrite shipped migrations. During early dev, `db push` is optional for schema-only tweaks; after migrations land, use **`migrate deploy`**. If only the file changed but DDL is unchanged, updating `_prisma_migrations.checksum` is a local-dev escape hatch — not a substitute for adding a new migration when schema DDL actually changed.
- **`db push` after partial-index migrations** — `db push` syncs from `schema.prisma` only. It can **drop** migration-only objects (e.g. `Transaction_userId_dedupeKey_key` partial unique index on CSV import dedupe). Use **`pnpm exec prisma migrate deploy`** instead.
- **`db:migrate` on every schema tweak** — creates migration churn and checksum traps. Use **`db push`** only for early schema-only iteration; create migration files when the maintainer agrees or at PR finalization, then **`migrate deploy`**.
- **Stale encryption keys** — switching accounts or clearing data can leave cached keys in `sessionStorage`. The `EncryptionGate` and `PinUnlockDialog` handle re-prompting; don't bypass them.
- **`POST /api/user/encryption` and existing keys** — see **Privacy key custody & safeguard**; 409 prevents overwrites. Onboarding must handle 409 in `handleSecuritySetup`. Nostr nsec storage: intent `bitbudget-nsec-onboarding-intent`; pending raw key is **in-memory only** until PIN encrypts to `bitbudget-nsec` (JSON iv+ciphertext in localStorage). Legacy `bitbudget-pending-nsec` session key is cleared on `clearPendingNsec`. Logout clears pending/intent and localStorage nsec keys.
- **`colSpan` mismatch** — when conditionally rendering table columns (e.g. hiding BTC columns in vanilla mode), update the empty-state row's `colSpan` accordingly.
- **New setup guide tasks and `SETUP_GUIDE_TRANSACTION_TASK_IDS`** — transaction-driven goals must be listed there or txn edits won’t refresh the checklist; long-running non-txn goals must stay off the list or every txn change rescans until 100%. See **Setup guide & walkthrough** under Code Conventions.
- **`react-hooks/set-state-in-effect`** — don’t call `setState` synchronously inside `useEffect` / `useLayoutEffect`; it triggers lint and risks extra renders or cascading updates. See **React effects and `setState`** under Code Conventions for patterns (derive during render, defer with `requestAnimationFrame` / `setTimeout(0)`, refs).
- **Resetting `onboardingComplete` for users who already have `encryptedPrivacyKey`** — never rely on onboarding to rotate keys. `PUT /api/user/settings` must not accept `encryptedPrivacyKey` / `privacyKeySalt`. Prefer **Skip onboarding** and correct step routing; corrupt keys need a **recovery** path, not a silent `POST` overwrite.
- **`E2E_TEST` in Vercel Preview/Production** — disables all `lib/notify.ts` outbound email/DM; leaves users thinking notifications are broken. Only Playwright should set it (see `playwright.config.ts`).
- **Conflating notification email with sign-in email** — notification addresses use `UserNotificationEmail` and `/api/user/notification-email`; sign-in linking uses `/api/user/sign-in-methods` and `User.email`. Nostr-only users linking mail for **notifications** does not require the sign-in privacy dialog.
- **`BITBUDGET_NOSTR_NSEC` exposure** — server-only env; never `NEXT_PUBLIC_` or client bundles. Rotate if leaked.
- **Missing `min-w-0` in flex/grid layouts** — a child row (tabs, toolbars, input+button pairs) expands the page horizontally on phones. Add `min-w-0 w-full max-w-full` down the layout chain, or stack on mobile. **`overflow-x-auto` without a bounded parent does not fix this.**
- **Smart defaults silently overwriting user choices** — envelope suggestions, payee inference, and similar features must never update a value the user has already set. Always maintain a `manuallySetRows` / `touched` exclusion set and gate all automated writes behind it. See **Smart defaults must never overwrite explicit user choices** under Code Conventions.
- **Desktop-first breakpoints** — building a wide horizontal layout by default and only wrapping at `lg`/`md` often breaks between 320–640px. Default to mobile layout; enhance upward with `sm:` / `md:` / `lg:`.
- **Fixed padding and min-widths on cards** — uniform `p-6` plus wide inner flex rows can clip buttons and text on 390px-wide screens. Use responsive padding and `flex-col sm:flex-row` for compound controls.
- **Multi-field flow without draft persistence** — any non-trivial input flow must follow the **Input persistence for multi-field flows** convention. Closing a dialog must not silently destroy in-progress work; provide **Clear All** with confirmation.
- **Nested dialog dismiss closes the parent** — guarding the parent with `editOpen` state alone is not enough: Radix may call the parent `onOpenChange(false)` after the child already set state to closed. Use a **ref updated synchronously** when opening/closing children, defer clearing it with `setTimeout(0)`, and follow **Nested dialogs and modal stacks** (nest inside parent content, `preventDefault` on outside interact, `stopPropagation` on Cancel/Escape).

## Cursor Cloud-specific instructions

### Services overview

| Service | How to run | Notes |
|---------|-----------|-------|
| PostgreSQL | `sudo pg_ctlcluster 16 main start` | Required. Must be running before dev server or tests. |
| Next.js dev server | `pnpm dev` | Runs on port 3000. |
| Unit tests | `pnpm test` | Vitest; no DB required. |
| Lint | `pnpm lint` | ESLint with `--max-warnings 0`. |
| E2E tests | `pnpm test:e2e` | Requires PostgreSQL + Playwright browsers. Builds and runs on port 3100. Do not run while `pnpm dev` is active (lock conflict). |

### Environment setup

- **PostgreSQL** is required but not Docker-based. Install via `apt-get install postgresql postgresql-client` and start with `sudo pg_ctlcluster 16 main start` (no systemd in Cloud VMs).
- **Prisma CLI** reads `.env` (not `.env.local`). Create a symlink once so CLI commands pick up `.env.local`: `ln -sf .env.local .env` (skip if `.env` already exists and points at the right file).
- **`.env.local`** must contain at minimum: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `AUTH_SECRET`. For E2E testing, also add `E2E_TEST="true"` and `E2E_EMAIL_CODE="424242"`.
- After `pnpm install`, run `prisma migrate deploy` (not `prisma migrate dev`, which prompts interactively) to apply pending migrations non-interactively.

### Testing with E2E mode

- Set `E2E_TEST="true"` and `E2E_EMAIL_CODE="424242"` in `.env.local` to enable fixed OTP login for `@bitbudget.test` email addresses. This also suppresses outbound email/Nostr DM notifications.
- Playwright e2e global setup runs `prisma migrate deploy` and seeds fixtures automatically.
- Install Playwright browsers once. Use the same command as in **End-to-end (Playwright)** (`pnpm exec playwright install`); on Cursor Cloud VMs, use **`pnpm exec playwright install chromium --with-deps`** so Chromium’s system libraries are installed via apt, matching CI.

### Gotchas

- The `pnpm install` postinstall hook runs `prisma generate` automatically, so no separate generate step is needed after install.
- `pnpm.onlyBuiltDependencies` in `package.json` handles native dependency build approvals non-interactively — do not run `pnpm approve-builds`.
- The Next.js dev server hot-reloads code changes but does **not** pick up new `.env.local` values without a restart.

## Learned User Preferences

- When implementing from a Cursor plan file (`~/.cursor/plans/*.plan.md`), do not edit the plan — use the pre-created todos and mark them in_progress/completed as you work.
- For large feature branches, split work into logical commits before push and opening a PR.
- When test-coverage gaps are identified for new shared logic, write the missing unit and e2e tests in the same session rather than deferring (if the user asks to write tests, implement them — do not stop at a coverage summary).
- Onboarding and similar money inputs should normalize on blur or when changing steps (strip meaningless leading zeros, coerce empty to zero) so values like `000100000` cannot persist after navigating forward and back.

## Learned Workspace Facts

- Local dev pins Node 22 via `.nvmrc`; run `nvm use` before `pnpm` when the shell reports Node 18 or below (Playwright and the app require Node ≥ 20).
- Remaining (all-time) discretionary and Savings balances apply a **genesis floor**: only transactions with `date >= envelopeGenesisFloor(envelope.createdAt)` count. `envelopeGenesisFloor` in `lib/data.ts` is one UTC calendar day before `createdAt` (timezone cushion). Pre-genesis rows stay in transaction lists but must not drive new envelopes negative after historical CSV or income imports.
- Client remaining UI passes `envelopeGenesisFloor(createdAt)` into `getEnvelopeBalanceAllTime` (see `lib/savings-ui-metrics.ts`, envelope pages, sweep dialog). Server sweep/funding uses the same rule in `lib/envelope-balance-server.ts` (`envelopeBalancesBeforeBatch`, `savingsEnvelopeBalanceAllTime`, `savingsEnvelopeBalanceBefore`, month-end batch helpers).
- Envelope API responses include `createdAt` as `YYYY-MM-DD` so clients can compute the genesis floor.
- CSV import idempotency: the client derives a per-row `dedupeKey` via HMAC in `lib/import-dedupe-key.ts` using the privacy-key seed hex (server never sees the seed); large imports POST in chunks; the server skips rows with an existing key.
- `@noble/hashes` v2 subpath imports must use explicit `.js` suffixes (e.g. `@noble/hashes/hmac.js`).
- Ledger `TX_SOURCE_*` constants belong in `lib/constants.ts`, not `envelope-funding.ts`, to avoid circular imports with `envelope-balance-server.ts`.
- Rules engine: `AccountRule` + `/api/account-rules`; logic in `lib/account-rules.ts` and `lib/rule-engine-client.ts`; Settings Rules UI at `#/settings/payee-rules` (`components/rules-settings.tsx`).
- Rules engine tests: `lib/__tests__/rule-engine-client.test.ts`, `lib/__tests__/account-rules.test.ts`, and `e2e/rules-settings.spec.ts`.
- **Recurring funding rules:** `RecurringFundingRule` stores scheduled income distribution / move-funds configs (`nextRunAt`). Executed by `processAllRecurringFundingRules()` from the daily **envelope-funding** cron (`/api/cron/envelope-funding`). Distinct from `RecurringTransaction` + `/api/cron/recurring` (user transaction templates).
- `savingsBalance()` in `lib/savings-ui-metrics.ts` takes the Savings `Envelope` (or `undefined`), not `envelopeId` — pass `findSavingsEnvelope(...)`, not `.id`.
- **Rebalance vs Move to/from Savings:** Both use `createRebalanceBatch` in `lib/rebalance-envelopes.ts` (same rebalance API). **`balanced`** mode only creates discretionary envelope ↔ envelope transfer pairs (Savings is not debited/credited by those legs). **`independent`** mode is used when the Savings path or “fund from Savings” is on: each envelope net change is paired with Savings out/in legs so Savings can fund envelopes or absorb money moved back.
