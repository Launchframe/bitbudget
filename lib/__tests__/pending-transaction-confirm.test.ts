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
  usdToSats: vi.fn((usd: number) => Math.round(usd * 1000)),
}))

import { confirmPendingTransactionAtomic } from "@/lib/pending-transaction-confirm"
import { getBtcPriceForDate, usdToSats } from "@/lib/btc-price"

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

function makeCreatedTx(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

describe("confirmPendingTransactionAtomic", () => {
  beforeEach(() => {
    txPendingFindFirst.mockReset()
    txPendingDeleteMany.mockReset()
    txTransactionCreate.mockReset()
    vi.mocked(getBtcPriceForDate).mockReset()
    vi.mocked(getBtcPriceForDate).mockResolvedValue(null)
    vi.mocked(usdToSats).mockReset()
    vi.mocked(usdToSats).mockImplementation((usd: number) => Math.round(usd * 1000))
  })

  it("creates a transaction when pending exists and delete wins", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx())

    const out = await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1")
    expect(out?.id).toBe("txn_1")
    expect(txTransactionCreate).toHaveBeenCalledOnce()
  })

  it("scopes the transaction to the correct userId and envelopeId", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx())

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_99")

    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user_1", envelopeId: "env_99" }),
      }),
    )
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

  it("uses payee override when provided; falls back to pending.payee when empty string", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx({ payee: "override_payee" }))

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", { payee: "override_payee" })
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payee: "override_payee" }),
      }),
    )

    txTransactionCreate.mockReset()
    txTransactionCreate.mockResolvedValue(makeCreatedTx())
    // empty string override → falls back to pending.payee
    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", { payee: "  " })
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payee: pendingRow.payee }),
      }),
    )
  })

  it("uses amount override when positive finite; falls back to Math.abs(pending.amount) otherwise", async () => {
    txPendingFindFirst.mockResolvedValue({ ...pendingRow, amount: -55 })
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx({ amount: 99 }))

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", { amount: 99 })
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 99 }) }),
    )

    txTransactionCreate.mockReset()
    txTransactionCreate.mockResolvedValue(makeCreatedTx({ amount: 55 }))
    // zero / negative override → falls back to abs(pending.amount)
    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", { amount: -1 })
    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 55 }) }),
    )
  })

  it("sets satsAmount when btcPrice override is provided", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx({ satsAmount: 42000 }))

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", { btcPrice: 50000 })

    expect(usdToSats).toHaveBeenCalledWith(42, 50000)
    // getBtcPriceForDate should NOT be called when btcPrice is pre-fetched
    expect(getBtcPriceForDate).not.toHaveBeenCalled()
  })

  it("calls getBtcPriceForDate when btcPrice is not pre-fetched", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx())

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1")

    expect(getBtcPriceForDate).toHaveBeenCalledWith("2026-05-01")
  })

  it("filters empty strings from tags override", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx({ tags: '["food"]' }))

    await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1", {
      tags: ["food", "  ", ""],
    })

    expect(txTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tags: '["food"]' }),
      }),
    )
  })

  it("returns date as YYYY-MM-DD string, not a Date object", async () => {
    txPendingFindFirst.mockResolvedValue(pendingRow)
    txPendingDeleteMany.mockResolvedValue({ count: 1 })
    txTransactionCreate.mockResolvedValue(makeCreatedTx())

    const out = await confirmPendingTransactionAtomic("user_1", "pend_1", "env_1")
    expect(typeof out?.date).toBe("string")
    expect(out?.date).toBe("2026-05-01")
  })
})
