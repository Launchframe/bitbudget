// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"
import { mergeEnvelopeRecords } from "@/lib/server-merge-envelope"

describe("mergeEnvelopeRecords", () => {
  const userId = "user_1"
  const fromId = "env_from"
  const toId = "env_to"

  const txEnvelopeFindFirst = vi.fn()
  const txTransactionUpdateMany = vi.fn()
  const txRecurringUpdateMany = vi.fn()
  const txPendingUpdateMany = vi.fn()
  const txShortcutUpdateMany = vi.fn()
  const txMappingUpdateMany = vi.fn()
  const txEnvelopeUpdate = vi.fn()
  const txEnvelopeDelete = vi.fn()

  const tx = {
    envelope: {
      findFirst: txEnvelopeFindFirst,
      update: txEnvelopeUpdate,
      delete: txEnvelopeDelete,
    },
    transaction: { updateMany: txTransactionUpdateMany },
    recurringTransaction: { updateMany: txRecurringUpdateMany },
    pendingTransaction: { updateMany: txPendingUpdateMany },
    transactionShortcut: { updateMany: txShortcutUpdateMany },
    payeeEnvelopeMapping: { updateMany: txMappingUpdateMany },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    txEnvelopeFindFirst.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === fromId) {
        return Promise.resolve({ id: fromId, userId, monthlyAllotment: 40 })
      }
      if (where.id === toId) {
        return Promise.resolve({ id: toId, userId, monthlyAllotment: 60 })
      }
      return Promise.resolve(null)
    })
    txTransactionUpdateMany.mockResolvedValue({ count: 2 })
    txRecurringUpdateMany.mockResolvedValue({ count: 1 })
    txPendingUpdateMany.mockResolvedValue({ count: 0 })
    txShortcutUpdateMany.mockResolvedValue({ count: 1 })
    txMappingUpdateMany.mockResolvedValue({ count: 0 })
    txEnvelopeUpdate.mockResolvedValue({})
    txEnvelopeDelete.mockResolvedValue({})
  })

  it("migrates all related records and combines allotments before deleting source", async () => {
    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txTransactionUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txRecurringUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txPendingUpdateMany).toHaveBeenCalledWith({
      where: { userId, suggestedEnvelopeId: fromId },
      data: { suggestedEnvelopeId: toId },
    })
    expect(txShortcutUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txMappingUpdateMany).toHaveBeenCalledWith({
      where: { userId, envelopeId: fromId },
      data: { envelopeId: toId },
    })
    expect(txEnvelopeUpdate).toHaveBeenCalledWith({
      where: { id: toId },
      data: { monthlyAllotment: 100 },
    })
    expect(txEnvelopeDelete).toHaveBeenCalledWith({ where: { id: fromId } })
  })

  it("is a no-op when source and target are the same envelope", async () => {
    await mergeEnvelopeRecords(tx as never, userId, fromId, fromId)

    expect(txEnvelopeFindFirst).not.toHaveBeenCalled()
    expect(txTransactionUpdateMany).not.toHaveBeenCalled()
    expect(txEnvelopeDelete).not.toHaveBeenCalled()
  })

  it("is a no-op when the source envelope does not belong to the user", async () => {
    txEnvelopeFindFirst.mockResolvedValue(null)

    await mergeEnvelopeRecords(tx as never, userId, fromId, toId)

    expect(txTransactionUpdateMany).not.toHaveBeenCalled()
    expect(txEnvelopeDelete).not.toHaveBeenCalled()
  })
})
