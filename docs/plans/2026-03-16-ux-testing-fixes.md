# UX Testing Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 10 UX issues discovered during in-person user testing to make login, onboarding, dashboard, and transaction flows self-explanatory.

**Architecture:** All changes are frontend-only (React components). No database schema changes. Allocation cadence conversion is purely UI-side; monthly values are stored as-is. The walkthrough overlay is a new component using localStorage for persistence.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons

---

### Task 1: Suppress "Don't remember your password?" for Nostr users

**Files:**
- Modify: `app/onboarding/page.tsx:325-349`

**Step 1: Edit the banner condition**

In `app/onboarding/page.tsx`, line 325, change the condition from:

```tsx
{restoredSession && step !== "security" && step !== "complete" && (
```

to:

```tsx
{restoredSession && !isNostr && step !== "security" && step !== "complete" && (
```

This prevents the password-reset banner from showing to Nostr users who never set a password.

**Step 2: Verify**

Run: `npx next build 2>&1 | head -20`
Expected: No build errors related to onboarding page.

**Step 3: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "fix: hide password reset banner for Nostr users"
```

---

### Task 2: Add instructional copy to "Your Envelopes" step

**Files:**
- Modify: `app/onboarding/page.tsx:486-490`

**Step 1: Update the subtitle and add helper text**

In `app/onboarding/page.tsx`, the current envelopes step header (around line 482-486) has:

```tsx
<h2 className="text-xl font-bold text-foreground">Your Envelopes</h2>
<p className="text-sm text-muted-foreground">Create spending categories</p>
```

Update the subtitle to set expectations:

```tsx
<h2 className="text-xl font-bold text-foreground">Your Envelopes</h2>
<p className="text-sm text-muted-foreground">Create your spending categories — you&apos;ll set budget amounts in the next step</p>
```

Also update the helper text paragraph (around line 488-490) to reinforce:

```tsx
<p className="text-xs text-muted-foreground leading-relaxed">
  Add envelopes for each area you spend money on. Don&apos;t worry about amounts yet — the next step lets you allocate your income across these envelopes. Anything you don&apos;t allocate automatically goes into <span className="text-[#22C55E] font-medium">Savings</span>.
</p>
```

**Step 2: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "fix: clarify that envelope amounts are set in next step"
```

---

### Task 3: Fix envelope color collisions

**Files:**
- Modify: `app/onboarding/page.tsx:212-224` (addEnvelopeWithName)
- Modify: `components/envelopes-page.tsx:83-91` (openAddDialog default color)
- Modify: `app/api/import/route.ts:62,99` (random hex → sequential)

**Step 1: Update onboarding addEnvelopeWithName**

In `app/onboarding/page.tsx`, replace the `addEnvelopeWithName` function (lines 212-225):

```tsx
function addEnvelopeWithName(name: string) {
  if (!name.trim()) return
  const trimmed = name.trim()
  setEnvelopes(prev => {
    const usedColors = new Set(prev.map(e => e.color))
    const nextColor = ENVELOPE_COLORS.find(c => !usedColors.has(c))
      ?? ENVELOPE_COLORS[prev.length % ENVELOPE_COLORS.length]
    return [
      ...prev,
      {
        name: trimmed,
        color: nextColor,
        icon: suggestIcon(trimmed),
        monthlyAllotment: 0,
      },
    ]
  })
  setNewEnvName("")
}
```

**Step 2: Update envelopes page default color**

In `components/envelopes-page.tsx`, the `openAddDialog` function (around line 83-91) sets `setFormColor("#F7931A")`. Change it to pick the first unused color:

```tsx
function openAddDialog() {
  setEditingId(null)
  setFormName("")
  setFormAllotment("")
  const usedColors = new Set(activeEnvelopes.map(e => e.color))
  const nextColor = PRESET_COLORS.find(c => !usedColors.has(c)) ?? "#F7931A"
  setFormColor(nextColor)
  setFormIcon("Wallet")
  setIconCustomized(false)
  setDialogOpen(true)
}
```

This requires importing `PRESET_COLORS` or defining the same array. Since `envelope-appearance-picker.tsx` already exports the `PRESET_COLORS` array, add it to the export and import it in `envelopes-page.tsx`. Alternatively, since `ENVELOPE_COLORS` in onboarding is a subset of `PRESET_COLORS`, you can define a shared constant in a utility file.

Simplest approach: import `PRESET_COLORS` from `envelope-appearance-picker.tsx` (it's already defined there but not exported — add `export` to it).

**Step 3: Update import route**

In `app/api/import/route.ts`, replace both random hex color assignments (lines 62 and 99) with sequential color assignment:

```typescript
const ENVELOPE_COLORS = ["#F7931A", "#3B82F6", "#10B981", "#8B5CF6", "#EF4444", "#EAB308", "#EC4899", "#06B6D4"]
```

Add this constant at the top of the route file. Then at each color assignment point, look up how many envelopes already exist and pick the next unused color:

```typescript
// Replace: color: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0")}`
// With: color: ENVELOPE_COLORS[existingEnvelopeCount % ENVELOPE_COLORS.length]
```

where `existingEnvelopeCount` is the count of envelopes already created by that point in the import loop.

**Step 4: Commit**

```bash
git add app/onboarding/page.tsx components/envelopes-page.tsx components/envelope-appearance-picker.tsx app/api/import/route.ts
git commit -m "fix: assign unique colors to new envelopes"
```

---

### Task 4: Per-envelope allocation cadence

**Files:**
- Modify: `app/onboarding/page.tsx:756-822` (allocation slider rows)

**Step 1: Add cadence state**

In `app/onboarding/page.tsx`, after the existing `DraftEnvelope` interface (line 28-33), add a cadence field:

```tsx
interface DraftEnvelope {
  name: string
  color: string
  icon: string
  monthlyAllotment: number
  allocationCadence: "weekly" | "biweekly" | "monthly"
}
```

Update all places that create `DraftEnvelope` objects to include `allocationCadence: "monthly"` (the default envelopes at line 52-56, `addEnvelopeWithName`, and the session restore).

**Step 2: Add cadence conversion helpers**

Add these above the component or in a shared location:

```tsx
const CADENCE_MULTIPLIERS: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
}

function toMonthly(amount: number, cadence: string): number {
  return Math.round(amount * (CADENCE_MULTIPLIERS[cadence] ?? 1) * 100) / 100
}

function fromMonthly(monthly: number, cadence: string): number {
  const mult = CADENCE_MULTIPLIERS[cadence] ?? 1
  return Math.round((monthly / mult) * 100) / 100
}
```

**Step 3: Add cadence selector to each allocation row**

In the allocation slider rows (around line 758-822), add a small cadence toggle next to each envelope's dollar input. When cadence is non-monthly, show the conversion:

Inside each envelope's allocation row, add a `<select>` or button group for cadence:

```tsx
<select
  value={env.allocationCadence}
  onChange={e => {
    const newCadence = e.target.value as "weekly" | "biweekly" | "monthly"
    setEnvelopes(prev => prev.map((en, i) =>
      i === idx ? { ...en, allocationCadence: newCadence } : en
    ))
  }}
  className="bg-[#1A1A1A] border border-[#333] rounded-md text-xs text-muted-foreground px-1.5 py-1"
>
  <option value="weekly">/week</option>
  <option value="biweekly">/2 weeks</option>
  <option value="monthly">/month</option>
</select>
```

**Step 4: Update the dollar input to work in the user's cadence**

The numeric input should show the amount in the selected cadence. When the user types a value, convert it to monthly for storage:

```tsx
<input
  type="number"
  value={fromMonthly(env.monthlyAllotment, env.allocationCadence) || ""}
  onChange={e => {
    const raw = parseFloat(e.target.value)
    const cadenceAmount = isNaN(raw) ? 0 : Math.max(0, raw)
    const monthly = Math.min(toMonthly(cadenceAmount, env.allocationCadence), sliderMax)
    setEnvelopes(prev => prev.map((en, i) =>
      i === idx ? { ...en, monthlyAllotment: monthly } : en
    ))
  }}
  // ... existing className, placeholder, etc.
/>
```

When cadence is non-monthly, show a helper below the input:

```tsx
{env.allocationCadence !== "monthly" && env.monthlyAllotment > 0 && (
  <span className="text-[10px] text-muted-foreground">
    = ${env.monthlyAllotment.toLocaleString()}/mo
  </span>
)}
```

**Step 5: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: per-envelope allocation cadence (weekly/biweekly/monthly)"
```

---

### Task 5: keys.band screenshot framing

**Files:**
- Modify: `app/auth/page.tsx:487-553`

**Step 1: Add framing context to the guide modal**

In `app/auth/page.tsx`, inside the keys.band guide overlay (around line 497-548), add a persistent banner above the screenshot:

After the close button (line 506) and before the `<img>` tag (line 508-509), add:

```tsx
<div className="px-4 pt-4 pb-2">
  <p className="text-xs font-medium text-[#3B82F6] bg-[#3B82F6]/10 rounded-lg px-3 py-2 text-center">
    📋 Follow these steps in your keys.band browser extension
  </p>
</div>
```

**Step 2: Add "Screenshot" badge on images**

Wrap the `<img>` in a relative container and add a badge:

Replace the `<img>` (line 508-509):

```tsx
<div className="relative">
  {/* eslint-disable-next-line @next/next/no-img-element */}
  <img src={s.img} alt={s.title} className="w-full aspect-[4/3] object-contain bg-[#1A1A1A]" />
  <span className="absolute top-2 left-2 text-[10px] font-medium bg-black/60 text-white/70 px-2 py-0.5 rounded-full">
    Screenshot
  </span>
</div>
```

**Step 3: Commit**

```bash
git add app/auth/page.tsx
git commit -m "fix: clarify keys.band guide screenshots are not interactive"
```

---

### Task 6: Transaction search bar clarity + New Transaction button on page

**Files:**
- Modify: `components/transactions-page.tsx:170-176` (search placeholder)
- Modify: `components/transactions-page.tsx:130-165` (add New Transaction button)

**Step 1: Update search placeholder**

In `components/transactions-page.tsx`, line 174, change the placeholder:

```tsx
placeholder="Search existing transactions..."
```

**Step 2: Add a New Transaction button to the page header**

In the transactions page header area (around line 131-164), add a "New Transaction" button. First, add `setTransactionDialogOpen` to the destructured imports from `useApp()` (line 25). Then add the button after the stats row:

```tsx
<button
  onClick={() => setTransactionDialogOpen(true)}
  className="self-start flex items-center gap-2 mt-3 px-4 py-2.5 bg-[#F7931A] text-[#0D0D0D] rounded-xl font-semibold text-sm hover:bg-[#F7931A]/90 transition-colors"
>
  <Plus className="h-4 w-4" />
  New Transaction
</button>
```

Add `Plus` to the Lucide imports at the top of the file.

**Step 3: Commit**

```bash
git add components/transactions-page.tsx
git commit -m "fix: clarify search bar and add prominent New Transaction button"
```

---

### Task 7: New Transaction modal — multi-view form

**Files:**
- Modify: `components/new-transaction-dialog.tsx` (entire form restructure)

**Step 1: Add view state**

Add a `modalView` state to the component:

```tsx
type ModalView = "main" | "recurring" | "tags"
const [modalView, setModalView] = useState<ModalView>("main")
```

Reset `modalView` to `"main"` in `resetForm()`.

**Step 2: Restructure the form into views**

Replace the current form body with a view-based structure:

**Main view:** Show Type, Payee, Amount, Envelope, Date, Notes fields (keep as-is). Replace the inline Recurring toggle + fields and the Tags section with two disclosure rows:

```tsx
{/* Recurring disclosure row */}
<button
  type="button"
  onClick={() => setModalView("recurring")}
  className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg hover:bg-[#222] transition-colors"
>
  <div className="flex items-center gap-2">
    <Repeat className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm text-foreground">Recurring</span>
  </div>
  <span className="text-xs text-muted-foreground">
    {isRecurring ? `${CADENCE_OPTIONS.find(o => o.value === cadence)?.label ?? cadence}${endDate ? `, ends ${endDate}` : ""}` : "Off"}
  </span>
</button>

{/* Tags disclosure row */}
<button
  type="button"
  onClick={() => setModalView("tags")}
  className="flex items-center justify-between p-3 bg-[#1A1A1A] rounded-lg hover:bg-[#222] transition-colors"
>
  <div className="flex items-center gap-2">
    <Tag className="h-4 w-4 text-muted-foreground" />
    <span className="text-sm text-foreground">Tags</span>
  </div>
  <span className="text-xs text-muted-foreground">
    {selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length > 1 ? "s" : ""}` : "None"}
  </span>
</button>
```

Import `Tag` from `lucide-react`.

**Recurring view:** Show a header "Recurring", the on/off toggle, cadence selector, start date, end date. Two buttons at the bottom: "Save" (sets `modalView` back to `"main"`) and "Cancel" (reverts changes, sets `modalView` back to `"main"`).

To support cancel/revert: snapshot the recurring state when entering the view, restore on cancel.

**Tags view:** Show the tag picker and new tag input. Same "Save" / "Cancel" pattern.

**Step 3: Only show submit button on main view**

The "Add Expense" / "Add Credit" submit button should only appear in the main view. The recurring and tags views have their own "Save" / "Cancel" buttons that navigate back.

**Step 4: Commit**

```bash
git add components/new-transaction-dialog.tsx
git commit -m "refactor: split transaction modal into multi-view form"
```

---

### Task 8: Form validation — visible error on required fields

**Files:**
- Modify: `components/new-transaction-dialog.tsx:128-131`

**Step 1: Add validation error state**

```tsx
const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
```

Clear errors in `resetForm()`.

**Step 2: Replace silent return with validation**

Replace the guard in `handleSubmit` (line 130):

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  const errors: Record<string, string> = {}
  if (!payee.trim()) errors.payee = "Please enter a payee"
  if (!amount || parseFloat(amount) <= 0) errors.amount = "Please enter an amount"
  if (!envelopeId) errors.envelope = "Please select an envelope"
  if (Object.keys(errors).length > 0) {
    setValidationErrors(errors)
    return
  }
  setValidationErrors({})
  // ... rest of submit logic
```

**Step 3: Show inline errors**

Below the Envelope `<Select>` component, add:

```tsx
{validationErrors.envelope && (
  <p className="text-xs text-red-400 mt-1">{validationErrors.envelope}</p>
)}
```

Same pattern for payee and amount fields. Clear individual errors on field change:

```tsx
onChange={(e) => {
  setPayee(e.target.value)
  setValidationErrors(prev => { const next = { ...prev }; delete next.payee; return next })
  setShowSuggestions(true)
}}
```

**Step 4: Commit**

```bash
git add components/new-transaction-dialog.tsx
git commit -m "fix: show inline validation errors on transaction form"
```

---

### Task 9: Opportunity Cost chart — minimum data threshold

**Files:**
- Modify: `components/opportunity-cost-chart.tsx:183-186`

**Step 1: Change the empty state threshold**

In `components/opportunity-cost-chart.tsx`, line 183, change:

```tsx
{filteredData.length === 0 ? (
```

to:

```tsx
{filteredData.length < 3 ? (
```

And update the message:

```tsx
<div className="h-[250px] md:h-[350px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
  <PieChart className="h-8 w-8 text-[#333]" />
  <p className="text-sm text-center max-w-xs">
    {filteredData.length === 0
      ? "No expense transactions to display."
      : "Add a few more transactions to see your opportunity cost trends."}
  </p>
</div>
```

Import `PieChart` from `lucide-react` (or reuse an existing icon).

**Step 2: Commit**

```bash
git add components/opportunity-cost-chart.tsx
git commit -m "fix: hide chart with fewer than 3 data points"
```

---

### Task 10: Post-onboarding guided walkthrough

**Files:**
- Create: `components/walkthrough-overlay.tsx`
- Modify: `components/dashboard-page.tsx` (add overlay)
- Modify: `components/sidebar.tsx` (add data attributes for walkthrough targets)

**Step 1: Add data attributes to walkthrough targets**

In `components/sidebar.tsx`, add `data-walkthrough="transactions"` to the Transactions nav button and `data-walkthrough="new-transaction"` to the New Transaction button.

**Step 2: Create the walkthrough overlay component**

Create `components/walkthrough-overlay.tsx`:

```tsx
"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { X } from "lucide-react"

interface WalkthroughStep {
  target: string       // data-walkthrough attribute value
  title: string
  description: string
  position: "right" | "bottom"
}

const STEPS: WalkthroughStep[] = [
  {
    target: "transactions",
    title: "Your Transactions",
    description: "This is where you'll add and manage your expenses.",
    position: "right",
  },
  {
    target: "new-transaction",
    title: "Add a Transaction",
    description: "Tap here to record your first expense.",
    position: "right",
  },
  {
    target: "dashboard-area",
    title: "Your Dashboard",
    description: "Spending insights and Bitcoin opportunity costs appear here once you have transactions.",
    position: "bottom",
  },
]

export function WalkthroughOverlay() {
  const [currentStep, setCurrentStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (localStorage.getItem("bitbudget-walkthrough-completed")) return
    const timer = setTimeout(() => setVisible(true), 500)
    return () => clearTimeout(timer)
  }, [])

  const positionTooltip = useCallback(() => {
    const step = STEPS[currentStep]
    const el = document.querySelector(`[data-walkthrough="${step.target}"]`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (step.position === "right") {
      setTooltipPos({ top: rect.top + rect.height / 2, left: rect.right + 12 })
    } else {
      setTooltipPos({ top: rect.bottom + 12, left: rect.left + rect.width / 2 })
    }
  }, [currentStep])

  useEffect(() => {
    if (!visible) return
    positionTooltip()
    window.addEventListener("resize", positionTooltip)
    return () => window.removeEventListener("resize", positionTooltip)
  }, [visible, positionTooltip])

  function handleNext() {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      dismiss()
    }
  }

  function dismiss() {
    setVisible(false)
    localStorage.setItem("bitbudget-walkthrough-completed", "1")
  }

  if (!visible) return null

  const step = STEPS[currentStep]

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} />
      <div
        ref={tooltipRef}
        className="absolute bg-[#1A1A1A] border border-[#333] rounded-xl p-4 shadow-xl max-w-xs z-50"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          transform: step.position === "bottom" ? "translateX(-50%)" : "translateY(-50%)",
        }}
      >
        <button
          onClick={dismiss}
          className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{step.description}</p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {currentStep + 1} of {STEPS.length}
          </span>
          <button
            onClick={handleNext}
            className="text-xs font-medium text-[#F7931A] hover:text-[#F7931A]/80 transition-colors"
          >
            {currentStep < STEPS.length - 1 ? "Next" : "Got it!"}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 3: Add to dashboard page**

In `components/dashboard-page.tsx`, import and render the overlay:

```tsx
import { WalkthroughOverlay } from "@/components/walkthrough-overlay"

export function DashboardPage() {
  return (
    <div className="flex flex-col gap-6" data-walkthrough="dashboard-area">
      <WalkthroughOverlay />
      <DashboardMetrics />
      <OpportunityCostChart />
      <TopOpportunityCosts />
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add components/walkthrough-overlay.tsx components/dashboard-page.tsx components/sidebar.tsx
git commit -m "feat: post-onboarding guided walkthrough overlay"
```
