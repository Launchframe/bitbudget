import { describe, expect, it } from "vitest"
import { getEnvelopeBalance, type Transaction } from "../data"

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn",
    date: "2026-04-01",
    payee: "Payee",
    amount: 0,
    type: "expense",
    envelopeId: "env",
    tags: [],
    ...overrides,
  }
}

describe("getEnvelopeBalance", () => {
  it("uses the full monthly allotment for monthly pay cadence", () => {
    expect(
      getEnvelopeBalance(
        [txn({ amount: 125 })],
        "env",
        "2026-04",
        500,
        { payCadence: "monthly", asOf: new Date("2026-04-14T12:00:00Z") },
      ),
    ).toBe(375)
  })

  it("uses half the allotment before the second twice-monthly paycheck", () => {
    expect(
      getEnvelopeBalance(
        [txn({ amount: 100 }), txn({ id: "credit", amount: 25, type: "credit" })],
        "env",
        "2026-04",
        500,
        { payCadence: "bimonthly", asOf: new Date("2026-04-14T12:00:00Z") },
      ),
    ).toBe(175)
  })

  it("uses the full allotment on and after the second twice-monthly paycheck", () => {
    expect(
      getEnvelopeBalance(
        [txn({ amount: 100 })],
        "env",
        "2026-04",
        500,
        { payCadence: "bimonthly", asOf: new Date("2026-04-15T00:00:00Z") },
      ),
    ).toBe(400)
  })
})
