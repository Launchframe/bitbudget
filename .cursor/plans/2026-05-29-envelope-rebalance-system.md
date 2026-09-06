---
name: Income & Rebalance Envelopes Overhaul
overview: 'Overhaul the "Add extra income" flow to stop auto-distributing funds, defaulting instead to savings. Add a user-controlled distribution step and a new reusable "Rebalance Envelopes" tool accessible from the Envelopes page.'
todos:
  - id: phase1-backend
    content: 'Modify irregular-income API + lib/envelope-funding.ts to support distributionMode param (savings-only path, explicit allocations path, distributionBehavior enum, fundOverageFromSavings flag)'
    status: pending
  - id: phase1-math
    content: 'Create lib/rebalance-math.ts with pure computation helpers for Set to Budget Amount, Add Budget Amount, and overage-from-savings blending'
    status: pending
  - id: phase1-stacked-bar
    content: Extract AllocationStackedBar into components/allocation-stacked-bar.tsx from envelope-allocations-page.tsx
    status: pending
  - id: phase1-fill-envelopes
    content: 'Build components/fill-envelopes-dialog.tsx: scrollable tile grid with search/sort, EnvelopeTile with health bar, delta/final balance display'
    status: pending
  - id: phase1-distribution-panel
    content: 'Build components/distribution-panel.tsx: distribution behavior selector, Fund overage from Savings toggle, stacked bar preview, link to FillEnvelopesDialog'
    status: pending
  - id: phase1-dialog-rework
    content: Rework components/irregular-income-dialog.tsx into multi-step flow (details → distribute → confirm → success); add edit-mode prop
    status: pending
  - id: batch-model
    content: 'Add config: Json? field to EnvelopeFundingBatch in prisma/schema.prisma; add DELETE /api/transactions/batch/[id] and GET /api/transactions/batch/[id]/config API routes'
    status: pending
  - id: batch-display
    content: 'Update transaction list / history UI to show income distribution batches with an Edit button alongside existing Delete; add grouped collapsible row for rebalance batches; extend lib/transaction-batch-delete.ts cascade logic for envelope_transfer_in/ou status: pending
  - id: phase2-api
    content: 'Create app/api/transactions/rebalance/route.ts with balanced and independent modes, envelope_transfer_in/out sources, savings floor guard; store dialog config in EnvelopeFundingBatch.config'
    status: pending
  - id: phase2-adjust-dialog
    content: Build components/adjust-envelopes-dialog.tsx (Edit allocations / Rebalance envelopes / Fund from Savings choice picker)
    status: pending
  - id: phase2-rebalance-dialog
    content: 'Build components/rebalance-envelopes-dialog.tsx: Balanced/independent modes, sliders, quick selects, ceiling multiplier, before/after stacked bars; add edit-mode prop that pre-populates from batch config'
    status: pending
  - id: phase2-envelopes-page
    content: Update components/envelopes-page.tsx to open AdjustEnvelopesDialog from sliders button instead of navigating directly to allocations page
    status: pending
  - id: phase3-prisma
    content: Add RecurringFundingRule model to prisma/schema.prisma + migration
    status: pending
  - id: phase3-scheduling-ui
    content: Add scheduling section to RebalanceEnvelopesDialog + income distribute step; build CRUD API at /api/recurring-rules
    status: pending
  - id: phase3-settings
    content: Rename Payee mappings tab to Budgeting rules in settings-page.tsx; add Recurring rules sub-section; add recurring rules badge on Envelopes page
    status: pending
isProject: false
---
# Income & Rebalance Envelopes Overhaul

## Problem Being Solved
`POST /api/transactions/irregular-income` → `createIrregularIncomeBatch()` currently always runs `computeIrregularIncomeSplits()` and immediately creates hidden funding legs into spend envelopes. The user never consents to this distribution.

---

## Phase 1 — Fix "Add Extra Income" (highest priority)

### 1a. Backend: add savings-only mode
Modify [`app/api/transactions/irregular-income/route.ts`](app/api/transactions/irregular-income/route.ts) and [`lib/envelope-funding.ts`](lib/envelope-funding.ts):
- Accept a new `distributionModsavings" | "envelopes"` field in the request body
- When `"savings"`: create only the Savings credit row; skip `computeIrregularIncomeSplits()` and all funding legs
- When `"envelopes"`: accept either an explicit `envelopeAllocations: {envelopeId: string, amountUsd: number}[]` array **or** a `distributionBehavior` enum (`"set_to_budget" | "add_budget" | "custom"`) that the server computes using current balances
- Add a `fundOverageFromSavings: boolean` flag: when true, if gross income < computed need, draw the difference from the Savings balance (capped at Savings balance >= 0)
- Keep current behavior as the legacy fallback so existing tests don't break

### 1b. New lib: `lib/rebalance-math.ts`
Pure computation helpers:
```ts
// "Set to Budget Amount": delta = max(0, monthlyAllotment - currentBalance)
// "Add Budget Amount": delta = monthlyAllotment
// computeDistribution(behavior, envelopes, grossUsd, savingsBalance) => {envelopeId, delta, fromSavings}[]
```

### 1c. Rework `components/irregular-income-dialog.tsx`
Convert from a single-step form into a multi-step dialog (controlled by a `step` state):

```
step 1: "details"    → existing fields (amount, date, payee, notes) + CTA "Next"
step 2: "distribute" → savings/envelopes choice, DistributionPanel inline when envelopes selected
step 3: "confirm"    → FillEnvelopesDialog view (read-only preview), CTA "Confirm"
step 4: "success"    → celebration screen: "$X income recorded — $Y to Savings, $Z to envelopes"
```

- Default selection on step 2 is **Put it in Savings** (radio/toggle, prominent, selected by default)
- "Fill envelopes" radio reveals the `DistributionPanel` below it with a smooth expand animation
- The stacked bar at the top of the panel is the same visual from [`components/envelope-allocations-page.tsx`](components/envelope-allocations-page.tsx) (extract it into a shared `AllocationStackedBar` component)

### 1d. New `components/distribution-panel.tsx`
Inline panel that appears inside the income dialog for envelope distribution config ed in `RebalanceEnvelopesDialog` for the "Fund from Savings" source case):
- Stacked bar (extracted `AllocationStackedBar`) showing projected allocations
- Distribution behavior selector (radio group): "Set to Budget Amount" / "Add Budget Amount" / "Choose for each"
- "Fund any overage from Savings" toggle (disabled + grayed when Savings balance is 0)
- Small `"View X affected envelopes →"` link below the selector → opens `FillEnvelopesDialog`
- **Always visible** (including Fund from Savings with all slider deltas at 0): use stable reserved height in the parent dialog so the link does not pop in and resize the dialog. When X = 0, label e.g. `View envelopes` and open FillEnvelopes with current balances / zero deltas.
- Props: `sourceFunding: "income" | "savings"`, `grossUsd: er`, `onConfigChange`

### 1e. New `components/fill-envelopes-dialog.tsx`
Reusable modal showing envelope-by-envelope impact. Shared by income flow and Rebalance Envelopes:
- Top: `AllocationStackedBar` (interactive — tapping a segment scrolls to its tile)
- Scrollable tile grid (each tile at ~200px wide, responve columns)
- Each **EnvelopeTile**:
  - Color background tint + icon
  - Distribution behavior badge ("Set to budget", "Add budget", "Custom $X.XX")
  - `current balance → +delta → finalance` with color coding
  - Health bar: lighter tint strip = current, deeper tint strip = final
- Quick-search input + sort dropdown (Alphabetical A-Z, Z-A, Balance high/low, Health high/low, Newest/Oldest transaction)
- Scrollable or simple pagination (`ceil(N/12)` pages)
- Back button closes the dialog and returns to the parent

---

## Phase 2 — Rebalance Envelopes from Envelopes Page

### 2a. New `components/adjust-envelopes-dialog.tsx`
Small picker dialog opened by the current sliders icon button in [`components/envelopes-page.tsx`](components/envelopes-page.tsx):
- "Edit allocations" → `navigateTo("envelope-allions")` (existing page, unchanged)
- "Rebalance envelopes" → opens `RebalanceEnvelopesDialog`
- "Fund envelopes from Savings" → opens `RebalanceEnvelopesDialog` with `source="savings"` s `DistributionPanel` variant)

### 2b. New `components/rebalance-envelopes-dialog.tsx`
Full-featured slider-based redistribution dialog:

**Header:** Two stacked bars (before / after balances) using `AllocationStackedBar`

**Distribution Mode toggle:** "Balanced" | "Let me choose for each"
- **Balanced**: other sliders auto-adjust in real time (same zero-sum logic as `EnvelopeAllocationsPage`). Full slider list always visible (not hidden behind "choose each" copy). Sliders constrained to `[0, envelope.monthlyAllotment × multiplier]` for credits; debits capped by all-time remaining. Excess/deficit stays within the envelope pool — Savings is not touched.
- **Let me choose for e**: sliders move independently. Running total shows excess (→ Savings) or deficit (← from Savings). Savings row shows projected change.

**Quick selects** (smooth slider animation on se):
1. Relieve overfunded — overfunded envelopes disburse into underfunded ones, prioritizing lowest-health first
2. Restore envelope health — bring each envelope to prorated 100% health (time-of-month aware via `lib/sweep-math.ts`)
3. Sweep to savings — drain each envelope down to exactly 100% health, push eto Savings
4. Proportional fill — redistribute the total balance pool proportionally to each envelope's `monthlyAllotment` (mini-paycheck from existing balances)
5. Zero-base — drain all envelopes to $0 into Savings; clean slate for manual slider adjustment
6. Revert to custom — undo button; restores the mosnt manually-set slider positions

**Slider ceiling multiplier:** buttons `1× 2× 3× 5× 10×` multiply the per-slider ceiling above `monthlyAllotment`.

**Negative balance handling:** slider debit minimum is 0 when remaining is 0 (not negative drag). A separate "currently in deficit: –$X" annotation is shown on the tile when already overdrawn. The deficit amount is excluded from the zero-sum redistribution pool.

**Zero remaining (no funds to move out):** still render every envelope row and slider chrome — do not hide sliders when all balances are zero or when Balanced mode is selected. Use disabled styling on the range control and visible plain-language text on the row, e.g. "There isn't any money in [envelope name] to move out." Credit (fund into envelope) may remain enabled when funding from Savings.

**"View X affected envelopes →"** → opens `FillEnvelopesDialog` (same component as Phase 1). Link **must remain in the layout when X = 0** (Fund from Savings default); reserved min-height prevents dialog jump when X becomes positive.

**Footer CTA:** Next → confirm in `FillEnvelopesDialog` → submit → Success dialog (no confetti; "Envelopes rebalanced — Savings changed by ±$Y").

### 2c. New API: `actions/rebalance/route.ts`
`POST` with body `{entries: {envelopeId, deltaUsd}[], mode: "balanced" | "independent", config: Json}`:
- For balanced: paired envelope-to-envelope transfer legs (both sides visible in history, new source types `envelope_transfer_in` / `envelope_transfer_out`)
- For independent: deficit legs pull from Savings, surplus legs push to Savings (similar to sweep pattern)
- All legs share a new `EnvelopeFundingBatch` with `kind: "rebalance"`, with the full dialog config stored in `EnvelopeFundingBatch.config`
- Server-side guard: Savings cannot go below 0

---

## Batch Surfacing, Delete, and Edit

### Data model addition
Add `config Json?` to `EnvelopeFundingBatch` in [`prisma/schema.prisma`](prisma/schema.prisma) (new migration). This field stores the serialized dialog config at creation time — enough to re-open the dialog pre-populated:
```prisma
model EnvelopeFundingBatch {
  // existing fields...
  config    Json?     // stores creation-time dialog config for edit re-opening
}
```

### How each batch kind surfaces in history
*Income batches** (`kind: "fund"`, source `irregular_income`):
- The existing Savings credit row **is** the visible representative — this is unchanged.
- New: an **Edit** button appears alongside the existing Delete button on this row in the transaction list.
- Deleting already cascades the whole batch via `shouCascadeDeleteFundingBatch` ✓.

**Rebalance batches** (`kind: "rebalance"`, sources `envelope_transfer_in/out`):
- All legs are visible in the main history.
- They are visually **grouped**n the transaction list under a collapsible row: `"Rebalanced N envelopes · ±$Y to Savings"` dated at `batch.createdAt`.
- The group header has **Delete** (cascades all legs) and **Edit** e-opens `RebalanceEnvelopesDialog` in edit mode) actions.
- The group can be expanded to show individual legs, similar to how income batches already show "From Income" on envelope pages.

### New API routes
- `DELETE /api/transactions/batch/[id]` — deletes all transactions in the batch (server-side guard: only the owning user)
- `GET /api/transactions/batch/[id]/config` âurns `EnvelopeFundingBatch.config` for edit re-opening

### Edit mode for dialogs

**`IrregularIncomeDialog`** gains an `editBatchId?: string` prop:
- When set, the dialog opens pre-populated (amount, date, payee, notes, distributionMode, distribution config) from the batch config
- On submit: `DELETE /api/transactions/batch/{editBatchId}` then `POST /api/transactions/irregular-income` with the new settings; the two calls happen sequentially, wrapped in a loading state — if the second call fails, the user sees the error and can retry (the batch is already deleted; the dialog stays open)
- Step label changes from "Add extra income" → "Edit income entry"

**`RebalanceEnvelopesDi`** gains an `editBatchId?: string` prop:
- Same replace-then-recreate pattern
- Title changes to "Edit rebalance"

### Updated `lib/transaction-batch-delete.ts`
Extend `shouldCascadeDeleteFundingBatch` and `canDeleteTransactionFromList` to also handle `envelope_transfer_in` / `envelope_transfer_out` sources (treat like funding legs — show delete on the group header, not on individual legs).

---

## Phase 3 — Scheduling + Settings Rename

### 3a. New Prisma model
```prisma
model RecurringFundine {
  id               String   @id @default(cuid())
  userId           String
  kind             String   // "income_distribution" | "rebalance"
  frequency        String   // "weekly" | "bimonthly" | "monthly" | "every_2mo" | "every_3mo" | "every_6mo" | "annually"
  distributionConfig Json   // serialized DistributionPanel / RebalanceEnvelopesDialog config
  nextRunAt        DateTime
  lastRunAt        DateTime?
  enabled          Boolean  @default(true)
  createdAt        DateTime @default(now())
  @@index([userId, nextRunAt])
}
```

### 3b. Scheduling UI
- Add a "Schedule this" collapsible section at the bottom of the `RebalanceEnvelopesDialog` and in the Extra Income distribute step
- Frequency picker (dropdown with the 7 options)
- New API routes: `GET/POST/DELETE /api/recurring-rules`

### 3c. Settings rename + Budgeting rules section
In [`components/settings-page.tsx`](components/settings-page.tsx):
- Rename tab label, `SettingsTab` type value, and hash from `"payees"` / `"payee-mappings"` → `"budgeting-rules"` (update all references including URL hash routing and `settingsTabFromLocationHash`)
- Rename `<span>Payee mappings</span>` to `<span>Budgeting rules</span>` and update the icon from `Link2` to something like `BookOpen` or `Settings2`
- Add a new "Recurring rules" sub-section inside the Budgeting rules tab listing all `RecurringFundingRule` rows with enable/disable/delete controls
- Existing `PaeMappingsSettings` component remains as a sub-section titled "Payee name aliases"

### 3d. Visibility from Envelopes page
- Add a small "Recurring rules" pill/badge near the sliders icon when any active rules exist, tapping it opens Settings > Budgeting rules

---

## Shared component: `AllocationStackedBar`
Extract the stacked bar from [`components/envelope-allocations-page.tsx`](components/envelope-allocations-page.tsx) into `components/allocation-stacked-bar.tsx` (lines ~289-339). Used in: allocations page, `DistributionPanel`, `RebalanceEnvelopesDialog`, `FillEnvelopesDialog`.

Props:
```ts
{
  envelopes: {id, name, color, icon, value: number}[]
  savingsValue: number
  totalValue: number
  onSegmentClick?: (envelopeId: string) => void
  // variant="before|after" for side-by-side display in RebalanceEnvelopesDialog
}
```

---

## Quick selects — full list
Six total options in `RebalanceEnvelopesDialog`:
1. **Relieve overfunded** — overfunded envelopes disburse into underfunded ones, prioritizing lowest-health envelopes first
2. **Restore envelhealth** — bring each envelope to prorated 100% health (time-of-month aware via `lib/sweep-math.ts`)
3. **Sweep to savings** — drain each envelope down to exactly 100% health, push excto Savings
4. **Proportional fill** — redistribute the total balance pool proportionally to each envelope's `monthlyAllotment` (a mini-paycheck from existing balances, no new income)
5. **Zero-base** — drain all envelopes to $0 into Savings, giving the user a clean slate to then drag sliders manually
6. **Revto custom** — undo button; restores the most recent manually-set slider positions

