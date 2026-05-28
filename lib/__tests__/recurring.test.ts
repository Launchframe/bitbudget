// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

// vi.hoisted ensures these are available when vi.mock factories run (which are hoisted above imports).
// Preview-read mock: called OUTSIDE the $transaction (BTC price fetch needs the date first)
// Transaction-scoped mocks: called INSIDE the $transaction callback
const {
  outerRecurringFindFirst,
  txRecurringFindFirst,
  txRecurringUpdateMany,
  txTransactionCreate,
} = vi.hoisted(() => ({
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

vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn().mockResolvedValue(null),
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
    vi.mocked(prisma.$transaction).mockClear()
    txTransactionCreate.mockResolvedValue({ id: "txn_1" } as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 1 } as never)
  })

  it("creates one transaction and advances nextDueDate when one weekly occurrence is due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // Preview read (outside $transaction) returns the due date on the first call,
    // then null so the per-rule catchup loop terminates.
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // Transaction-scoped read: used inside $transaction for the optimistic-lock check.
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

  it("fetches BTC price for the due date (outside transaction) and passes it to the created transaction", async () => {
    const { getBtcPriceForDate, usdToSats } = await import("@/lib/btc-price")
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)
    outerRecurringFindFirst.mockResolvedValueOnce({ nextDueDate: nextDue } as never).mockResolvedValue(null as never)
    txRecurringFindFirst.mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never).mockResolvedValue(null as never)
    vi.mocked(getBtcPriceForDate).mockResolvedValue(50000 as never)
    vi.mocked(usdToSats).mockReturnValue(2000)

    await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))

    // BTC price must be fetched for the correct due-date string.
    expect(getBtcPriceForDate).toHaveBeenCalledWith("2026-04-10")
    // Sats amount from the price lookup must reach the created transaction row.
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ satsAmount: 2000 }) }),
    )
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

    // Both the initial attempt and the retry enter their own $transaction,
    // so the preview read is hit twice — once per postOneDueOccurrence call.
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)  // first attempt preview
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)  // retry preview
      .mockResolvedValue(null as never)

    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValueOnce(null as never)
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })
})
