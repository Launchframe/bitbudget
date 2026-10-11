import { describe, expect, it } from "vitest"
import { buildIncomeFlowData, buildHeatmapDays } from "../analytics-page-helpers"
import type { Transaction } from "../data"
import type { Envelope } from "../data"

function txn(
  partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "type" | "amount" | "envelopeId">,
): Transaction {
  return {
    payee: "test",
    notes: null,
    tags: [],
    excludeFromMainHistory: false,
    source: "manual",
    ...partial,
  }
}

function env(id: string, name = "Groceries"): Envelope {
  return {
    id,
    name,
    monthlyAllotment: 500,
    color: "#F7931A",
    icon: null,
    archived: false,
    sweepPolicy: "reset",
    sweepCapMultiplier: 1,
    createdAt: "2026-01-01",
    systemRole: null,
    notes: null,
    tags: [],
    order: 0,
  } as Envelope
}

// ─── buildIncomeFlowData ──────────────────────────────────────────────────────

describe("buildIncomeFlowData — sweep and rebalance exclusion", () => {
  const groceriesId = "env-groceries"
  const envelopes = [env(groceriesId, "Groceries")]

  it("includes real cash income in totalIncome", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-05", type: "credit", amount: 2000, envelopeId: "savings", source: "irregular_income" }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    expect(result.totalIncome).toBe(2000)
    expect(result.totalExpenses).toBe(0)
  })

  it("includes user-facing expenses in totalExpenses and envelopeSpend", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-10", type: "expense", amount: 120, envelopeId: groceriesId, source: "manual" }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    expect(result.totalExpenses).toBe(120)
    expect(result.data.nodes.some((n) => n.name === "Groceries")).toBe(true)
  })

  /**
   * Bug (before fix): envelope_sweep expenses had excludeFromMainHistory=false
   * and type="expense", so the old `if (txn.excludeFromMainHistory) continue`
   * check let them through. A $400 sweep on the 1st of the month inflated
   * totalExpenses by $400 and wrongly credited $400 of "spending" to the envelope.
   *
   * After fix: buildIncomeFlowData uses isUserFacingExpense() which excludes
   * source=envelope_sweep (once PR #142 lands) and envelope_transfer_out.
   * This test verifies the fix for envelope_transfer_out (already in
   * isInternalLedgerTransferExpense on main).
   */
  it("excludes envelope_transfer_out from totalExpenses and Sankey spending", () => {
    const transactions = [
      // Real spend
      txn({ id: "t1", date: "2026-10-10", type: "expense", amount: 80, envelopeId: groceriesId, source: "manual" }),
      // Rebalance leg — should NOT count as spending
      txn({ id: "t2", date: "2026-10-01", type: "expense", amount: 200, envelopeId: groceriesId, source: "envelope_transfer_out" }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    // Only the real $80 spend counts; the $200 rebalance leg must be excluded
    expect(result.totalExpenses).toBe(80)
    const groceriesNode = result.data.nodes.find((n) => n.name === "Groceries")
    expect(groceriesNode).toBeDefined()
    // The Sankey link value must reflect $80, not $280
    const link = result.data.links.find((l) => l.target === result.data.nodes.indexOf(groceriesNode!))
    expect(link?.value).toBeCloseTo(80, 1)
  })

  it("excludes envelope_transfer_in from totalIncome (not a real cash inflow)", () => {
    const transactions = [
      // Real income
      txn({ id: "t1", date: "2026-10-05", type: "credit", amount: 1000, envelopeId: "savings", source: "irregular_income" }),
      // Rebalance leg — should NOT be counted as income
      txn({ id: "t2", date: "2026-10-01", type: "credit", amount: 300, envelopeId: groceriesId, source: "envelope_transfer_in" }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    // Only the $1000 real income should be counted
    expect(result.totalIncome).toBe(1000)
    expect(result.unspent).toBe(1000)
  })

  it("excludes hidden allocation legs (excludeFromMainHistory=true) from both income and expenses", () => {
    const transactions = [
      // Allocation leg — always hidden from main history
      txn({ id: "t1", date: "2026-10-01", type: "credit", amount: 500, envelopeId: groceriesId, source: "envelope_funding_in", excludeFromMainHistory: true }),
      txn({ id: "t2", date: "2026-10-01", type: "expense", amount: 500, envelopeId: "savings", source: "envelope_funding_out", excludeFromMainHistory: true }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    expect(result.totalIncome).toBe(0)
    expect(result.totalExpenses).toBe(0)
    // No Sankey links — no real flows
    expect(result.data.links).toHaveLength(0)
  })

  it("correctly computes unspent when income exceeds expenses", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-05", type: "credit", amount: 3000, envelopeId: "savings", source: "irregular_income" }),
      txn({ id: "t2", date: "2026-10-10", type: "expense", amount: 500, envelopeId: groceriesId, source: "manual" }),
    ]
    const result = buildIncomeFlowData(transactions, envelopes)
    expect(result.totalIncome).toBe(3000)
    expect(result.totalExpenses).toBe(500)
    expect(result.unspent).toBe(2500)
    expect(result.overspent).toBe(0)
  })
})

// ─── buildHeatmapDays ────────────────────────────────────────────────────────

describe("buildHeatmapDays — $ Volume excludes sweeps and rebalance legs", () => {
  it("counts all non-hidden transactions in count mode", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-05", type: "expense", amount: 50, envelopeId: "e1", source: "manual" }),
      // Sweep appears in main history (excludeFromMainHistory=false) so still counted in "count" mode
      txn({ id: "t2", date: "2026-10-05", type: "expense", amount: 300, envelopeId: "e1", source: "envelope_sweep" }),
    ]
    const days = buildHeatmapDays(transactions, "2026-10-05", "2026-10-05")
    const day = days.find((d) => d.date === "2026-10-05" && d.inRange)
    expect(day?.count).toBe(2)
  })

  /**
   * Bug (before fix): heatmap "$ Volume" mode used `txn.type === "expense"` so
   * envelope_sweep ($300) was added to `spent`. On the 1st of each month the
   * daily heatmap showed a dark square from sweep activity, not user spending.
   *
   * After fix: buildHeatmapDays uses isUserFacingExpense() so only real spending
   * contributes to `spent`.
   */
  it("excludes envelope_transfer_out from spent in $ Volume mode", () => {
    const transactions = [
      // Real spend: $50
      txn({ id: "t1", date: "2026-10-01", type: "expense", amount: 50, envelopeId: "e1", source: "manual" }),
      // Rebalance leg: $200 — must NOT inflate $Volume
      txn({ id: "t2", date: "2026-10-01", type: "expense", amount: 200, envelopeId: "e1", source: "envelope_transfer_out" }),
    ]
    const days = buildHeatmapDays(transactions, "2026-10-01", "2026-10-01")
    const day = days.find((d) => d.date === "2026-10-01" && d.inRange)
    expect(day?.spent).toBeCloseTo(50, 2)
    // Count mode still counts both (both visible in main history)
    expect(day?.count).toBe(2)
  })

  it("excludes hidden allocation legs from both count and spent", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-01", type: "credit", amount: 400, envelopeId: "e1", source: "envelope_funding_in", excludeFromMainHistory: true }),
    ]
    const days = buildHeatmapDays(transactions, "2026-10-01", "2026-10-01")
    const day = days.find((d) => d.date === "2026-10-01" && d.inRange)
    expect(day?.count).toBe(0)
    expect(day?.spent).toBe(0)
  })

  it("returns empty array for empty transaction list", () => {
    expect(buildHeatmapDays([], "2026-10-01", "2026-10-31")).toHaveLength(0)
  })

  it("marks days outside the range as inRange=false", () => {
    const transactions = [
      txn({ id: "t1", date: "2026-10-15", type: "expense", amount: 30, envelopeId: "e1" }),
    ]
    const days = buildHeatmapDays(transactions, "2026-10-15", "2026-10-15")
    const padded = days.filter((d) => !d.inRange)
    // Sunday padding before and after Oct 15 (a Thursday) creates out-of-range days
    expect(padded.length).toBeGreaterThan(0)
    padded.forEach((d) => expect(d.inRange).toBe(false))
  })
})
