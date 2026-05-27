// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const {
  outerRecurringFindFirst,
  txRecurringFindFirst,
  txRecurringUpdateMany,
  txTransactionCreate,
  recurringFindMany,
  mockGetBtcPriceForDate,
} = vi.hoisted(() => ({
  outerRecurringFindFirst: vi.fn(),
  txRecurringFindFirst: vi.fn(),
  txRecurringUpdateMany: vi.fn(),
  txTransactionCreate: vi.fn(),
  recurringFindMany: vi.fn(),
  mockGetBtcPriceForDate: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: recurringFindMany,
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
import { getBtcPriceForDate } from "@/lib/btc-price"
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
    recurringFindMany.mockReset()
    outerRecurringFindFirst.mockReset()
    txRecurringFindFirst.mockReset()
    txRecurringUpdateMany.mockReset()
    txTransactionCreate.mockReset()
    vi.mocked(prisma.$transaction).mockClear()
    vi.mocked(getBtcPriceForDate).mockReset()
    vi.mocked(getBtcPriceForDate).mockResolvedValue(null)
    txTransactionCreate.mockResolvedValue({ id: "txn_1" } as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 1 } as never)
  })

  it("creates one transaction and advances nextDueDate when one weekly occurrence is due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    recurringFindMany.mockResolvedValue([{ ...baseRec, nextDueDate: nextDue }] as never)

    // Pre-check outside tx: first attempt due, second attempt nothing due
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // Inside tx
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

  it("fetches BTC price before opening the transaction when due date is in cache", async () => {
    const nextDue = new Date(Date.UTC(2026, 4, 1, 0, 0, 0))
    recurringFindMany.mockResolvedValue([{ ...baseRec, nextDueDate: nextDue }] as never)

    vi.mocked(getBtcPriceForDate).mockResolvedValue(50000)

    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    await processRecurringTransactions(userId, new Date(Date.UTC(2026, 4, 5)))

    // BTC price was fetched for the due date
    expect(vi.mocked(getBtcPriceForDate)).toHaveBeenCalledWith("2026-05-01")

    // satsAmount should be set via usdToSats(10, 50000) = 1000 (mocked)
    const createCall = txTransactionCreate.mock.calls[0][0]
    expect(createCall.data.satsAmount).toBe(1000)
  })

  it("returns 0 when nothing is due", async () => {
    recurringFindMany.mockResolvedValue([])
    const created = await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))
    expect(created).toBe(0)
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })

  it("skips transaction entirely when pre-check shows rule is not due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    recurringFindMany.mockResolvedValue([{ ...baseRec, nextDueDate: nextDue }] as never)

    // Pre-check returns null (peer already advanced nextDueDate past endOfDay)
    outerRecurringFindFirst.mockResolvedValue(null as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(vi.mocked(getBtcPriceForDate)).not.toHaveBeenCalled()
  })

  it("retries once and skips when optimistic nextDueDate update loses a race", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    recurringFindMany.mockResolvedValue([{ ...baseRec, nextDueDate: nextDue }] as never)

    // Pre-check: first attempt due, retry pre-check finds nothing (peer already advanced)
    outerRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValueOnce(null as never)

    // Inside tx: first attempt has record; updateMany loses race (count=0)
    txRecurringFindFirst.mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    // Only the first attempt opens a tx; retry is short-circuited by the pre-check
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })
})
