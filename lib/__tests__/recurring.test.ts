// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const { outerRecurringFindFirst, txRecurringFindFirst, txRecurringUpdateMany, txTransactionCreate } =
  vi.hoisted(() => ({
    outerRecurringFindFirst: vi.fn(),
    txRecurringFindFirst: vi.fn(),
    txRecurringUpdateMany: vi.fn(),
    txTransactionCreate: vi.fn(),
  }))

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: vi.fn(),
      findFirst: outerRecurringFindFirst,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        recurringTransaction: {
          findFirst: txRecurringFindFirst,
          updateMany: txRecurringUpdateMany,
        },
        transaction: {
          create: txTransactionCreate,
        },
      }),
    ),
  },
}))

const mockGetBtcPriceForDate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: mockGetBtcPriceForDate,
  usdToSats: vi.fn(() => 1000),
}))

import { prisma } from "@/lib/db"
import { advanceDate, processRecurringTransactions } from "@/lib/recurring"

describe("advanceDate", () => {
  it("adds 7 days for weekly", () => {
    const start = new Date(Date.UTC(2026, 3, 10, 12, 0, 0))
    const out = advanceDate(start, "weekly")
    expect(out.getUTCFullYear()).toBe(2026)
    expect(out.getUTCMonth()).toBe(3)
    expect(out.getUTCDate()).toBe(17)
  })

  it("advances month for monthly", () => {
    const start = new Date(Date.UTC(2026, 0, 15, 12, 0, 0))
    const out = advanceDate(start, "monthly")
    expect(out.getUTCFullYear()).toBe(2026)
    expect(out.getUTCMonth()).toBe(1)
    expect(out.getUTCDate()).toBe(15)
  })

  it("advances year for annual", () => {
    const start = new Date(Date.UTC(2025, 5, 1))
    const out = advanceDate(start, "annual")
    expect(out.getUTCFullYear()).toBe(2026)
    expect(out.getUTCMonth()).toBe(5)
  })
})

describe("processRecurringTransactions", () => {
  const userId = "user_1"
  const recId = "rec_1"
  const envId = "env_1"

  const baseRec = {
    id: recId,
    userId,
    envelopeId: envId,
    payee: "p",
    amount: 10,
    type: "expense",
    tags: "[]",
    notes: null,
    cadence: "weekly",
    endDate: null,
  }

  beforeEach(() => {
    vi.mocked(prisma.recurringTransaction.findMany).mockReset()
    outerRecurringFindFirst.mockReset()
    txRecurringFindFirst.mockReset()
    txRecurringUpdateMany.mockReset()
    txTransactionCreate.mockReset()
    mockGetBtcPriceForDate.mockReset()
    vi.mocked(prisma.$transaction).mockClear()
    txTransactionCreate.mockResolvedValue({ id: "txn_1" } as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockGetBtcPriceForDate.mockResolvedValue(null)
  })

  it("creates one transaction and advances nextDueDate when one weekly occurrence is due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // First outer peek: returns the rule; second peek (next catchup iteration): null → breaks loop
    outerRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
    // Inner tx re-check on the successful iteration
    txRecurringFindFirst.mockResolvedValue({ ...baseRec, nextDueDate: nextDue } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(1)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledWith({
      where: { id: recId, nextDueDate: nextDue },
      data: { nextDueDate: expect.any(Date) },
    })
    const updated = txRecurringUpdateMany.mock.calls[0][0].data.nextDueDate as Date
    expect(updated.getTime()).toBe(advanceDate(nextDue, "weekly").getTime())
  })

  it("returns 0 when nothing is due", async () => {
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([])
    const created = await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))
    expect(created).toBe(0)
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })

  it("retries once and skips when optimistic nextDueDate update loses a race", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // First outer peek: returns the rule; retry outer peek: returns null (peer already advanced it)
    outerRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
    // Inner tx re-check returns the rule; updateMany loses the race
    txRecurringFindFirst.mockResolvedValue({ ...baseRec, nextDueDate: nextDue } as never)
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })

  /**
   * Regression test: getBtcPriceForDate must be called OUTSIDE the $transaction block.
   * Calling it inside holds the DB connection during a potentially slow HTTP request,
   * which exhausts the connection pool under load.
   */
  it("calls getBtcPriceForDate before opening the DB transaction", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)
    outerRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
    txRecurringFindFirst.mockResolvedValue({ ...baseRec, nextDueDate: nextDue } as never)

    const callOrder: string[] = []
    mockGetBtcPriceForDate.mockImplementation(async () => {
      callOrder.push("btcPrice")
      return null
    })
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      callOrder.push("$transaction")
      return fn({
        recurringTransaction: {
          findFirst: txRecurringFindFirst,
          updateMany: txRecurringUpdateMany,
        },
        transaction: { create: txTransactionCreate },
      })
    })

    await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))

    // getBtcPriceForDate must be called before $transaction opens
    const btcIdx = callOrder.indexOf("btcPrice")
    const txIdx = callOrder.indexOf("$transaction")
    expect(btcIdx).toBeGreaterThanOrEqual(0)
    expect(txIdx).toBeGreaterThanOrEqual(0)
    expect(btcIdx).toBeLessThan(txIdx)
  })
})
