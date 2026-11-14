import { describe, expect, it } from "vitest"
import {
  buildMonthOverlayChartData,
  computeSavingsConsistencyScore,
  findFirstPaydayDom,
  monthKeysInLookback,
} from "../analytics-month-overlay"
import type { Transaction } from "../data"

function txn(partial: Partial<Transaction> & Pick<Transaction, "id" | "date" | "type" | "amount" | "envelopeId">): Transaction {
  return {
    payee: "",
    notes: null,
    tags: [],
    excludeFromMainHistory: false,
    ...partial,
  }
}

const paydayUser = {
  payCadence: "monthly",
  payDays: [1],
  payDayOfWeek: null,
  lastPaydayAt: null,
}

describe("computeSavingsConsistencyScore", () => {
  it("returns null when no closed goals", () => {
    expect(computeSavingsConsistencyScore([])).toBeNull()
  })

  it("computes percentage of achieved months", () => {
    expect(
      computeSavingsConsistencyScore([
        { achievedGoal: true },
        { achievedGoal: true },
        { achievedGoal: false },
        { achievedGoal: true },
      ]),
    ).toBe(75)
  })
})

describe("findFirstPaydayDom", () => {
  it("returns earliest configured payday in month", () => {
    expect(
      findFirstPaydayDom(
        { payCadence: "bimonthly", payDays: [1, 15], payDayOfWeek: null, lastPaydayAt: null },
        2026,
        4,
      ),
    ).toBe(1)
    expect(
      findFirstPaydayDom(
        { payCadence: "bimonthly", payDays: [15, 1], payDayOfWeek: null, lastPaydayAt: null },
        2026,
        4,
      ),
    ).toBe(1)
  })

  it("defaults irregular to day 1", () => {
    expect(
      findFirstPaydayDom(
        { payCadence: "irregular", payDays: [], payDayOfWeek: null, lastPaydayAt: null },
        2026,
        4,
      ),
    ).toBe(1)
  })
})

describe("buildMonthOverlayChartData", () => {
  const discA = "env-a"
  const savingsId = "env-savings"

  it("cash flow mode decrements from budget after first payday", () => {
    const transactions = [
      txn({ id: "1", date: "2026-05-01", type: "expense", amount: 200, envelopeId: discA }),
      txn({ id: "2", date: "2026-05-10", type: "expense", amount: 300, envelopeId: discA }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions,
      monthCount: 1,
      paydayUser,
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-20T12:00:00.000Z"),
    })

    const may = data.series[0]!
    expect(may.points.find(p => p.day === 1)?.value).toBe(800)
    expect(may.points.find(p => p.day === 10)?.value).toBe(500)
    expect(may.points.find(p => p.day === 31)?.value).toBeNull()
  })

  it("savings mode tracks savings envelope balance through month", () => {
    const transactions = [
      txn({ id: "1", date: "2026-05-01", type: "credit", amount: 500, envelopeId: savingsId }),
      txn({ id: "2", date: "2026-05-05", type: "expense", amount: 100, envelopeId: savingsId }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "savings",
      transactions,
      monthCount: 1,
      paydayUser,
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-20T12:00:00.000Z"),
    })

    const may = data.series[0]!
    expect(may.points.find(p => p.day === 1)?.value).toBe(500)
    expect(may.points.find(p => p.day === 5)?.value).toBe(400)
  })

  it("partial current month stops at today dom", () => {
    const transactions = [
      txn({ id: "1", date: "2026-05-01", type: "expense", amount: 100, envelopeId: discA }),
      txn({ id: "2", date: "2026-05-25", type: "expense", amount: 900, envelopeId: discA }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions,
      monthCount: 1,
      paydayUser,
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-10T12:00:00.000Z"),
    })

    const may = data.series[0]!
    expect(may.points.find(p => p.day === 10)?.value).toBe(900)
    expect(may.points.find(p => p.day === 11)?.value).toBeNull()
  })

  it("multi-payday month starts on first payday only", () => {
    const transactions = [
      txn({ id: "1", date: "2026-05-01", type: "expense", amount: 50, envelopeId: discA }),
      txn({ id: "2", date: "2026-05-14", type: "expense", amount: 50, envelopeId: discA }),
      txn({ id: "3", date: "2026-05-15", type: "expense", amount: 200, envelopeId: discA }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions,
      monthCount: 1,
      paydayUser: {
        payCadence: "bimonthly",
        payDays: [1, 15],
        payDayOfWeek: null,
        lastPaydayAt: null,
      },
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-20T12:00:00.000Z"),
    })

    const may = data.series[0]!
    expect(may.points.find(p => p.day === 14)?.value).toBe(900)
    expect(may.points.find(p => p.day === 15)?.value).toBe(700)
  })

  it("excludes envelope_sweep expenses from cash_flow spending totals", () => {
    // Real spending: $200. Sweep: $300 (auto-reset on day 1). Only $200 should count.
    const transactions = [
      txn({ id: "real", date: "2026-05-03", type: "expense", amount: 200, envelopeId: discA }),
      txn({
        id: "sweep",
        date: "2026-05-01",
        type: "expense",
        amount: 300,
        envelopeId: discA,
        source: "envelope_sweep",
        excludeFromMainHistory: false,
      }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions,
      monthCount: 1,
      paydayUser,
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-20T12:00:00.000Z"),
    })

    const may = data.series[0]!
    // Day 1: sweep should NOT reduce budget; budget remains at $1000
    expect(may.points.find(p => p.day === 1)?.value).toBe(1000)
    // Day 3: real $200 expense reduces budget to $800
    expect(may.points.find(p => p.day === 3)?.value).toBe(800)
  })

  it("excludes envelope_transfer_out expenses from cash_flow spending totals", () => {
    // Real spending: $150. Rebalance transfer out: $400. Only $150 should count.
    const transactions = [
      txn({ id: "real", date: "2026-05-10", type: "expense", amount: 150, envelopeId: discA }),
      txn({
        id: "rebalance-out",
        date: "2026-05-05",
        type: "expense",
        amount: 400,
        envelopeId: discA,
        source: "envelope_transfer_out",
        excludeFromMainHistory: false,
      }),
    ]

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions,
      monthCount: 1,
      paydayUser,
      monthlyBudget: 1000,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-20T12:00:00.000Z"),
    })

    const may = data.series[0]!
    // Day 5: rebalance out should NOT reduce budget; budget remains at $1000
    expect(may.points.find(p => p.day === 5)?.value).toBe(1000)
    // Day 10: real $150 expense reduces budget to $850
    expect(may.points.find(p => p.day === 10)?.value).toBe(850)
  })

  it("builds chart rows keyed by month", () => {
    const keys = monthKeysInLookback(2, new Date("2026-05-15T12:00:00.000Z"))
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe("2026-05")

    const data = buildMonthOverlayChartData({
      mode: "cash_flow",
      transactions: [],
      monthCount: 2,
      paydayUser,
      monthlyBudget: 500,
      savingsEnvelopeId: savingsId,
      discretionaryEnvelopeIds: new Set([discA]),
      now: new Date("2026-05-15T12:00:00.000Z"),
    })

    expect(data.chartRows).toHaveLength(31)
    expect(data.chartRows[0]?.day).toBe(1)
    expect(Object.keys(data.chartRows[0] ?? {})).toContain(keys[0]!)
  })
})
