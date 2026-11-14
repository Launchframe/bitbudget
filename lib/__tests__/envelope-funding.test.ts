// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { isBudgetAllocationDay } from "../budget-period"
import { allocationTopUpAmount } from "../budget-period"

describe("envelope-funding helpers", () => {
  it("isBudgetAllocationDay is true on UTC 1st", () => {
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 1, 15, 0, 0)))).toBe(true)
    expect(isBudgetAllocationDay(new Date(Date.UTC(2026, 4, 2, 0, 0, 0)))).toBe(false)
  })

  it("allocationTopUpAmount fills gap to monthly allotment", () => {
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 40 })).toBe(60)
    expect(allocationTopUpAmount({ monthlyAllotment: 100, currentMonthBalance: 100 })).toBe(0)
  })

  it("allocationTopUpAmount with negative balance returns sum of allotment + deficit", () => {
    // When month balance is -50 (e.g. from a sweep expense posted this month),
    // the gap would be 150 - (-50) = 200 — this is what the BUGGY implementation
    // was passing. After the fix we pass all-time balance instead, so this case
    // only arises for genuine mid-month overspend (covered by deficit-cover route).
    expect(allocationTopUpAmount({ monthlyAllotment: 150, currentMonthBalance: -50 })).toBe(200)
    expect(allocationTopUpAmount({ monthlyAllotment: 150, currentMonthBalance: 0 })).toBe(150)
    expect(allocationTopUpAmount({ monthlyAllotment: 150, currentMonthBalance: 150 })).toBe(0)
  })
})

// --- processMonthlyBudgetAllocations: sweep → allocation over-drain regression ---
//
// Bug: when a RESET sweep ran earlier on the same cron tick (1st of month), it
// posted an expense transaction dated today. envelopeBalancesForMonthBatch would
// then return a NEGATIVE month balance for that envelope (e.g. -$50 after a $50
// sweep). allocationTopUpAmount computed gap = allotment - (-50) = allotment + 50,
// so Savings was over-drained by the sweep amount each month.
//
// Fix: use envelopeBalancesAllTimeBatch (all-time balance including genesis floor)
// instead of month balance. After the sweep the all-time balance equals the allotment,
// so the gap is 0 and no further allocation is created.

const { allTimeBatchMock, txCreate, txFindUnique, userFindUnique, envelopeFindMany } = vi.hoisted(
  () => ({
    allTimeBatchMock: vi.fn(),
    txCreate: vi.fn(),
    txFindUnique: vi.fn(),
    userFindUnique: vi.fn(),
    envelopeFindMany: vi.fn(),
  }),
)

vi.mock("@/lib/envelope-balance-server", () => ({
  envelopeBalancesAllTimeBatch: allTimeBatchMock,
  // envelopeBalancesForMonthBatch is still exported (used elsewhere) but not called
  // from processMonthlyBudgetAllocations after the fix.
  envelopeBalancesForMonthBatch: vi.fn(),
  monthKeyFromDate: vi.fn(() => "2026-10"),
  savingsEnvelopeBalanceAllTime: vi.fn(async () => 1000),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    envelope: { findMany: envelopeFindMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      envelopeFundingBatch: {
        findUnique: txFindUnique,
        create: txCreate,
      },
      transaction: { create: vi.fn(async () => ({})) },
    })),
  },
}))

vi.mock("@/lib/ensure-system-savings-envelope", () => ({
  savingsEnvelopeForUserDb: vi.fn(async () => ({ id: "sav-1" })),
  ensureSystemSavingsEnvelope: vi.fn(async () => ({ id: "sav-1" })),
}))

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn(async () => null),
  usdToSats: vi.fn(() => 0),
}))

vi.mock("@/lib/server-encrypt", () => ({
  encryptFieldForUser: vi.fn(() => "enc-label"),
}))

import { processMonthlyBudgetAllocations } from "../envelope-funding"

describe("processMonthlyBudgetAllocations — uses all-time balance, not month balance", () => {
  const firstOfMonth = new Date(Date.UTC(2026, 9, 1, 12, 0, 0)) // 2026-10-01

  beforeEach(() => {
    vi.clearAllMocks()
    userFindUnique.mockResolvedValue({ publicKey: "pk123" })
    envelopeFindMany.mockResolvedValue([
      { id: "env-1", monthlyAllotment: 150, systemRole: null },
    ])
    txFindUnique.mockResolvedValue(null) // no duplicate batch
    txCreate.mockResolvedValue({ id: "batch-1" })
  })

  it("does not allocate when all-time balance equals the monthly allotment (post-RESET-sweep)", async () => {
    // After a RESET sweep, the all-time balance is exactly the allotment ($150).
    // The month balance would be -$50 (sweep expense posted today) but we no longer
    // use month balance. Gap = 150 - 150 = 0 → no allocation.
    allTimeBatchMock.mockResolvedValue(new Map([["env-1", 150]]))

    const legs = await processMonthlyBudgetAllocations("user-1", firstOfMonth)

    expect(legs).toBe(0)
    expect(txCreate).not.toHaveBeenCalled()
  })

  it("allocates the full allotment when all-time balance is zero (fresh envelope)", async () => {
    allTimeBatchMock.mockResolvedValue(new Map([["env-1", 0]]))

    const legs = await processMonthlyBudgetAllocations("user-1", firstOfMonth)

    // 2 legs per envelope: savings expense + envelope credit
    expect(legs).toBe(2)
    expect(txCreate).toHaveBeenCalledTimes(1) // batch created
  })

  it("allocates only the gap when all-time balance is below allotment (partial carry-forward)", async () => {
    // User has $50 carry-forward: gap = $100, allocates $100 (not the full $150)
    allTimeBatchMock.mockResolvedValue(new Map([["env-1", 50]]))

    const legs = await processMonthlyBudgetAllocations("user-1", firstOfMonth)

    expect(legs).toBe(2)
    expect(txCreate).toHaveBeenCalledTimes(1)
  })

  it("does not allocate when all-time balance exceeds the monthly allotment", async () => {
    // Envelope has $200 all-time (more than $150 allotment); gap ≤ 0 → skip
    allTimeBatchMock.mockResolvedValue(new Map([["env-1", 200]]))

    const legs = await processMonthlyBudgetAllocations("user-1", firstOfMonth)

    expect(legs).toBe(0)
    expect(txCreate).not.toHaveBeenCalled()
  })
})
