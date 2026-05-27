// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

const txPendingFindFirst = vi.fn()
const txPendingDeleteMany = vi.fn()
const txTransactionCreate = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        pendingTransaction: {
          findFirst: txPendingFindFirst,
          deleteMany: txPendingDeleteMany,
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

import { confirmPendingTransactionAtomic } from "@/lib/pending-transaction-confirm"

const pendingRow = {
  id: "pend_1",
  userId: "user_1",
  source: "plaid",
  payee: "cipher_payee",
  amount: 42,
  date: new Date("2026-05-01T12:00:00.000Z"),
  notes: null,
  suggestedEnvelopeId: "env_1",
  confidence: 0.9,
  rawInput: null,
  tags: "[]",
  createdAt: new Date(),
}

describe("confirmPendingTransactionAtomic", () => {
  beforeEach(() => {
    txPendingFindFirst.mockReset()
    txPendingDeleteMany.mockReset()
    txTransactionCreate.mockReset()
  })

  it("creates a transaction when pending exists and delete wins", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue({
      id: "txn_1",
      date: pendingRow.date,
      payee: pendingRow.payee,
      amount: 42,
      type: "expense",
      envelopeId: "env_1",
      tags: "[]",
      notes: null,
      satsAmount: null,
      recurringId: null,
    })

    const out = await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1")
    expect(out?.id).toBe("txn_1")
    expect(txTransactionCreate).toHaveBeenCalledOnce()
  })

  it("returns null when pending row is missing", async () => {
    txPendingFindFirst.mockResolvedValue(null)
    const out = await confirmPendingTransactionAtomic("user_1", "pend_missing", "env_1")
    expect(out).toBeNull()
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })

  it("returns null when another confirm deleted the row first (no duplicate txn)", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 0 })

    const out = await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1")
    expect(out).toBeNull()
    expect(txTransactionCreate).not.toHaveBeenCalled()
  })
})
