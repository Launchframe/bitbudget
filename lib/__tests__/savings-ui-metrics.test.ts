import { describe, expect, it } from "vitest"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import { avgMonthlySpendLastNMonths, goalProgressRingColor, savingsBalance, sumMonthlyIncomeCredits, sumRemainingDiscretionary } from "../savings-ui-metrics"

const savingsEnvelope: Envelope = {
  id: "sav-1",
  name: "Savings",
  monthlyAllotment: 0,
  color: "#D4AF37",
  systemRole: SYSTEM_ENVELOPE_ROLE_SAVINGS,
}

describe("savingsBalance", () => {
  it("sums all-time credits minus expenses for the Savings envelope", () => {
    const txns: Transaction[] = [
      {
        id: "1",
        date: "2026-03-15",
        payee: "Income",
        amount: 500,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
      },
      {
        id: "2",
        date: "2026-05-01",
        payee: "Sweep",
        amount: 200,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
      },
      {
        id: "3",
        date: "2026-05-10",
        payee: "Withdraw",
        amount: 50,
        type: "expense",
        envelopeId: "sav-1",
        tags: [],
      },
    ]
    expect(savingsBalance(txns, savingsEnvelope)).toBe(650)
  })
})

describe("sumMonthlyIncomeCredits", () => {
  it("includes paycheck, irregular income, and income import for the month", () => {
    const txns: Transaction[] = [
      {
        id: "1",
        date: "2026-05-01",
        payee: "Paycheck",
        amount: 2000,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "paycheck",
      },
      {
        id: "2",
        date: "2026-05-10",
        payee: "Bonus",
        amount: 500,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "irregular_income",
      },
      {
        id: "3",
        date: "2026-05-12",
        payee: "Import",
        amount: 300,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "income_import",
      },
      {
        id: "4",
        date: "2026-05-15",
        payee: "Sweep",
        amount: 100,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "envelope_sweep",
      },
      {
        id: "5",
        date: "2026-04-30",
        payee: "Old",
        amount: 999,
        type: "credit",
        envelopeId: "sav-1",
        tags: [],
        source: "paycheck",
      },
    ]
    expect(sumMonthlyIncomeCredits(txns, "2026-05")).toBe(2800)
  })
})

describe("sumRemainingDiscretionary", () => {
  const groceries: Envelope = {
    id: "food",
    name: "Groceries",
    monthlyAllotment: 400,
    color: "#22C55E",
  }

  it("sums all-time discretionary balances so prior-month carryover is included", () => {
    const txns: Transaction[] = [
      {
        id: "1",
        envelopeId: "food",
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
        envelopeId: "food",
        date: "2026-01-20",
        payee: "Store",
        amount: 250,
        type: "expense",
        tags: [],
      },
      {
        id: "3",
        envelopeId: "food",
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
        envelopeId: "food",
        date: "2026-02-10",
        payee: "Store",
        amount: 50,
        type: "expense",
        tags: [],
      },
    ]
    expect(sumRemainingDiscretionary(txns, [groceries])).toBe(500)
  })
})

describe("avgMonthlySpendLastNMonths", () => {
  it("builds month keys in UTC so local timezone does not shift buckets", () => {
    const txns: Transaction[] = [
      {
        id: "1",
        date: "2026-05-15",
        payee: "Groceries",
        amount: 300,
        type: "expense",
        envelopeId: "food",
        tags: [],
      },
    ]
    const ids = new Set(["food"])
    const realDate = Date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest Date mock
    ;(global as any).Date = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(Date.UTC(2026, 4, 23, 12, 0, 0))
        } else {
          super(...(args as ConstructorParameters<typeof realDate>))
        }
      }
      static UTC = realDate.UTC
      static now = realDate.now
      static parse = realDate.parse
    }

    try {
      expect(avgMonthlySpendLastNMonths(txns, ids, 1)).toBe(300)
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(global as any).Date = realDate
    }
  })
})

describe("goalProgressRingColor", () => {
  it("returns gray at zero progress", () => {
    expect(goalProgressRingColor(0)).toBe("#737373")
  })

  it("ramps red through yellow to green", () => {
    const low = goalProgressRingColor(0.05)
    expect(low.startsWith("#ef") || low.startsWith("#f0")).toBe(true)
    expect(goalProgressRingColor(0.5)).toBe("#eab308")
    expect(goalProgressRingColor(1)).toBe("#22c55e")
  })
})
