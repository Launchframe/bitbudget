// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const txRecurringFindFirst = vi.fn()
const txRecurringUpdateMany = vi.fn()
const txTransactionCreate = vi.fn()
// Separate mock for the outer preview read (outside $transaction)
const previewRecurringFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: vi.fn(),
      findFirst: (...args: unknown[]) => previewRecurringFindFirst(...args),
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

  it("advances month for monthly (mid-month, no overflow)", () => {
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

  it("monthly Jan 31 → Feb 28 (not Mar 3)", () => {
    const jan31 = new Date(Date.UTC(2025, 0, 31, 12, 0, 0))
    const out = advanceDate(jan31, "monthly")
    expect(out.getUTCFullYear()).toBe(2025)
    expect(out.getUTCMonth()).toBe(1) // February
    expect(out.getUTCDate()).toBe(28)
  })

  it("monthly Jan 31 → Feb 29 in a leap year", () => {
    const jan31 = new Date(Date.UTC(2024, 0, 31, 12, 0, 0))
    const out = advanceDate(jan31, "monthly")
    expect(out.getUTCFullYear()).toBe(2024)
    expect(out.getUTCMonth()).toBe(1) // February
    expect(out.getUTCDate()).toBe(29)
  })

  it("monthly March 31 → April 30 (not May 1)", () => {
    const mar31 = new Date(Date.UTC(2025, 2, 31, 12, 0, 0))
    const out = advanceDate(mar31, "monthly")
    expect(out.getUTCFullYear()).toBe(2025)
    expect(out.getUTCMonth()).toBe(3) // April
    expect(out.getUTCDate()).toBe(30)
  })

  it("monthly Dec 31 → Jan 31 (no overflow into February)", () => {
    const dec31 = new Date(Date.UTC(2025, 11, 31, 12, 0, 0))
    const out = advanceDate(dec31, "monthly")
    expect(out.getUTCFullYear()).toBe(2026)
    expect(out.getUTCMonth()).toBe(0) // January
    expect(out.getUTCDate()).toBe(31)
  })

  it("quarterly March 31 → June 30 (not July 1)", () => {
    const mar31 = new Date(Date.UTC(2025, 2, 31, 12, 0, 0))
    const out = advanceDate(mar31, "quarterly")
    expect(out.getUTCFullYear()).toBe(2025)
    expect(out.getUTCMonth()).toBe(5) // June
    expect(out.getUTCDate()).toBe(30)
  })

  it("annual Feb 29 (leap year) → Feb 28 next year (not Mar 1)", () => {
    const feb29 = new Date(Date.UTC(2024, 1, 29, 12, 0, 0))
    const out = advanceDate(feb29, "annual")
    expect(out.getUTCFullYear()).toBe(2025)
    expect(out.getUTCMonth()).toBe(1) // February
    expect(out.getUTCDate()).toBe(28)
  })

  it("annual Feb 28 → Feb 28 next year", () => {
    const feb28 = new Date(Date.UTC(2025, 1, 28, 12, 0, 0))
    const out = advanceDate(feb28, "annual")
    expect(out.getUTCFullYear()).toBe(2026)
    expect(out.getUTCMonth()).toBe(1)
    expect(out.getUTCDate()).toBe(28)
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
    previewRecurringFindFirst.mockReset()
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
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    previewRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
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
    // No rules fetched → preview findFirst never called
    expect(previewRecurringFindFirst).not.toHaveBeenCalled()
  })

  it("skips $transaction when optimistic lock loses a race and the preview sees no record on retry", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    // First attempt: preview finds record → enters $transaction → updateMany loses race → -1 returned
    // Retry: preview finds nothing (peer advanced the date) → return 0 without entering $transaction
    previewRecurringFindFirst
      .mockResolvedValueOnce({ nextDueDate: nextDue } as never)
      .mockResolvedValueOnce(null as never)
    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)
    txRecurringUpdateMany.mockResolvedValueOnce({ count: 0 } as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(0)
    // Preview short-circuits the retry → $transaction entered only once
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
    expect(txRecurringUpdateMany).toHaveBeenCalledTimes(1)
  })

  it("calls getBtcPriceForDate outside $transaction to avoid holding DB connections during HTTP", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      { ...baseRec, nextDueDate: nextDue },
    ] as never)

    const callOrder: string[] = []
    vi.mocked(getBtcPriceForDate).mockImplementation(async () => {
      callOrder.push("getBtcPrice")
      return null
    })
    vi.mocked(prisma.$transaction).mockImplementationOnce(
      async (fn: Parameters<typeof prisma.$transaction>[0]) => {
        callOrder.push("$transaction")
        return fn({
          recurringTransaction: { findFirst: txRecurringFindFirst, updateMany: txRecurringUpdateMany },
          transaction: { create: txTransactionCreate },
        } as never)
      },
    )

    previewRecurringFindFirst
      .mockImplementationOnce(async () => {
        callOrder.push("preview-findFirst")
        return { nextDueDate: nextDue }
      })
      .mockResolvedValue(null as never)
    txRecurringFindFirst
      .mockResolvedValueOnce({ ...baseRec, nextDueDate: nextDue } as never)
      .mockResolvedValue(null as never)

    await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))

    // Critical: BTC price must be fetched AFTER preview read but BEFORE the transaction starts
    expect(callOrder).toEqual(["preview-findFirst", "getBtcPrice", "$transaction"])
  })
})
