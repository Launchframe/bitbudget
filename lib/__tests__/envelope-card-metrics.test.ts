import { describe, expect, it } from "vitest"
import { getEnvelopeBalance, getEnvelopeBalanceAllTime } from "@/lib/data"
import { envelopeBudgetProgressPct, envelopeHealthColor } from "@/lib/envelope-card-metrics"
import type { Transaction } from "@/lib/data"

describe("envelope-card-metrics", () => {
  it("envelopeHealthColor uses green / yellow / red thresholds", () => {
    expect(envelopeHealthColor(30)).toBe("#22C55E")
    expect(envelopeHealthColor(15)).toBe("#EAB308")
    expect(envelopeHealthColor(5)).toBe("#EF4444")
  })

  it("envelopeBudgetProgressPct is uncapped for carryover surplus", () => {
    expect(envelopeBudgetProgressPct(550, 400)).toBeCloseTo(137.5)
    expect(envelopeBudgetProgressPct(0, 400)).toBe(0)
    expect(envelopeBudgetProgressPct(100, 0)).toBe(0)
  })

  it("all-time balance includes prior-month carryover that month scope omits", () => {
    const envId = "env-groceries"
    const txs: Transaction[] = [
      {
        id: "1",
        envelopeId: envId,
        date: "2026-01-15",
        payee: "Funding",
        amount: 400,
        type: "credit",
        tags: [],
        source: "envelope_funding_in",
        excludeFromMainHistory: true,
      },
      {
        id: "2",
        envelopeId: envId,
        date: "2026-01-20",
        payee: "Store",
        amount: 250,
        type: "expense",
        tags: [],
      },
      {
        id: "3",
        envelopeId: envId,
        date: "2026-02-01",
        payee: "Funding",
        amount: 400,
        type: "credit",
        tags: [],
        source: "envelope_funding_in",
        excludeFromMainHistory: true,
      },
      {
        id: "4",
        envelopeId: envId,
        date: "2026-02-10",
        payee: "Store",
        amount: 50,
        type: "expense",
        tags: [],
      },
    ]

    expect(getEnvelopeBalance(txs, envId, "2026-02")).toBe(350)
    expect(getEnvelopeBalanceAllTime(txs, envId)).toBe(500)
    expect(envelopeBudgetProgressPct(getEnvelopeBalanceAllTime(txs, envId), 400)).toBeCloseTo(125)
  })
})
