---
name: feature-slice
description: Plan and ship a large BitBudget feature as a stack of small reviewable slices. Use when starting a feature that spans schema, server logic, API routes, UI, and onboarding — e.g. PayPeriod/BudgetPeriod split, income importer rebuild, new integration, or any change touching more than ~5 files across layers.
---

# BitBudget feature slicing

Large features ship better as **stacked PRs in a fixed order**, not one mega-diff. The Savings rollout (PR #34 → #38) proved this: each layer surfaced its own class of Copilot comments, and stacking let earlier layers merge while later UI was still in flux.

## When to slice

Slice when any of these apply:

- Prisma schema change + new server logic + new UI
- New cron path or background job
- Cross-cutting flag (`opportunityCostEnabled`, `savingsExperience`)
- New domain term that needs AGENTS.md
- More than ~5 files touched across `lib/`, `app/api/`, `components/`

If it's a single bug fix or a one-file refactor, skip this skill.

## Slice order

Ship in this order. **Do not start slice N+1 until slice N has an open PR** (so review feedback shapes later slices).

### 1. `lib/` types + pure helpers

- Types in `lib/data.ts` or a new `lib/<area>.ts`
- Pure functions (no Prisma, no React)
- Vitest in `lib/__tests__/<area>.test.ts` for every branch
- **No UI, no API, no schema.** Just provable logic.

### 2. Schema + migration baseline

- Edit `prisma/schema.prisma`
- During iteration: `pnpm db:push` + `pnpm prisma generate` only
- Server helpers in `lib/<area>-server.ts` (Prisma queries, batch helpers)
- Add `lib/__tests__/<area>-server.test.ts` with mocked `prisma`
- **Defer the migration file** until PR finalization (AGENTS.md → Database)

### 3. API routes

- One route per slice when possible
- `auth()` → 401; `userId` on every Prisma filter
- Wrap `req.json()` in try/catch → 400 Invalid JSON
- Validate types/ranges/decimals before Prisma (`coerceDecimal12_2Input`, non-empty string `id`)
- Plain-language errors (no "encryption", no "configured")

### 4. AppContext + client helpers

- New state field in `lib/app-context.tsx` (with sensible default)
- Client-side helper module if needed (`lib/<area>-ui-metrics.ts`, `lib/<area>-card-metrics.ts`)
- Derive during render; don't `setState` in effects to mirror server data
- Vitest for new client helpers

### 5. UI surfaces — one at a time

Order matters. Each is its own commit (or PR for big features):

1. **Envelopes page / hero card**
2. **Dashboard metrics + chart**
3. **Settings card**
4. **Onboarding step** (if applicable)
5. **Transaction list / filters** (if applicable)

For every surface:
- Mobile-first (`min-w-0`, `w-full`, stacked on `<sm`)
- BTC content gated with `opportunityCostEnabled`
- Narrative content gated with `savingsExperience !== SAVINGS_EXPERIENCE_DISMISSED`
- `aria-*` complete on new controls

### 6. Cron / background work

- Add to `app/api/cron/<name>/route.ts` with `bearerMatches` auth
- Narrow the user query upfront (`Where` filters) — never load every user
- Skip irregular/mixed off scheduled days
- Add `lib/__tests__/<area>-cron.test.ts`

### 7. AGENTS.md

- Add a section for the new domain term (e.g. "Envelope balances: remaining vs current month")
- Add Common Pitfalls entries for the easy-to-miss rules
- Update Project Structure if new top-level dirs

### 8. e2e (Playwright)

Only when a **user-visible contract** changed (auth flow, manual entry, prefill, layout). Otherwise unit tests suffice.

## Slice PR template

Each PR description:

```
## Summary
- One bullet per behavior change
- Layer this slice covers (lib / server / api / ui / cron / docs)

## Test plan
- [ ] pnpm lint
- [ ] pnpm test
- [ ] pnpm test:e2e (if user contract changed)
- [ ] Manual: <specific viewport + flow>

## Follow-ups
- Next slice: <what comes next, links to plan doc>
```

## Plan doc

For features expected to span 5+ slices, write a plan to `.cursor/plans/<feature>_<hash>.plan.md` before starting. Include:

- Goal (one paragraph)
- Slice list with rough scope
- Schema delta (proposed)
- Open questions for the maintainer

Update the plan as slices ship.

## Anti-patterns

- **One PR with schema + server + UI + cron + onboarding.** Too big to review; Copilot feedback arrives after everything is already entangled.
- **UI before server.** Forces speculative API shapes that change later.
- **Skipping `lib/` tests because "the UI will catch it".** Logic bugs hide for months until a Copilot pass surfaces them.
- **Creating the migration file while still iterating on schema.** Use `db push` until shape stabilizes (AGENTS.md → Schema changes during development).
- **Starting slice N+1 before slice N has a PR.** Loses the staged review benefit and balloons context.

## Related skills

- [ledger-feature](../ledger-feature/SKILL.md) — domain rules for any slice that touches envelopes, Savings, funding, sweep, cron, goals.
- [triage](../triage/SKILL.md) — post-deploy incident response.
