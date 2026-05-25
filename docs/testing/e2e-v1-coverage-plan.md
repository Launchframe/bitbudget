# E2E v1 coverage plan

This document defines the **Playwright end-to-end contract** for BitBudget v1: what CI must enforce before merge, how specs map to product areas, and how we grow coverage from the current baseline without covering paid third-party integrations in this pass (see [e2e-integrations-strategy.md](./e2e-integrations-strategy.md)).

## Cloud / CI verification (May 2026)

The full suite was run successfully in a cloud agent environment matching GitHub Actions:

| Prerequisite | Value |
|--------------|--------|
| PostgreSQL 16 | `bitbudget_e2e` database on `127.0.0.1:5432` |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | `postgresql://postgres:postgres@127.0.0.1:5432/bitbudget_e2e` |
| `AUTH_SECRET` | ≥ 32 characters |
| Build | `pnpm exec next build` then `PW_WEBSERVER_SKIP_BUILD=true pnpm test:e2e` |
| Result | **41 passed** (~54s test time with v1 implementation branches merged) |

Local/cloud setup steps (when `.env` is missing):

1. Install PostgreSQL and create `bitbudget_e2e`.
2. Copy env vars from [.github/workflows/test.yml](../../.github/workflows/test.yml) into `.env.local`.
3. `pnpm install --frozen-lockfile`
4. `pnpm exec playwright install chromium --with-deps`
5. `pnpm exec next build` (or let Playwright build via default `PW_WEBSERVER_COMMAND`)
6. `pnpm test:e2e`

Playwright config: [`playwright.config.ts`](../../playwright.config.ts). Global setup runs `prisma migrate deploy` plus referral, recurring, and app seeds.

## Current baseline (41 tests)

| Spec | Tests | What it locks in |
|------|-------|------------------|
| `e2e/landing-auth.smoke.spec.ts` | 2 | `/welcome` → auth; fresh email → onboarding |
| `e2e/onboarding.income-matrix.spec.ts` | 4 | Regular, irregular (bounded/unbounded), mixed income modes |
| `e2e/onboarding.import-branches.spec.ts` | 3 | Skip import, CSV with existing envelopes, new envelope → budget step |
| `e2e/envelopes.lifecycle.spec.ts` | 1 | Create, edit, merge, archive, restore, permanent delete |
| `e2e/envelopes.archive.spec.ts` | 1 | Archive undo, restore, permanent delete |
| `e2e/transactions.filters.spec.ts` | 1 | Search, type, envelope pill, tag filters |
| `e2e/new-transaction.manual-entry.spec.ts` | 1 | No payee prefill; typing not cleared |
| `e2e/new-transaction.features.spec.ts` | 3 | Tag on expense, recurring upcoming, save shortcut |
| `e2e/payee-mappings.spec.ts` | 1 | Manual mapping in settings |
| `e2e/analytics.ranges.spec.ts` | 2 | Range chips; vanilla vs OC chart gating |
| `e2e/settings.tabs.spec.ts` | 5 | Tags CRUD, OC/BTC toggles, savings dismiss, import dialog, `@mobile` overflow |
| `e2e/receipt-scan.prefill.spec.ts` | 2 | Mocked scan → PNG/PDF prefill |
| `e2e/recurring.lifecycle.spec.ts` | 1 | Seeded due rule in list + upcoming |
| `e2e/referrals.program.spec.ts` | 13 | Validate/redeem API, activation, OC inheritance |
| `e2e/walkthrough.per-user.spec.ts` | 1 | Per-user `walkthroughCompleted` in DB |

**Seeds:** `e2e/seed-referral-e2e.ts`, `e2e/seed-recurring-e2e.ts`, `e2e/seed-app-e2e.ts`; reset via `POST /api/e2e/reset-referral-seed` (referrals). Onboarding tests use `POST /api/e2e/delete-user` for `@bitbudget.test` cleanup.

**Helpers:** `e2e/helpers/auth-email.ts`, `onboarding.ts`, `app-session.ts`, `e2e-user.ts`, `fetch-json.ts`, `privacy-cache.ts`.

**Fixtures:** `e2e/fixtures/encryption-e2e-constants.ts` (passphrase `4242`), `onboarding-e2e-constants.ts`, `onboarding-import*.csv`, `app-e2e-constants.ts`.

**Deferred (documented, not in CI yet):** `/landing` btc source smoke, duplicate-guard txn (MT-07), payee review banner (PAY-03–05), smart payee suggestion (MT-06), export download bytes (SET-06), Nostr/nsec auth, savings dismiss during onboarding.

## History-driven priorities (commits & merged PRs)

Recent merged work that **must** stay protected by e2e (many only have unit tests today):

| Theme | Representative PRs | E2E risk if untested |
|-------|---------------------|----------------------|
| Onboarding + CSV import loop fix | #16, ledger #34, savings #38 | Wrong step order, allocation loop, irregular income branches |
| Referral + OC inheritance | #24, #37 | Redeem/settings flags, vanilla vs BTC onboarding source |
| Payee aliases + manual entry | #25, #35 | Payee cleared on type, mapping banner, import mismatch |
| Duplicate guard | #33 | “Save anyway” vs blocked duplicate |
| Recurring | #26 | Due processing, Post Now, upcoming strip |
| Analytics expansion | #28 | Range chips, OC chart gating |
| Account linking | #32 | Privacy warning, linked methods |
| Savings as core mechanic | #38, #34 | Savings hero, dismiss tracking, ledger always on |
| Walkthrough persistence | #43 | Per-user DB flag, not localStorage |
| Settings responsive | #40 | Mobile overflow (viewport specs at 390px where relevant) |

## Architecture notes for authors

- **Routing:** After sign-in, navigation is hash-based (`#/transactions`, `#/settings/tags`). Use `page.goto(\`${origin}/#/…\`)` and wait for domain copy, not only URL.
- **Encryption:** Onboarding specs call `completeOnboardingSecurity` with passphrase `4242` from `e2e/fixtures/encryption-e2e-constants.ts`. Seeded app users use the same wrap; `primePrivacyKeyCache` avoids PIN dialog on dashboard load.
- **Parallelism:** `fullyParallel: false`, `workers: 1` — design seeds to be idempotent per describe block.
- **API from browser:** Use `page.evaluate` + `fetch(..., { credentials: 'include' })` for session cookies (see `referrals.program.spec.ts`); `page.request` may not carry the session jar reliably.
- **Do not enable `E2E_TEST` in production.**

---

## 1. Landing → authentication → onboarding

**Entry routes**

| Path | Role |
|------|------|
| `/welcome` | Vanilla positioning; sets `sessionStorage.onboardingSource = 'vanilla'` |
| `/landing` | Bitcoin positioning; sets `onboardingSource = 'btc'` |
| `/auth` | Email OTP (e2e bypass), Google/GitHub/Nostr |
| `/onboarding` | Full wizard (`app/onboarding/page.tsx`) |

**Suggested flow specs**

### 1.1 Marketing → auth (smoke)

| ID | Scenario | Assertions |
|----|----------|------------|
| L-01 | `/welcome` → Get Started → `/auth` | No `bitbudget_visited` until successful sign-in |
| L-02 | `/landing` → sign-in | `onboardingSource` is `btc` after init script or navigation |
| L-03 | Email OTP happy path | Lands on `/` or `/onboarding` when `onboardingComplete: false` |

Use `signInWithE2eEmail` with **fresh** `@bitbudget.test` emails (unique per test) created via seed or `prisma.user.create({ onboardingComplete: false })`.

### 1.2 Onboarding — income mode matrix (required)

Three modes via `aria-pressed` toggles: **Regular paycheck**, **No regular income**, **Mixed timing**.

| ID | `incomeMode` | Extra inputs | Expected server/API |
|----|--------------|--------------|---------------------|
| ONB-I-01 | `regular` | Paycheck + cadence (e.g. Monthly) | `PUT /api/user/settings` with computed `monthlyIncome`, `payCadence` ≠ irregular |
| ONB-I-02 | `irregular` | No annual estimate | `monthlyIncome: 0`, unbounded allocation UI (“estimated monthly spend”) |
| ONB-I-03 | `irregular` | Annual estimate e.g. `$60,000` | `estimatedAnnualIncome` set, bounded budget ≈ `annual/12` |
| ONB-I-04 | `mix` | Paycheck **and** optional annual | `payCadence: "mixed"`, monthly income includes both components |

**Continue** on income step hits `handleIncomeSave` → `PUT /api/user/settings`.

### 1.3 Onboarding — irregular sub-branches

Covered by ONB-I-02 and ONB-I-03. Additionally assert:

- Sliders on **Your budget** are uncapped (irregular, no estimate) vs capped (with estimate or regular/mix).
- Savings goal copy references “estimated monthly spend” when unbounded.

### 1.4 Onboarding — import vs no import

| ID | Path | Steps | Assertions |
|----|------|-------|------------|
| ONB-IMP-01 | No import | **Import Transactions** step → **Skip** / **Continue** without file | Reaches **You're All Set!** without `POST /api/import` |
| ONB-IMP-02 | CSV import | Attach fixture CSV → **Import & Continue** | Mock or stub `POST /api/import`; dialog **Import Complete** |
| ONB-IMP-03 | Import → dashboard | Complete import, no new envelopes | **Done** / **Skip** → complete → **Go to Dashboard** → `#/dashboard` |
| ONB-IMP-04 | Import → back to allocations | CSV creates new envelope names | **Back to envelopes** → heading **Your budget** (allocations step), not envelope naming step |

Use a small fixture under `e2e/fixtures/onboarding-import.csv` with columns `Date, Envelope, Name, Amount`.

### 1.5 Onboarding — security & referral (abbreviated v1)

| ID | Scenario |
|----|----------|
| ONB-SEC-01 | Web2 new user: **Secure Your Data** passphrase → `POST /api/user/encryption` success → income |
| ONB-REF-01 | Skip referral → security; optional second spec applies code via cookie/API |
| ONB-OC-01 | `onboardingSource: btc` → complete → user `opportunityCostEnabled: true` (API or Settings later) |

**Defer:** Live Nostr extension, Plaid **Connect your bank** on referral-bank step (integration doc).

### 1.6 Onboarding — savings narrative branch

| ID | Action | Expected |
|----|--------|----------|
| ONB-SAV-01 | **Not for me — I'll stick to my budget** on savings goal | `savingsExperience: dismissed`, `sweepDefaultPolicy: carry_forward` |
| ONB-SAV-02 | Set savings goal % → continue | `PUT /api/user/savings-goal` |

### 1.7 Proposed spec files

- `e2e/onboarding.income-matrix.spec.ts` — ONB-I-* (parameterized)
- `e2e/onboarding.import-branches.spec.ts` — ONB-IMP-*
- `e2e/landing-auth.smoke.spec.ts` — L-*

**Shared helper:** `e2e/helpers/onboarding.ts` — `advanceToIncome(page)`, `completeSecurityWithPassphrase(page, pin)`, `finishOnboardingToDashboard(page)`.

---

## 2. Envelope management

**UI:** `components/envelopes-page.tsx`, allocations: `envelope-allocations-page.tsx`.

| ID | Operation | Key UI | API |
|----|-----------|--------|-----|
| ENV-01 | Create | **Add Envelope** → **New Envelope** → **Create Envelope** | `POST /api/envelopes` |
| ENV-02 | Read / filter | Card shows `{name}`, `{balance} left`; click → `#/transactions` + envelope pill | — |
| ENV-03 | Update | **Edit** → **Save Changes** | `PUT /api/envelopes` |
| ENV-04 | Merge | **Merge** → pick target → confirm | `POST /api/envelopes/merge` |
| ENV-05 | Archive | **Archive** → toast **Undo** | `PUT` with `archived: true` |
| ENV-06 | Restore | **Archived (n)** → **Restore** | `archived: false` |
| ENV-07 | Permanent delete | Archived only → **Delete Forever** | `DELETE /api/envelopes?id=` |
| ENV-08 | System Savings | No edit/archive/merge on Savings hero | API 403 if attempted |

**Seed:** User with 2+ discretionary envelopes + archived envelope for restore/delete tests.

**Spec:** `e2e/envelopes.lifecycle.spec.ts`

---

## 3. Transactions page and filters

**UI:** `components/transactions-page.tsx`.

| ID | Filter | Selector / behavior |
|----|--------|---------------------|
| TX-F-01 | Search | `placeholder="Search existing transactions..."` |
| TX-F-02 | Type | **Expenses** / **Credits** / **Income** |
| TX-F-03 | Date range | Two `type="date"` inputs |
| TX-F-04 | Envelope pills | **Savings** gold pill; discretionary names; **Clear** |
| TX-F-05 | Tags | Tag pills + **Clear** |
| TX-F-06 | Mobile | `aria-label="More filters"` at 390px viewport |
| TX-F-07 | Export | **Export** triggers download (assert download event) |
| TX-F-08 | Row → detail | Click row → transaction detail dialog |
| TX-F-09 | Delete row | `aria-label="Delete transaction …"` |

**Seed:** Recurring user plus extra transactions/tags across envelopes.

**Spec:** `e2e/transactions.filters.spec.ts`

---

## 4. Payee mapping

**UI:** `payee-mappings-settings.tsx`, `payee-mapping-review-banner.tsx`, inline in `new-transaction-dialog.tsx`.

| ID | Scenario |
|----|----------|
| PAY-01 | Settings **Payee mappings** tab: manual **Save mapping** (`#payee-map-source` → canonical) |
| PAY-02 | **Saved mappings** list shows `From X → Y`; remove mapping |
| PAY-03 | Transactions banner: **Map to this payee** / **Ignore this spelling** |
| PAY-04 | New txn: alias hint “Using your saved payee…” after typing known variant |
| PAY-05 | Deep link: `sessionStorage` / hash `#/settings/payee-mappings` from banner CTA |

**Spec:** `e2e/payee-mappings.spec.ts`

---

## 5. Manual transaction entry (v1 — no GPT smart import)

**Existing:** payee typing, receipt prefill (mocked scan).

| ID | Feature | UI |
|----|---------|-----|
| MT-01 | Submit expense | Fill payee, amount, envelope → **Add Expense** → row in table |
| MT-02 | Recurring | **Recurring** sub-view → **Enable Recurring** → cadence → **Add Recurring Expense** |
| MT-03 | Post now | From **Upcoming Recurring** → **Post Now** |
| MT-04 | Tags | **Tags** sub-view → select/create tag |
| MT-05 | Shortcuts | **Save as shortcut**; chip in **Shortcuts** section |
| MT-06 | Smart payee suggestion | Type partial payee → pick suggestion → envelope auto-selected |
| MT-07 | Duplicate guard | Same amount/date/payee → **Possible duplicate** → **Save anyway** |
| MT-08 | Payee mapping save | Import mismatch → **Save payee mapping** |

**Defer to later pass:** Voice parse, GPT receipt parsing (real `OPENAI_API_KEY`), income importer smart flows.

**Specs:** extend `new-transaction.manual-entry.spec.ts` or add `e2e/new-transaction.features.spec.ts`.

---

## 6. Analytics

**UI:** `components/analytics-page.tsx`.

| ID | Scenario |
|----|----------|
| AN-01 | Range chips **MTD**, **1M**, **3M**, **12M**, **YTD**, **All** update charts (`aria-pressed`) |
| AN-02 | Sections visible: **Daily Activity**, **Cash Flow**, **By Envelope** |
| AN-03 | Vanilla user: **Opportunity Cost** section **hidden** |
| AN-04 | OC user (`opportunityCostEnabled: true`): **Opportunity Cost** chart visible |
| AN-05 | **Month Overlay** / savings chart when savings engaged |

**Seed:** Premium or settings-flag OC user; user with multi-month txn history (fixture seed).

**Spec:** `e2e/analytics.ranges.spec.ts`

---

## 7. Settings

**UI:** `components/settings-page.tsx` tabs.

| ID | Tab | Scenario |
|----|-----|----------|
| SET-01 | General | **Opportunity Cost** toggle (premium seed) |
| SET-02 | General | **BTC Display** Sats/BTC when OC on |
| SET-03 | Savings tracking | **Show Savings tracking** off → confirm dialog → dismissed experience |
| SET-04 | Tags | **Add Tag** / delete tag |
| SET-05 | Integrations | **Import Transactions** opens CSV dialog (smoke; no full import required) |
| SET-06 | Data & Security | **Export transactions** download |
| SET-07 | Data & Security | **Linked sign-in methods** section visible; link flow mocked or skipped |
| SET-08 | Payee mappings | Cross-ref PAY-* |

**Do not test in v1 e2e:** Plaid Link UI, live receipt inbox delivery, SMS/email webhooks (see integrations strategy).

**Spec:** `e2e/settings.tabs.spec.ts` (+ viewport 390px subtests for tab list overflow)

---

## Additional v1 recommendations

| Area | IDs | Notes |
|------|-----|-------|
| Dashboard walkthrough | WT-02 | Dismiss/skip; already have completion persistence |
| Savings hero | SAV-01 | Engaged vs dismissed hides goals; ledger balances still visible |
| Duplicate + collision | Dup-01 | Covered in MT-07; align with unit tests in `lib/__tests__/` |
| Hash cold load | NAV-01 | `#/envelope/{id}` redirects per product rules |
| Premium gating smoke | PRE-01 | Free user does not see OC toggle; premium does |

---

## Implementation phases

| Phase | Scope | Specs | Tests | Branch (stacked PRs) |
|-------|--------|-------|-------|----------------------|
| **0** | ✅ Baseline | 5 legacy files | 18 | `main` |
| **1** | ✅ Onboarding + landing | `landing-auth`, `onboarding.*` | 9 | `cursor/e2e-phase1-foundation-8992` → `main` |
| **2** | ✅ Envelopes + app seed | `envelopes.*`, `seed-app-e2e` | 2 | `cursor/e2e-phase2-envelopes-8992` → phase 1 |
| **3** | ✅ Transaction filters | `transactions.filters` | 1 | `cursor/e2e-phase3-transactions-8992` → phase 2 |
| **4** | ✅ Manual txn features | `new-transaction.features` | 3 | `cursor/e2e-phase4-new-transaction-8992` → phase 3 |
| **5** | ✅ Payee mappings | `payee-mappings` | 1 | `cursor/e2e-phase5-payee-mappings-8992` → phase 4 |
| **6–7** | ✅ Analytics, settings, mobile | `analytics.ranges`, `settings.tabs` | 7 | `cursor/e2e-phase6-settings-analytics-8992` → phase 5 |

**Full stack:** `cursor/e2e-v1-implementation-8992` (all phases, 41 tests). Merge stacked PRs in order or merge the full branch once reviewed.

**Follow-up for v1.1:** duplicate guard, payee banner, export assertion, `/landing` smoke, Nostr fixture (see deferred list above).

---

## Fixtures & infrastructure

| Asset | Status |
|-------|--------|
| `e2e/helpers/onboarding.ts` | ✅ Step navigation, passphrase setup |
| `e2e/fixtures/encryption-e2e-constants.ts` | ✅ Deterministic privacy key wrap |
| `e2e/seed-app-e2e.ts` | ✅ App + premium users, envelopes, txns, tags |
| `e2e/fixtures/onboarding-import*.csv` | ✅ Import branch tests |
| `POST /api/e2e/delete-user` | ✅ `@bitbudget.test` cleanup for onboarding |
| `e2e/seed-onboarding-e2e.ts` | Optional partial-progress users (not added) |
| `POST /api/e2e/reset-*` (beyond referral) | Optional per-suite resets |

---

## Test plan checklist (PR template)

When adding specs, include in PR **Test Plan**:

- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e` (all new specs)
- [ ] Viewports checked: 1280 (default), 390, 320 for UI-heavy specs
- [ ] No real Plaid / Twilio / SendGrid / OpenAI calls in CI
- [ ] New seeds documented in this file

---

## Related docs

- [e2e-integrations-strategy.md](./e2e-integrations-strategy.md) — Plaid, receipt inbox, SMS, email (mocked / sandbox)
- [recurring-qa.md](./recurring-qa.md) — manual recurring QA
- [ci.md](../ci.md) — required GitHub checks
