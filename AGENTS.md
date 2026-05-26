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

- **Layout:** Specs live under `e2e/` (see `playwright.config.ts`). Referral-program coverage is in `e2e/referrals.program.spec.ts` (validate/redeem flows, settings flags, `activateReferral` / trial months, referral-code API, auth via email OTP). **`e2e/new-transaction.manual-entry.spec.ts`** covers opening New Transaction with **no payee prefill** and typing in the payee field (guards against regressions where keystrokes were cleared). **`e2e/receipt-scan.prefill.spec.ts`** mocks **`POST /api/receipts/scan`** and asserts PNG/PDF upload flows open New Transaction with prefilled fields (and image receipt preview for PNG).
- **Commands:** `pnpm exec playwright install` once per machine (CI installs Chromium automatically). Run `pnpm test:e2e` (or `pnpm test:e2e:ui`). Locally Playwright runs `next build` then `next start` on port **3100** by default (see `playwright.config.ts`) so it does not fight `next dev`’s `.next/dev/lock` — **GitHub Actions** runs **`pnpm exec next build`** as its own workflow step (clear failure logs) and sets **`PW_WEBSERVER_SKIP_BUILD`** so Playwright only runs **`next start`** — **avoid running `pnpm test:e2e` while `pnpm dev` is building/watching the same tree**, or override `PW_WEBSERVER_COMMAND` (e.g. `PW_WEBSERVER_COMMAND="pnpm dev"` on port `PW_SERVER_PORT` after stopping the other dev). **`config.webServer` uses stdout/stderr `pipe`** so `next build` / `next start` logs appear in the test runner (Playwright does not forward `inherit` for web servers). Use **`PW_WEBSERVER_STDIO=ignore`** to silence them; **`DEBUG=pw:webserver`** adds Playwright web-server debug logs. If you see “Process from config.webServer was not able to start”, check `.env`/`.env.local` for **`DATABASE_URL`** (global setup), **`AUTH_SECRET`** (≥32 chars), and **`DATABASE_URL_UNPOOLED`** per CI; confirm nothing else is bound to **`PW_SERVER_PORT`** (default **3100**). The server runs with `E2E_TEST=true` so `/api/auth/send-code` accepts fixed OTPs for addresses ending in `@bitbudget.test` (see `app/api/auth/send-code/route.ts`), and `lib/notify.ts` skips all outbound email/Nostr DMs so referral and cron-style notifications do not hit real inboxes. **Never set `E2E_TEST` in production.**
- **Database:** E2E requires PostgreSQL (`DATABASE_URL` and `DATABASE_URL_UNPOOLED`; `AUTH_SECRET` ≥ 32 chars). Global setup runs `prisma migrate deploy` and reseeds referral fixtures (`e2e/seed-referral-e2e.ts`) plus recurring QA fixtures (`e2e/seed-recurring-e2e.ts`).
- **Manual recurring QA:** See [docs/testing/recurring-qa.md](docs/testing/recurring-qa.md) (staging DB bump, `pnpm qa:recurring:bump`, and the checklist). **`pnpm test`** includes `lib/__tests__/recurring.test.ts`; **`e2e/recurring.lifecycle.spec.ts`** covers a signed-in `@bitbudget.test` user with a due seeded rule.
- **Local referral code (manual QA):** When asked for a referral code for local/staging testing, run **`pnpm referral:admin-code`** (`scripts/print-admin-referral-code.ts`). It ensures a valid user referral code owned by the earliest `createdAt` admin (reuses an active unused code or creates one via `ensureUserReferralCode`). Prints the code on **stdout** (owner line on stderr); capture with `CODE=$(pnpm referral:admin-code 2>/dev/null)`. Requires **`DATABASE_URL`**. If no admin exists, promote one with **`ADMIN_EMAILS`** + **`pnpm db:seed-admin`** first.
- **Maintenance:** When you change referral rules, Plaid activation, onboarding gates, auth email flow, **transaction dialog prefill / payee canonicalization**, manual entry UX, or **layout/navigation on core pages** (settings tabs, mobile nav, onboarding steps), **update or extend the Playwright specs and seed constants** so CI keeps enforcing the product contract. Treat failing e2e the same as failing unit tests.
- **Responsive checks:** Playwright runs at a desktop viewport by default. For layout-heavy UI changes, **manually verify at 390px and 320px** (DevTools device mode) before merge; add or extend e2e viewport coverage when a regression has happened or the layout contract is easy to assert (e.g. no document scroll width exceeding viewport on settings).
- **Pull requests:** **`pnpm lint`, `pnpm test`, and `pnpm test:e2e` should all pass** before a change is considered ready to merge (unless a PR explicitly documents an exception and follow-up).
- **Outbound messaging QA:** Changing `lib/notify.ts`, `lib/email.ts`, `lib/nostr-dm.ts`, notification-email APIs, or communication preferences requires updating [docs/outbound-messaging.md](docs/outbound-messaging.md) when behavior or env vars change, and extending `lib/__tests__/notify-e2e-skip.test.ts` (or related tests) for routing regressions.

## Code Conventions

### Imports
- Keep imports at the top of every file. No inline `import()` inside functions or render bodies.
- Use `@/` path aliases (`@/lib/...`, `@/components/...`).

### Components
- Components that use React hooks, local state, or browser-only APIs must be client components (include the `"use client"` directive at the top of the file). Purely presentational components that don't rely on client-only features can be server components.
- Page-level components live in `components/` (e.g. `dashboard-page.tsx`, `transactions-page.tsx`).
- The app uses hash-based routing managed by `AppContext` (`navigateTo`, `currentPage`), not the Next.js file-based router, for in-app navigation after auth.
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
- BTC numeric values use `font-ibm-plex-mono` class for monospace rendering.
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

- Prisma schema is the source of truth. **Merged** schema changes must ship with a committed migration; **in-progress** work uses `db push` first (see below).
- Migrations must be **idempotent** (`ADD COLUMN IF NOT EXISTS`, etc.) to survive re-runs during deployment.
- After changing `schema.prisma`, always run `pnpm prisma generate` before testing types.
- Use `cuid()` for IDs. Dates are stored as `DateTime` and formatted as `YYYY-MM-DD` strings at the API boundary.
- **System Savings envelope:** created idempotently via `ensureSystemSavingsEnvelope()` on first session (see `lib/auth.ts`). Prisma `Envelope.systemRole = 'savings'`; reserved name `"Savings"`. Protected from rename, archive, merge, and delete in envelope API routes. **`activeEnvelopes`** includes Savings; **`discretionaryEnvelopes`** (`AppContext`) excludes it — use `discretionaryEnvelopes` for budget grids, sweep targets, and allotment totals.
- **`SavingsGoal`** rows keyed by `periodKey` (`'YYYY-MM'` or `'default'`). Per-period lifecycle (grace, upward-only edits, close snapshots) is enforced in `lib/savings-goal.ts` and the savings-goal API routes.

#### Schema changes during development (`db push`)

While a feature is still evolving, **do not** run `pnpm db:migrate` on every schema tweak. That creates migration files and checksum history that are painful to revise.

**Default loop:**

1. Edit `prisma/schema.prisma`.
2. Apply locally with **`pnpm db:push`** (updates the dev DB without migration files).
3. Run **`pnpm prisma generate`** and continue building/testing.

**Before creating a migration file, ask the maintainer:**

- **Create migration now** — schema shape is stable enough for CI, another developer, or a shared environment. Run `pnpm db:migrate --name <descriptive_name>`, then hand-edit the generated SQL for idempotency if needed.
- **Wait until later** — still iterating; keep using `db push` only and defer migration files until PR finalization.

**Never edit a migration after it has been applied** (local, CI, staging, or prod). Prisma stores a checksum in `_prisma_migrations`; changing the file causes “migration was modified after it was applied” errors. For fixes after apply, add a **new** migration instead.

#### PR finalization: migrations (without resetting local dev data)

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
   - Verify with **`pnpm db:migrate`** — expect “Already in sync”, not a reset prompt.
4. **PR checklist** — migration(s) committed with schema + code; PR description notes `pnpm prisma migrate deploy` for deploy targets.

CI and fresh clones use `prisma migrate deploy`; idempotent consolidated migrations must apply cleanly from `main`'s baseline.

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

## Envelope Archiving

Deleting an envelope **archives** it (`archived: true`). Archived envelopes and their transactions are filtered out of active views via `activeEnvelopes` and `activeTransactions` in `AppContext`. Users can view, restore, or permanently delete archived envelopes from the Envelopes page.

## Commit and PR Workflow

- **Commit often.** Each logical unit of work (a bug fix, a feature slice, a refactor) gets its own commit. Don't batch unrelated changes.
- **Commit messages** should be concise and describe the "what" and "why": `fix(receipts): validate file type from magic bytes, not Content-Type` or `feat: add vanilla "Your Expenses" chart for non-OC users`.
- **When the maintainer says a code change "looks good" or otherwise approves the work, push the committed changes to the upstream branch.**
- **Do not continue work directly on non-feature branches.** If the current branch is not a feature branch (for example `main`, a release branch, or another shared integration branch), create a feature branch from the tip of `main` before committing/pushing.
- **After pushing a feature branch, ensure a PR exists.** If there is no open PR for the branch, open one against `main`.
- **Keep PR descriptions current.** If newly pushed changes are not described in the PR body, update the PR description to explain what changed and how it fits the broader purpose of the branch.
- **Run `pnpm lint`, `pnpm test`, and `pnpm test:e2e` before pushing** (e2e needs Postgres + env; CI runs all three).
- **Unit-test incrementally** — add or update tests alongside the code (see **Testing**); don’t rely on manual checks alone for production-critical behavior.
- **PR descriptions** should have a Summary (bullet points of what changed) and a Test Plan (checkboxes).
- **Never force-push to main.**
- **Schema during development:** use **`pnpm db:push`**; ask the maintainer whether to **`pnpm db:migrate`** now or defer until PR finalization (see **Database → Schema changes during development**).
- **Before merge:** consolidate branch migrations into clean idempotent file(s) and reconcile the maintainer's local `_prisma_migrations` without a full DB reset (see **Database → PR finalization**).
- **Database migrations** on the merged branch must be committed alongside the schema change and the code that uses the new field.

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
- **Forgetting to encrypt a new sensitive field** — if you add a field to `Transaction` that contains user-identifiable data, it must be encrypted client-side before storage.
- **Non-idempotent migrations** — `ALTER TABLE ... ADD COLUMN` will fail on re-deploy if the column already exists. Always use `IF NOT EXISTS`.
- **Editing an applied migration** — Prisma checksums migration files; edits after apply block `migrate dev` / `migrate deploy`. Do not rewrite shipped migrations. During dev, prefer **`db push`**; at PR time, consolidate into a new migration. If only the file changed but DDL is unchanged, updating `_prisma_migrations.checksum` is a local-dev escape hatch — not a substitute for adding a new migration when schema DDL actually changed.
- **`db:migrate` on every schema tweak** — creates migration churn and checksum traps. Use **`db push`** while iterating; create migration files when the maintainer agrees or at PR finalization.
- **Stale encryption keys** — switching accounts or clearing data can leave cached keys in `sessionStorage`. The `EncryptionGate` and `PinUnlockDialog` handle re-prompting; don't bypass them.
- **`POST /api/user/encryption` and existing keys** — see **Privacy key custody & safeguard**; 409 prevents overwrites. Onboarding must handle 409 in `handleSecuritySetup`. Nostr nsec storage: intent `bitbudget-nsec-onboarding-intent`; pending raw key is **in-memory only** until PIN encrypts to `bitbudget-nsec` (JSON iv+ciphertext in localStorage). Legacy `bitbudget-pending-nsec` session key is cleared on `clearPendingNsec`. Logout clears pending/intent and localStorage nsec keys.
- **`colSpan` mismatch** — when conditionally rendering table columns (e.g. hiding BTC columns in vanilla mode), update the empty-state row's `colSpan` accordingly.
- **`react-hooks/set-state-in-effect`** — don’t call `setState` synchronously inside `useEffect` / `useLayoutEffect`; it triggers lint and risks extra renders or cascading updates. See **React effects and `setState`** under Code Conventions for patterns (derive during render, defer with `requestAnimationFrame` / `setTimeout(0)`, refs).
- **Resetting `onboardingComplete` for users who already have `encryptedPrivacyKey`** — never rely on onboarding to rotate keys. `PUT /api/user/settings` must not accept `encryptedPrivacyKey` / `privacyKeySalt`. Prefer **Skip onboarding** and correct step routing; corrupt keys need a **recovery** path, not a silent `POST` overwrite.
- **`E2E_TEST` in Vercel Preview/Production** — disables all `lib/notify.ts` outbound email/DM; leaves users thinking notifications are broken. Only Playwright should set it (see `playwright.config.ts`).
- **Conflating notification email with sign-in email** — notification addresses use `UserNotificationEmail` and `/api/user/notification-email`; sign-in linking uses `/api/user/sign-in-methods` and `User.email`. Nostr-only users linking mail for **notifications** does not require the sign-in privacy dialog.
- **`BITBUDGET_NOSTR_NSEC` exposure** — server-only env; never `NEXT_PUBLIC_` or client bundles. Rotate if leaked.
- **Missing `min-w-0` in flex/grid layouts** — a child row (tabs, toolbars, input+button pairs) expands the page horizontally on phones. Add `min-w-0 w-full max-w-full` down the layout chain, or stack on mobile. **`overflow-x-auto` without a bounded parent does not fix this.**
- **Desktop-first breakpoints** — building a wide horizontal layout by default and only wrapping at `lg`/`md` often breaks between 320–640px. Default to mobile layout; enhance upward with `sm:` / `md:` / `lg:`.
- **Fixed padding and min-widths on cards** — uniform `p-6` plus wide inner flex rows can clip buttons and text on 390px-wide screens. Use responsive padding and `flex-col sm:flex-row` for compound controls.
