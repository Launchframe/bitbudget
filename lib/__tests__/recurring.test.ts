// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const {
  outerRecurringFindFirst,
  txRecurringFindFirst,
  txRecurringUpdateMany,
  txTransactionCreate,
  mockGetBtcPriceForDate,
} = vi.hoisted(() => ({
  outerRecurringFindFirst: vi.fn(),
  txRecurringFindFirst: vi.fn(),
  txRecurringUpdateMany: vi.fn(),
  txTransactionCreate: vi.fn(),
  mockGetBtcPriceForDate: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: vi.fn(),
      // Pre-read outside $transaction introduced to avoid HTTP call inside tx.
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

    // Pre-read (outer findFirst) returns preview; second call (retry guard) returns null.
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // In-transaction findFirst returns the full rec once, then null.
    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

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

    // First attempt: outer pre-read finds the row; retry: nothing due (concurrent winner already advanced).
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // In-transaction findFirst returns the full rec on first attempt.
    txRecurringFindFirst.mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
    // updateMany returns count:0 (lost the race).
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("getBtcPriceForDate is called OUTSIDE the $transaction (no HTTP inside DB tx)", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // Track call order: btcPrice must be called before $transaction opens.
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

    await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15, 10, 0, 0)))

    // btcPrice must appear BEFORE the $transaction call in the ordered log.
    expect(callOrder.indexOf("btcPrice")).toBeLessThan(callOrder.indexOf("$transaction"))
  })
})
