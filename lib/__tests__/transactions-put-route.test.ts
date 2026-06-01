// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn(),
  usdToSats: vi.fn((usd: number, price: number) => Math.round((usd / price) * 1e8)),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    transaction: { findFirst: vi.fn(), update: vi.fn() },
    envelope: { findFirst: vi.fn() },
  },
}))

import { auth } from "@/lib/auth"
import { getBtcPriceForDate } from "@/lib/btc-price"
import { prisma } from "@/lib/db"
import { PUT } from "@/app/api/transactions/route"

describe("PUT /api/transactions satsAmount", () => {
  const userId = "user_1"
  const txnId = "txn_1"

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
      id: txnId,
      userId,
      date: new Date("2026-01-15T00:00:00.000Z"),
      payee: "enc_payee",
      amount: 100,
      type: "expense",
      envelopeId: "env_1",
      tags: "[]",
      notes: null,
      satsAmount: 150_000,
      source: "onchain_xpub",
      excludeFromMainHistory: false,
      fundingBatchId: null,
      recurringId: null,
      createdAt: new Date("2026-01-15T00:00:00.000Z"),
      updatedAt: new Date("2026-01-15T00:00:00.000Z"),
    } as never)
    vi.mocked(prisma.transaction.update).mockImplementation(async ({ data }) =>
      ({
        id: txnId,
        userId,
        date: data.date ?? new Date("2026-01-15T00:00:00.000Z"),
        payee: data.payee ?? "enc_payee",
        amount: data.amount ?? 100,
        type: data.type ?? "expense",
        envelopeId: data.envelopeId ?? "env_1",
        tags: data.tags ?? "[]",
        notes: data.notes ?? null,
        satsAmount: data.satsAmount ?? 150_000,
        source: "onchain_xpub",
        excludeFromMainHistory: false,
        fundingBatchId: null,
        recurringId: null,
        createdAt: new Date("2026-01-15T00:00:00.000Z"),
        updatedAt: new Date("2026-01-16T00:00:00.000Z"),
      }) as never,
    )
  })

  function putRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/transactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: txnId, ...body }),
    })
  }

  it("preserves satsAmount for onchain_xpub when date or amount changes", async () => {
    vi.mocked(getBtcPriceForDate).mockResolvedValue(100_000)

    const response = await PUT(putRequest({ date: "2026-02-01", amount: 200 }) as never)
    expect(response.status).toBe(200)
    expect(getBtcPriceForDate).not.toHaveBeenCalled()
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ satsAmount: 150_000 }),
      }),
    )
  })

  it("accepts an explicit satsAmount override on PUT", async () => {
    const response = await PUT(putRequest({ satsAmount: 99_000 }) as never)
    expect(response.status).toBe(200)
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ satsAmount: 99_000 }),
      }),
    )
  })
})
