## Scenario setup

**Profile:** Day trader, irregular only, no W-2.

**Onboarding choices (locked in):**
- Income mode: **Irregular only**
- Estimated annual income: **$120,000** → `monthlyIncome` ≈ **$10,000** (planning cap for allocations)
- Envelopes & monthly allotments:

| Envelope    | Allotment/mo |
|------------|--------------|
| Rent       | $2,000       |
| Groceries  | $800         |
| Car        | $400         |
| Recreation | $300         |
| *(Savings slice in plan)* | $6,500 *(implicit — not an envelope)* |

- Pay cadence: **irregular** (no auto payday funding)
- Sweep default: **Carry forward**
- Savings experience: **Engaged**, monthly savings goal: **$3,000**

**Workflow:** **A — pay-yourself-first** (wins via **Add extra income**, losses as **Savings expenses**).

---

## Week 1 — big winning week (+$12,000 net trading)

Assume they log **daily nets** (4 winning days), not every fill.

### Monday — +$4,000 net

**Envelopes → Add extra income** (or hero card shortcut)

| Field   | Value        |
|---------|--------------|
| Amount  | $4,000       |
| Date    | Mon          |
| Payee   | `Trading — Mon` |
| Notes   | `4 green days net` *(optional)* |

**Ledger (simplified):**

```
Savings     +$4,000  (irregular_income credit, visible)
Savings     −$800    → Groceries   (hidden allocation leg)
Savings     −$400    → Car         (hidden)
Savings     −$300    → Recreation  (hidden)
Savings     −$2,000  → Rent        (hidden)
Savings     −$???    → remaining proportional slices…
```

Allotments are **proportional to the $10k monthly plan**, not “fill Rent first.” On a $4k win, Rent gets roughly **20%** (~$800), not the full $2,000.

**After Monday (rough):**
- **Savings balance:** ~+$2,500 *(most of the win, after auto-slices)*
- **Rent remaining (month):** ~+$800 toward the $2,000 cap
- Dashboard **Monthly Income:** $4,000 *(actual irregular credits)*

### Tue–Thu — +$3k, +$2k, +$3k

Same flow each day. By end of Week 1:

| Metric | Approx |
|--------|--------|
| Irregular income logged | **$12,000** |
| Savings balance | **~+$7,500–8,000** *(depends on cumulative slices)* |
| Envelope “remaining” | Rent, Groceries, etc. **well funded** for the month |

**UI checks:**
- **Dashboard:** Income $12k, Savings ~$8k, Remaining high, Spend low
- **Savings hero:** Balance up; goal ring may show progress if the period tracks **net Savings growth**
- **Transactions → Savings pill:** Income headers + allocation legs (legs hidden from main list unless filtered to an envelope)

---

## Week 2 — losing week (−$3,000 net)

Irregular income is **positive only**. Losses use **New Transaction → Expense → Savings**.

### Example: one −$3,000 entry (Friday)

| Field    | Value |
|----------|-------|
| Type     | Expense |
| Envelope | **Savings** |
| Amount   | $3,000 |
| Payee    | `Trading — week 2 net loss` |
| Date     | Fri |

**Ledger:**
```
Savings  −$3,000  (manual expense — no envelope funding legs)
```

**After loss:**
- **Savings balance:** ~+$5,000–5,500 *(down $3k from Week 1 peak)*
- Living envelopes **unchanged** — Monday’s auto-funding already moved money out of Savings

**Dashboard:**
- **Monthly Income** still ~$12k *(losses aren’t income)*
- **Savings** tile drops by $3k
- **Monthly Spend** may **not** include this if it only counts discretionary envelope expenses — the loss hit **Savings**, not Groceries. That’s correct for “hub accounting,” but the trader should watch the **Savings** tile, not only Spend.

---

## Living expenses — $2,000 rent (and normal life)

Rent was **partially pre-funded** by win auto-allocation. When rent is actually paid:

**New Transaction → Expense → Rent**

| Field    | Value |
|----------|-------|
| Amount   | $2,000 |
| Payee    | `Landlord` |
| Date     | Due date |

**Effect:**
- **Rent envelope remaining** goes down (toward $0 if fully funded)
- **Savings unchanged** — money already left Savings via allocation legs

Same pattern for groceries, car, recreation.

**End of month snapshot (illustrative):**

| | |
|--|--|
| Trading logged | +$12,000 irregular, −$3,000 Savings expense |
| Rent paid | $2,000 from Rent envelope |
| Other living | From respective envelopes |
| **Savings balance** | **~+$3,000–4,000 net** for the month *(wins − auto-slices − loss − anything else)* |
| **Savings goal** | $3,000 target — **close** if `actualSavedAmount` (balance growth in period) ≥ goal |

---

## What they’d see in Analytics

**Savings overlay (Engaged):**
- Week 1: Savings line **steps up** on each Add extra income day
- Week 2: **step down** on the loss day
- Living spend shows in **Cash flow** mode vs the $10k planning budget — noisy for a trader, but useful for “did I overspend Groceries?”

**Not shown:** per-symbol P/L, win rate, or an equity curve — only envelope + Savings accounting.

---

## Two moments where this user might get confused

### 1. “I made $12k but Savings only shows ~$8k”
Auto-allocation moved ~20–30% of each win into Rent/Groceries/etc. **by design.**  
**Fix mindset:** Savings = **unassigned cash hub**; envelopes = **already assigned** slices.

To **keep more in Savings:** lower envelope allotments, or use **manual credits to Savings** (Workflow B) instead of Add extra income.

### 2. “I lost $3k but Monthly Spend didn’t move”
Loss was booked against **Savings**, not Groceries.  
**Watch:** Dashboard **Savings** tile and Savings-filtered transactions.

---

## Optional: cleaner month with less data entry

Instead of 4× Add extra income + 1 loss:

| When | Action |
|------|--------|
| End of Week 1 | One Add extra income: **$12,000**, payee `Trading — W1 net` |
| End of Week 2 | One Savings expense: **$3,000**, payee `Trading — W2 net` |
| Month end | **Import Income** only if backfilling history — not needed for live logging |

Same ledger outcome, fewer rows.

---

## Month-end ritual (Engaged user)

1. **Savings hero** — confirm balance vs $3k goal  
2. **Envelope sweep** (if Groceries/Car have surplus) — pull leftovers **back to Savings**  
3. **Settings → Savings** — tweak next month’s goal from “match best month” if they beat target  
4. **Achievements / recap** — if a closed period hit the goal, celebration toast may fire  

---

## Summary for this trader

| Question | Answer this month |
|----------|-------------------|
| Did I track cash flow? | Yes — wins → Savings (+ slices); losses → Savings debits; life → envelopes |
| Did Savings reflect reality? | Yes, if they log **both** wins and losses |
| Is it a trading journal? | No — it’s a **household ledger** with Savings as settlement |
| Best settings | Irregular only, planning income ~$10k/mo, carry-forward sweep, modest savings goal |

If you want a follow-up, we can walk **Workflow B** (manual credits only, no auto-slice on wins) for the same month — that’s often a better fit for traders who don’t want every green day to pre-fund Groceries.