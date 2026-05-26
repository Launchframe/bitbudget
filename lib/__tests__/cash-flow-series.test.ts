import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import {
  buildCumulativeCashFlowSeries,
  buildDailyCashFlowDeltas,
  isCashInflowCredit,
  isCashOutflowExpense,
} from "../cash-flow-series"

function txn(partial: Partial<Transaction> & Pick<Transaction, "date" | "amount" | "type">): Transaction {
  return {
    id: "t1",
    payee: "Test",
    envelopeId: "env-1",
    tags: [],
    ...partial,
  }
}

describe("cash-flow-series", () => {
  it("isCashInflowCredit includes income import and manual credits", () => {
    expect(isCashInflowCredit(txn({ type: "credit", source: "income_import", amount: 100, date: "2024-01-01" }))).toBe(true)
    expect(isCashInflowCredit(txn({ type: "credit", amount: 50, date: "2024-01-02" }))).toBe(true)
    expect(isCashInflowCredit(txn({ type: "credit", source: "paycheck", amount: 5000, date: "2024-01-03" }))).toBe(false)
    expect(
      isCashInflowCredit(
        txn({ type: "credit", source: "envelope_funding_in", amount: 50, date: "2024-01-02", excludeFromMainHistory: true }),
      ),
    ).toBe(false)
  })

  it("buildDailyCashFlowDeltas ignores paycheck ledger credits", () => {
    const daily = buildDailyCashFlowDeltas([
      txn({ type: "credit", source: "paycheck", amount: 5000, date: "2024-03-01" }),
      txn({ type: "expense", amount: 800, date: "2024-03-05" }),
      txn({ type: "expense", amount: 200, date: "2024-03-05" }),
    ])
    expect(daily.get("2024-03-01")).toBeUndefined()
    expect(daily.get("2024-03-05")).toBe(-1000)
  })

  it("buildDailyCashFlowDeltas nets imports against expenses", () => {
    const daily = buildDailyCashFlowDeltas([
      txn({ type: "credit", source: "income_import", amount: 3000, date: "2024-03-01" }),
      txn({ type: "expense", amount: 800, date: "2024-03-05" }),
      txn({ type: "expense", amount: 200, date: "2024-03-05" }),
    ])
    expect(daily.get("2024-03-01")).toBe(3000)
    expect(daily.get("2024-03-05")).toBe(-1000)
  })

  it("buildCumulativeCashFlowSeries accumulates expense-only imports below zero", () => {
    const series = buildCumulativeCashFlowSeries({
      transactions: [
        txn({ type: "expense", amount: 800, date: "2024-03-05" }),
        txn({ type: "expense", amount: 200, date: "2024-03-10" }),
      ],
      startDate: "2024-01-01",
    })
    expect(series).toEqual([
      { date: "2024-03-05", spent: -800, btcValue: 0 },
      { date: "2024-03-10", spent: -1000, btcValue: 0 },
    ])
  })

  it("buildCumulativeCashFlowSeries omits future-dated rows", () => {
    const series = buildCumulativeCashFlowSeries({
      transactions: [
        txn({ type: "expense", amount: 100, date: "2024-03-01" }),
        txn({ type: "expense", amount: 999, date: "2026-12-01" }),
      ],
      startDate: "2024-01-01",
      todayIso: "2024-03-31",
    })
    expect(series).toEqual([{ date: "2024-03-01", spent: -100, btcValue: 0 }])
  })

  it("isCashOutflowExpense ignores hidden funding legs", () => {
    expect(isCashOutflowExpense(txn({ type: "expense", amount: 10, date: "2024-01-01" }))).toBe(true)
    expect(
      isCashOutflowExpense(
        txn({ type: "expense", amount: 10, date: "2024-01-01", excludeFromMainHistory: true }),
      ),
    ).toBe(false)
  })
})
