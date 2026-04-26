// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    recurringTransaction: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
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

  beforeEach(() => {
    vi.mocked(prisma.recurringTransaction.findMany).mockReset()
    vi.mocked(prisma.recurringTransaction.update).mockReset()
    vi.mocked(prisma.transaction.create).mockReset()
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "txn_1" } as never)
    vi.mocked(prisma.recurringTransaction.update).mockResolvedValue({} as never)
  })

  it("creates one transaction and advances nextDueDate when one weekly occurrence is due", async () => {
    const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([
      {
        id: recId,
        userId,
        envelopeId: envId,
        payee: "p",
        amount: 10,
        type: "expense",
        tags: "[]",
        notes: null,
        cadence: "weekly",
        nextDueDate: nextDue,
        endDate: null,
      },
    ] as never)

    const asOf = new Date(Date.UTC(2026, 3, 15, 10, 0, 0))
    const created = await processRecurringTransactions(userId, asOf)

    expect(created).toBe(1)
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1)
    expect(prisma.recurringTransaction.update).toHaveBeenCalledWith({
      where: { id: recId },
      data: { nextDueDate: expect.any(Date) },
    })
    const updated = vi.mocked(prisma.recurringTransaction.update).mock.calls[0][0].data.nextDueDate as Date
    expect(updated.getTime()).toBe(advanceDate(nextDue, "weekly").getTime())
  })

  it("returns 0 when nothing is due", async () => {
    vi.mocked(prisma.recurringTransaction.findMany).mockResolvedValue([])
    const created = await processRecurringTransactions(userId, new Date(Date.UTC(2026, 3, 15)))
    expect(created).toBe(0)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })
})
