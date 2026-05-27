// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

// Declare mocks with vi.hoisted so they are available when vi.mock factories run.
const {
  prismaRecurringFindFirst,
  prismaRecurringFindMany,
  txRecurringFindFirst,
  txRecurringUpdateMany,
  txTransactionCreate,
  mockGetBtcPriceForDate,
} = vi.hoisted(() => ({
  prismaRecurringFindFirst: vi.fn(),
  prismaRecurringFindMany: vi.fn(),
  txRecurringFindFirst: vi.fn(),
  txRecurringUpdateMany: vi.fn(),
  txTransactionCreate: vi.fn(),
  mockGetBtcPriceForDate: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: prismaRecurringFindMany,
      findFirst: prismaRecurringFindFirst,
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
  usdToSats: vi.fn((usd: number) => Math.round(usd * 1000)),
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
    prismaRecurringFindMany.mockReset()
    prismaRecurringFindFirst.mockReset()
    txRecurringFindFirst.mockReset()
    txRecurringUpdateMany.mockReset()
    txTransactionCreate.mockReset()
    vi.mocked(prisma.$transaction).mockClear()
    mockGetBtcPriceForDate.mockReset().mockResolvedValue(null)
    txTransactionCreate.mockResolvedValue({ id: "txn_1" } as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 1 } as never)
  })

  it("creates one transaction and advances nextDueDate when one weekly occurrence is due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    prismaRecurringFindMany.mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // Pre-check (outside transaction) returns the due row; second call returns null (end of catchup)
    prismaRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    // Inside transaction: first call confirms the row is still due; next call (catchup) finds nothing
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
    prismaRecurringFindMany.mockResolvedValue([])
    const created = await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))
    expect(created).toBe(0)
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })

  it("retries once and skips when optimistic nextDueDate update loses a race", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    prismaRecurringFindMany.mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // Pre-check: returned for first attempt, returned for second attempt (retry), then nothing
    prismaRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never) // first attempt pre-check
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never) // retry pre-check
      .mockResolvedValue(null as never)

    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never) // inside first tx
      .mockResolvedValueOnce(null as never) // inside second tx (retry) — row gone
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never) // first: optimistic lock fails

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })

  /**
   * Regression: previously getBtcPriceForDate was called inside prisma.$transaction, which could
   * hold the DB connection open during an external HTTP call and cause transaction timeouts.
   * The fix pre-fetches the price before opening the interactive transaction.
   */
  it("fetches BTC price outside the DB transaction (pre-check pattern)", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    prismaRecurringFindMany.mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    prismaRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    mockGetBtcPriceForDate.mockResolvedValue(50000)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    await processRecurringTransactions(userId, asOf)

    // BTC price must be fetched exactly once — before the transaction opens — not inside it.
    expect(getBtcPriceForDate).toHaveBeenCalledTimes(1)
    expect(getBtcPriceForDate).toHaveBeenCalledWith("2026-04-10")

    // satsAmount should be populated from the pre-fetched price
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ satsAmount: expect.any(Number) }),
      }),
    )
  })

  it("skips DB transaction entirely when pre-check finds nothing due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    prismaRecurringFindMany.mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // Pre-check: row was deactivated between findMany and the per-rule pre-check
    prismaRecurringFindFirst.mockResolvedValue(null as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    // Should not open a DB transaction at all
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(getBtcPriceForDate).not.toHaveBeenCalled()
  })
})
