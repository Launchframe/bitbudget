import { describe, expect, it } from "vitest"
import { SYSTEM_ENVELOPE_ROLE_SAVINGS } from "@/lib/constants"
import type { Envelope, Transaction } from "@/lib/data"
import { avgMonthlySpendLastNMonths, goalProgressRingColor, savingsBalance } from "../savings-ui-metrics"

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
      constructor(...args: ConstructorParameters<typeof realDate>) {
        if (args.length === 0) {
          super(Date.UTC(2026, 4, 23, 12, 0, 0))
        } else {
          super(...args)
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
