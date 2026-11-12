---
name: ledger-feature
description: Build features that touch envelopes, Savings, funding, sweeps, goals, dashboard metrics, or cron. Use when adding ledger logic, balance helpers, sweep policy, payday cadence, savings goals, achievements, or any UI surface that displays "$X left" / Remaining / Savings totals.
---

# BitBudget ledger features

Read [AGENTS.md](../../../AGENTS.md) **"Savings as core mechanic"** and **"Envelope balances: remaining vs current month"** before editing. The traps below are the bugs that made the Savings rollout (PR #34, #38) take multiple Copilot rounds; each maps to a real fix.

## Non-negotiables

- **Ledger is always on.** Do not add a toggle or flag that disables funding, the Savings envelope, or allocation legs. There is no `ledgerFundingEnabled`.
- **Savings is a UI primitive, not a discretionary envelope.** Use `<SavingsHeroCard>`, `findSavingsEnvelope()`, `discretionaryEnvelopes` (excludes Savings) for grids, sweep targets, allotment totals.
- **`savingsExperience`** gates narrative UI only (hero, goals, recap, streak, sweep ritual). When `dismissed`, ledger keeps working; `sweepDefaultPolicy` defaults to `carry_forward`.
- **`opportunityCostEnabled`** gates all BTC/sats copy, columns, and chart modes. Vanilla mode has zero Bitcoin references.

## Balance scope (remaining vs current month)

| Use this for | Helper |
|---|---|
| "$X left", Remaining/Balance label, Savings total, sweep amounts, dashboard Remaining tile | `getEnvelopeBalanceAllTime`, `savingsBalance`, `sumRemainingDiscretionary`, `envelopeBalancesAllTimeBatch` (server) |
| Monthly Income / Monthly Spend, savings-goal period math, spend analytics buckets | `getEnvelopeBalance(tx, envId, monthKey)` |
| Progress bar fill | `envelopeBudgetProgressPct` (uncapped) + `envelopeHealthColor` from `lib/envelope-card-metrics.ts` |
| Pacing marker (day-of-month) | `monthProgressMarkerPct`, `targetBalanceForMonthPace` in `lib/envelope-sweep.ts` |

**Server and client must agree on scope.** Sweep/funding decisions use all-time; remaining UI must too. Month-scoped balance on a "Remaining" label silently ignores carry-forward and capped surplus from prior months.

## Sweep policies

| Policy | Server sweep amount | Suggested manual sweep (UI) |
|---|---|---|
| `reset` (default) | balance − (1.0 × monthlyAllotment) | balance − `targetBalanceForMonthPace` |
| `capped` | balance − (capMultiplier × monthlyAllotment) | same as server |
| `carry_forward` | 0 (auto) | balance − monthlyAllotment (manual only) |

`suggestedManualSweepAmount` in `lib/envelope-sweep.ts` is the single source for manual sweep math. `resolveEffectiveSweepPolicy` resolves envelope-level → user default → `reset`.

## Pay cadence

- Biweekly **requires** `lastPaydayAt` anchor (`isPaydayForUser` returns false without it).
- `daily` is dev-only — gated by `isDailyCadenceBlocked` / `INTERNAL_PAY_CADENCES`.
- Cron user query narrows irregular/mixed off non–goal days — see `fundingCronUserWhere` / `shouldRunFundingCronForUser` in `lib/funding-cron-schedule.ts`.
- Goal close/open runs **UTC 1st only** (`isGoalMaintenanceDay`).
- New cadence rules go in **one helper** in `lib/payday-cadence.ts` — never duplicate in funding/sweep/cron.

## API + DB

- Validate body shape before Prisma. Wrap `req.json()` in try/catch → 400 Invalid JSON. Coerce `id` to non-empty string. Use `coerceDecimal12_2Input` / `validateDecimal4_2Positive` for amounts persisted as `@db.Decimal`.
- User-scoped routes: `const session = await auth()` → 401 if missing; every Prisma filter includes `userId: session.user.id`.
- Schema during iteration: `pnpm db:push` only. Migration files happen at PR finalization with idempotent DDL (`IF NOT EXISTS`, backfill before `SET NOT NULL`).

## Encryption

- Backend-created transactions (paycheck, sweep, irregular income, import) encrypt sensitive fields via `encryptFieldForUser(text, publicKey)` before insert. Never store plain payee/notes for ledger legs.
- User-facing API errors use plain language, never "encryption keys" / "configured" jargon (see AGENTS.md → User-facing copy).

## Pre-PR self-audit

Run these searches; each match is a likely bug:

```
rg "getEnvelopeBalance\(" components/ app/             # month-scoped balance in UI — should be AllTime for "Remaining"
rg -i "encryption.*configured|encryption keys"          # API error jargon
rg "#D4AF37"                                            # hardcoded Savings gold — use SAVINGS_GOLD_ACCENT
rg "opportunityCostEnabled" components/                 # ensure BTC UI is gated
rg "savingsExperience" components/                      # narrative UI must be gated when dismissed
```

Then:

```
pnpm prisma generate
pnpm lint
pnpm test -- lib/__tests__/<area>.test.ts
pnpm test
```

## Tests to add

- `lib/__tests__/<area>.test.ts` — every new helper in `lib/`.
- Carry-forward case for any new balance helper (Jan funding+spend, Feb funding+spend → all-time ≠ month-scoped).
- Cadence test for any new payday branch (`lib/__tests__/payday-cadence.test.ts`).
- Cron schedule test if the cron loop changes (`funding-cron-schedule.test.ts`).
- Vanilla mode test: feature stays clean of BTC copy when `opportunityCostEnabled` is false.

## Common pitfalls

See AGENTS.md → **Common Pitfalls** for the full list. The recurring ones during Savings:

- `activeEnvelopes` (includes Savings) vs `discretionaryEnvelopes` (excludes it)
- Month-scoped balance for "Remaining" labels
- Cron loops doing per-envelope DB queries — use `*Batch` helpers
- Forgetting to gate BTC UI with `opportunityCostEnabled`
- Editing applied Prisma migrations (always add a new one)
