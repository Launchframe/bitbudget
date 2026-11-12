// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const txRecurringFindFirst = vi.fn()
const txRecurringUpdateMany = vi.fn()
const txTransactionCreate = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
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

import { prisma } from "@/lib/db"
import { advanceDate, postRecurringOccurrenceEarly } from "@/lib/recurring"

describe("postRecurringOccurrenceEarly", () => {
  const userId = "user_1"
  const recId = "rec_1"
  const envId = "env_1"
  const nextDue = new Date(Date.UTC(2026, 3, 10, 0, 0, 0))
  const txnDate = new Date(Date.UTC(2026, 3, 10, 12, 0, 0))

  const baseRec = {
    id: recId,
    userId,
    envelopeId: envId,
    cadence: "weekly",
    nextDueDate: nextDue,
    endDate: null,
  }

  const baseInput = {
    userId,
    recurringId: recId,
    envelopeId: envId,
    txnDate,
    payee: "encrypted-payee",
    amount: 25,
    type: "expense",
    tags: "[]",
    notes: null,
    satsAmount: null,
  }

  beforeEach(() => {
    txRecurringFindFirst.mockReset()
    txRecurringUpdateMany.mockReset()
    txTransactionCreate.mockReset()
    vi.mocked(prisma.$transaction).mockClear()
    txTransactionCreate.mockResolvedValue({
      id: "txn_1",
      date: txnDate,
      payee: baseInput.payee,
      amount: baseInput.amount,
      type: baseInput.type,
      envelopeId: envId,
      tags: baseInput.tags,
      notes: null,
      satsAmount: null,
      recurringId: recId,
    } as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 1 } as never)
  })

  it("creates a transaction and advances nextDueDate from the locked row", async () => {
    txRecurringFindFirst.mockResolvedValue(baseRec as never)

    const result = await postRecurringOccurrenceEarly(baseInput)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.transaction.id).toBe("txn_1")
    expect(result.nextDueDate.getTime()).toBe(advanceDate(nextDue, "weekly").getTime())
    expect(txRecurringUpdateMany).toHaveBeenCalledWith({
      where: { id: recId, nextDueDate: nextDue },
      data: { nextDueDate: result.nextDueDate },
    })
  })

  it("returns concurrent when nextDueDate was advanced by cron or refresh first", async () => {
    txRecurringFindFirst.mockResolvedValue(baseRec as never)
    txRecurringUpdateMany.mockResolvedValue({ count: 0 } as never)

    const result = await postRecurringOccurrenceEarly(baseInput)

    expect(result).toEqual({ ok: false, reason: "concurrent" })
    expect(txTransactionCreate).toHaveBeenCalledTimes(1)
  })

  it("returns not_found when the rule is missing or inactive", async () => {
    txRecurringFindFirst.mockResolvedValue(null as never)

    const result = await postRecurringOccurrenceEarly(baseInput)

    expect(result).toEqual({ ok: false, reason: "not_found" })
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })
})
