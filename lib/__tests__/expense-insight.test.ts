import { describe, expect, it } from "vitest"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import {
  computeExpenseInsight,
  type EnvelopePriority,
} from "../expense-insight"

// Anchor: Nov 8, 2026 (UTC). The month containing asOf (2026-11) is incomplete.
// Recent complete months (default 3): 2026-10, 2026-09, 2026-08.
// Baseline complete months (default 3): 2026-07, 2026-06, 2026-05.
const AS_OF = new Date("2026-11-08T05:00:00Z")

let nextId = 0
function expense(
  envelopeId: string,
  date: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  nextId += 1
  return {
    id: `t${nextId}`,
    date,
    payee: "Payee",
    amount,
    type: "expense",
    envelopeId,
    tags: [],
    ...overrides,
  }
}

function envelope(id: string, name: string, overrides: Partial<Envelope> = {}): Envelope {
  return {
    id,
    name,
    monthlyAllotment: 0,
    color: "#F7931A",
    ...overrides,
  }
}

const savings = envelope("sav", "Savings", { systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS })

describe("computeExpenseInsight month windows", () => {
  it("derives recent and baseline month keys from asOf (UTC, excluding current month)", () => {
    const result = computeExpenseInsight({ transactions: [], envelopes: [], asOf: AS_OF })
    expect(result.recentMonthKeys).toEqual(["2026-10", "2026-09", "2026-08"])
    expect(result.baselineMonthKeys).toEqual(["2026-07", "2026-06", "2026-05"])
  })

  it("honors custom recent/baseline month counts", () => {
    const result = computeExpenseInsight({
      transactions: [],
      envelopes: [],
      asOf: AS_OF,
      recentMonths: 2,
      baselineMonths: 1,
    })
    expect(result.recentMonthKeys).toEqual(["2026-10", "2026-09"])
    // Baseline is the month immediately before the (2-month) recent window.
    expect(result.baselineMonthKeys).toEqual(["2026-08"])
  })

  it("ignores transactions dated in the incomplete current month or outside the window", () => {
    const groceries = envelope("gro", "Groceries")
    const txns = [
      expense("gro", "2026-11-05", 999), // current incomplete month → ignored
      expense("gro", "2026-04-15", 999), // before baseline window → ignored
      expense("gro", "2026-10-10", 100), // recent
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [groceries], asOf: AS_OF })
    expect(result.totalRecentDiscretionarySpend).toBe(100)
    expect(result.envelopes).toHaveLength(1)
    expect(result.envelopes[0]!.recentTotal).toBe(100)
  })
})

describe("computeExpenseInsight averages and above-usual", () => {
  it("flags a hot envelope: recent average above the baseline average", () => {
    const dining = envelope("din", "Dining")
    const txns = [
      // Baseline: 3 months, $300 total → $100/mo avg.
      expense("din", "2026-05-10", 100),
      expense("din", "2026-06-10", 100),
      expense("din", "2026-07-10", 100),
      // Recent: 3 months, $900 total → $300/mo avg.
      expense("din", "2026-08-10", 300),
      expense("din", "2026-09-10", 300),
      expense("din", "2026-10-10", 300),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [dining], asOf: AS_OF })
    const d = result.envelopes.find((e) => e.envelopeId === "din")!
    expect(d.recentTotal).toBe(900)
    expect(d.recentMonthlyAvg).toBe(300)
    expect(d.baselineMonthlyAvg).toBe(100)
    expect(d.dollarsAboveUsual).toBe(200)
    expect(d.percentAboveUsual).toBe(200)
  })

  it("reports a cold envelope with negative above-usual and percent", () => {
    const shopping = envelope("shop", "Shopping")
    const txns = [
      // Baseline $600 total → $200/mo.
      expense("shop", "2026-05-10", 200),
      expense("shop", "2026-06-10", 200),
      expense("shop", "2026-07-10", 200),
      // Recent $150 total → $50/mo.
      expense("shop", "2026-08-10", 50),
      expense("shop", "2026-09-10", 50),
      expense("shop", "2026-10-10", 50),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [shopping], asOf: AS_OF })
    const s = result.envelopes.find((e) => e.envelopeId === "shop")!
    expect(s.dollarsAboveUsual).toBe(-150)
    expect(s.percentAboveUsual).toBe(-75)
  })

  it("returns null percentAboveUsual when the baseline average is zero (all-new spending)", () => {
    const fun = envelope("fun", "Fun Money")
    const txns = [
      // No baseline spend; only recent.
      expense("fun", "2026-08-10", 60),
      expense("fun", "2026-09-10", 60),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [fun], asOf: AS_OF })
    const f = result.envelopes.find((e) => e.envelopeId === "fun")!
    expect(f.baselineMonthlyAvg).toBe(0)
    expect(f.percentAboveUsual).toBeNull()
    expect(f.dollarsAboveUsual).toBe(40) // 120/3 months
  })

  it("includes envelopes that only had baseline spend (share 0, negative above-usual)", () => {
    const old = envelope("old", "Old Habit")
    const txns = [expense("old", "2026-05-10", 300)]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [old], asOf: AS_OF })
    const o = result.envelopes.find((e) => e.envelopeId === "old")!
    expect(o.recentTotal).toBe(0)
    expect(o.shareOfTotalSpend).toBe(0)
    expect(o.baselineMonthlyAvg).toBe(100)
    expect(o.dollarsAboveUsual).toBe(-100)
  })
})

describe("computeExpenseInsight share of total spend", () => {
  it("computes share and ranks envelopes by share of recent spend", () => {
    const a = envelope("a", "Groceries")
    const b = envelope("b", "Dining")
    const c = envelope("c", "Fun")
    const txns = [
      expense("a", "2026-10-01", 600), // 60%
      expense("b", "2026-10-01", 300), // 30%
      expense("c", "2026-10-01", 100), // 10%
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [a, b, c], asOf: AS_OF })
    expect(result.totalRecentDiscretionarySpend).toBe(1000)
    const shareById = new Map(result.envelopes.map((e) => [e.envelopeId, e.shareOfTotalSpend]))
    expect(shareById.get("a")).toBeCloseTo(0.6, 10)
    expect(shareById.get("b")).toBeCloseTo(0.3, 10)
    expect(shareById.get("c")).toBeCloseTo(0.1, 10)
    expect(result.bySpendShare.map((e) => e.envelopeId)).toEqual(["a", "b", "c"])
  })

  it("ranks byAboveUsual descending (which ran hot)", () => {
    const hot = envelope("hot", "Hot")
    const mild = envelope("mild", "Mild")
    const txns = [
      // hot: baseline 0/mo → recent 300/mo => +300
      expense("hot", "2026-08-10", 300),
      expense("hot", "2026-09-10", 300),
      expense("hot", "2026-10-10", 300),
      // mild: baseline 100/mo → recent 150/mo => +50
      expense("mild", "2026-05-10", 100),
      expense("mild", "2026-06-10", 100),
      expense("mild", "2026-07-10", 100),
      expense("mild", "2026-08-10", 150),
      expense("mild", "2026-09-10", 150),
      expense("mild", "2026-10-10", 150),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [mild, hot], asOf: AS_OF })
    expect(result.byAboveUsual.map((e) => e.envelopeId)).toEqual(["hot", "mild"])
  })
})

describe("computeExpenseInsight outlier detection", () => {
  it("flags a purchase much larger than the envelope's typical size", () => {
    const gear = envelope("gear", "Gear")
    const txns = [
      expense("gear", "2026-05-10", 20),
      expense("gear", "2026-06-10", 20),
      expense("gear", "2026-07-10", 20),
      expense("gear", "2026-08-10", 20),
      expense("gear", "2026-09-10", 20),
      expense("gear", "2026-10-10", 200, { id: "big", payee: "Big Purchase" }),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [gear], asOf: AS_OF })
    const g = result.envelopes.find((e) => e.envelopeId === "gear")!
    expect(g.outlierPurchases).toHaveLength(1)
    const outlier = g.outlierPurchases[0]!
    expect(outlier.transactionId).toBe("big")
    expect(outlier.amount).toBe(200)
    expect(outlier.typicalAmount).toBe(20) // median of the other $20 purchases
    expect(outlier.multipleOfTypical).toBe(10)
    expect(outlier.payee).toBe("Big Purchase")
  })

  it("does not flag outliers outside the recent window (baseline-only big purchase)", () => {
    const gear = envelope("gear", "Gear")
    const txns = [
      expense("gear", "2026-05-10", 200, { id: "oldbig" }), // baseline → not scanned
      expense("gear", "2026-08-10", 20),
      expense("gear", "2026-09-10", 20),
      expense("gear", "2026-10-10", 20),
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [gear], asOf: AS_OF })
    const g = result.envelopes.find((e) => e.envelopeId === "gear")!
    expect(g.outlierPurchases).toHaveLength(0)
  })

  it("respects a custom outlierMultiple", () => {
    const gear = envelope("gear", "Gear")
    const txns = [
      expense("gear", "2026-08-10", 20),
      expense("gear", "2026-09-10", 20),
      expense("gear", "2026-10-10", 50, { id: "mid" }), // 2.5× typical
    ]
    const strict = computeExpenseInsight({
      transactions: txns,
      envelopes: [gear],
      asOf: AS_OF,
      outlierMultiple: 3,
    })
    expect(strict.envelopes[0]!.outlierPurchases).toHaveLength(0)

    const loose = computeExpenseInsight({
      transactions: txns,
      envelopes: [gear],
      asOf: AS_OF,
      outlierMultiple: 2,
    })
    const loosePurchase = loose.envelopes[0]!.outlierPurchases
    expect(loosePurchase).toHaveLength(1)
    expect(loosePurchase[0]!.transactionId).toBe("mid")
  })

  it("does not flag outliers when there is only one purchase (no typical to compare)", () => {
    const gear = envelope("gear", "Gear")
    const txns = [expense("gear", "2026-10-10", 999, { id: "lonely" })]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [gear], asOf: AS_OF })
    expect(result.envelopes[0]!.outlierPurchases).toHaveLength(0)
  })
})

describe("computeExpenseInsight kept dollars by priority", () => {
  function hotEnvelopeTxns(envelopeId: string): Transaction[] {
    return [
      // baseline $100/mo
      expense(envelopeId, "2026-05-10", 100),
      expense(envelopeId, "2026-06-10", 100),
      expense(envelopeId, "2026-07-10", 100),
      // recent $300/mo → +$200 above usual
      expense(envelopeId, "2026-08-10", 300),
      expense(envelopeId, "2026-09-10", 300),
      expense(envelopeId, "2026-10-10", 300),
    ]
  }

  it("suggests kept dollars for flexible envelopes only", () => {
    const flexEnv = envelope("flex", "Flexible")
    const essEnv = envelope("ess", "Essential")
    const unsetEnv = envelope("unset", "Unset")
    const priorities: Record<string, EnvelopePriority> = {
      flex: "flexible",
      ess: "essential",
      // unset: omitted → defaults to "unset"
    }
    const txns = [
      ...hotEnvelopeTxns("flex"),
      ...hotEnvelopeTxns("ess"),
      ...hotEnvelopeTxns("unset"),
    ]
    const result = computeExpenseInsight({
      transactions: txns,
      envelopes: [flexEnv, essEnv, unsetEnv],
      priorities,
      asOf: AS_OF,
    })
    const byId = new Map(result.envelopes.map((e) => [e.envelopeId, e]))
    expect(byId.get("flex")!.priority).toBe("flexible")
    expect(byId.get("flex")!.dollarsKeptIfReturnedToUsual).toBe(200)
    expect(byId.get("ess")!.priority).toBe("essential")
    expect(byId.get("ess")!.dollarsKeptIfReturnedToUsual).toBe(0)
    expect(byId.get("unset")!.priority).toBe("unset")
    expect(byId.get("unset")!.dollarsKeptIfReturnedToUsual).toBe(0)
    // Essential/unset still report the above-usual stats.
    expect(byId.get("ess")!.dollarsAboveUsual).toBe(200)
    // Only flexible contributes to the total kept.
    expect(result.totalDollarsKeptIfFlexibleReturned).toBe(200)
  })

  it("never suggests negative kept dollars for a flexible envelope that cooled off", () => {
    const flexEnv = envelope("flex", "Flexible")
    const txns = [
      expense("flex", "2026-05-10", 300),
      expense("flex", "2026-06-10", 300),
      expense("flex", "2026-07-10", 300),
      expense("flex", "2026-10-10", 50),
    ]
    const result = computeExpenseInsight({
      transactions: txns,
      envelopes: [flexEnv],
      priorities: { flex: "flexible" },
      asOf: AS_OF,
    })
    const f = result.envelopes[0]!
    expect(f.dollarsAboveUsual).toBeLessThan(0)
    expect(f.dollarsKeptIfReturnedToUsual).toBe(0)
    expect(result.totalDollarsKeptIfFlexibleReturned).toBe(0)
  })
})

describe("computeExpenseInsight exclusions", () => {
  it("excludes the system Savings envelope", () => {
    const groceries = envelope("gro", "Groceries")
    const txns = [
      expense("gro", "2026-10-10", 100),
      expense("sav", "2026-10-10", 500), // spend attributed to Savings → excluded
    ]
    const result = computeExpenseInsight({
      transactions: txns,
      envelopes: [groceries, savings],
      asOf: AS_OF,
    })
    expect(result.envelopes.map((e) => e.envelopeId)).toEqual(["gro"])
    expect(result.totalRecentDiscretionarySpend).toBe(100)
  })

  it("excludes funding legs and other non-user-facing rows", () => {
    const groceries = envelope("gro", "Groceries")
    const txns = [
      expense("gro", "2026-10-10", 100), // counts
      expense("gro", "2026-10-11", 500, {
        source: "envelope_funding_out",
        excludeFromMainHistory: true,
      }), // funding leg → excluded
      expense("gro", "2026-10-12", 250, { excludeFromMainHistory: true }), // hidden → excluded
      expense("gro", "2026-10-13", 70, { source: "envelope_transfer_out" }), // internal transfer → excluded
      expense("gro", "2026-10-14", 80, { source: "deficit_cover" }), // deficit cover → excluded
      {
        id: "credit1",
        date: "2026-10-15",
        payee: "Paycheck",
        amount: 999,
        type: "credit" as const,
        envelopeId: "gro",
        tags: [],
      },
    ]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [groceries], asOf: AS_OF })
    expect(result.totalRecentDiscretionarySpend).toBe(100)
    expect(result.envelopes[0]!.recentTotal).toBe(100)
  })
})

describe("computeExpenseInsight empty / edge cases", () => {
  it("returns empty structures with no transactions", () => {
    const result = computeExpenseInsight({
      transactions: [],
      envelopes: [envelope("gro", "Groceries"), savings],
      asOf: AS_OF,
    })
    expect(result.envelopes).toEqual([])
    expect(result.bySpendShare).toEqual([])
    expect(result.byAboveUsual).toEqual([])
    expect(result.totalRecentDiscretionarySpend).toBe(0)
    expect(result.totalDollarsKeptIfFlexibleReturned).toBe(0)
  })

  it("omits envelopes with no spend anywhere in the window", () => {
    const active = envelope("a", "Active")
    const idle = envelope("b", "Idle")
    const txns = [expense("a", "2026-10-10", 100)]
    const result = computeExpenseInsight({ transactions: txns, envelopes: [active, idle], asOf: AS_OF })
    expect(result.envelopes.map((e) => e.envelopeId)).toEqual(["a"])
  })
})
