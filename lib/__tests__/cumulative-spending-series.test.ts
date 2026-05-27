import { describe, expect, it } from "vitest"
import type { Transaction } from "@/lib/data"
import { buildCumulativeSpendingSeries } from "../cumulative-spending-series"

function txn(partial: Partial<Transaction> & Pick<Transaction, "date" | "amount" | "type">): Transaction {
  return {
    id: "t1",
    payee: "Test",
    envelopeId: "env-1",
    tags: [],
    ...partial,
  }
}

describe("buildCumulativeSpendingSeries", () => {
  it("excludes funding legs and caps at today", () => {
    const series = buildCumulativeSpendingSeries({
      transactions: [
        txn({ type: "expense", amount: 100, date: "2024-03-01" }),
        txn({
          type: "expense",
          amount: 500,
          date: "2026-12-01",
          excludeFromMainHistory: true,
          source: "envelope_funding_out",
        }),
        txn({ type: "expense", amount: 50, date: "2026-12-01" }),
      ],
      startDate: "2024-01-01",
      todayIso: "2024-03-31",
    })
    expect(series).toEqual([{ date: "2024-03-01", spent: 100, btcValue: 0 }])
  })

  it("accumulates user-facing expenses through today", () => {
    const series = buildCumulativeSpendingSeries({
      transactions: [
        txn({ type: "expense", amount: 40, date: "2024-03-01" }),
        txn({ type: "expense", amount: 60, date: "2024-03-10" }),
      ],
      startDate: "2024-01-01",
      todayIso: "2024-03-31",
    })
    expect(series).toEqual([
      { date: "2024-03-01", spent: 40, btcValue: 0 },
      { date: "2024-03-10", spent: 100, btcValue: 0 },
    ])
  })
})
