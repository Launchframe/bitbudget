// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findMany: vi.fn(), create: vi.fn() },
    transaction: { createMany: vi.fn() },
    envelopeFundingBatch: { create: vi.fn(), delete: vi.fn() },
  },
}))
vi.mock("@/lib/btc-price", () => ({
  getBtcPriceForDate: vi.fn().mockResolvedValue(50000),
  usdToSats: vi.fn().mockReturnValue(1234),
}))

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { getBtcPriceForDate } from "@/lib/btc-price"
import { POST } from "@/app/api/import/route"

const userId = "user_1"

function postRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never
}

interface CreateManyArg {
  skipDuplicates?: boolean
  data: Array<{ source: string; dedupeKey: string | null; envelopeId: string }>
}

/** First (and only) argument passed to the mocked transaction.createMany. */
function createManyArg(): CreateManyArg {
  const arg = vi.mocked(prisma.transaction.createMany).mock.calls[0]?.[0]
  return arg as unknown as CreateManyArg
}

describe("POST /api/import", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never)
    vi.mocked(prisma.envelope.findMany).mockResolvedValue([
      { id: "env_groceries", name: "Groceries", userId },
    ] as never)
    vi.mocked(getBtcPriceForDate).mockResolvedValue(50000)
  })

  it("bulk-inserts with skipDuplicates, csv_import source, and pass-through dedupeKey", async () => {
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 2 } as never)

    const k1 = "a".repeat(32)
    const k2 = "b".repeat(32)
    const k3 = "c".repeat(32)

    const res = await POST(
      postRequest({
        transactions: [
          { date: "2026-01-01", payee: "enc1", amount: 5, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: k1 },
          { date: "2026-01-01", payee: "enc2", amount: 9, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: k2 },
          { date: "2026-01-02", payee: "enc3", amount: 3, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: k3 },
        ],
        envelopeMapping: { Groceries: "env_groceries" },
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { imported: number; skipped: number; duplicates: number }
    // 3 sent, createMany inserted 2 → 1 deduped.
    expect(json.imported).toBe(2)
    expect(json.duplicates).toBe(1)
    expect(json.skipped).toBe(0)

    const call = createManyArg()
    expect(call.skipDuplicates).toBe(true)
    expect(call.data).toHaveLength(3)
    expect(call.data[0]).toMatchObject({ source: "csv_import", dedupeKey: k1, envelopeId: "env_groceries" })
  })

  it("memoizes BTC price lookups per distinct date", async () => {
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 3 } as never)

    const d1k1 = "1".repeat(32)
    const d1k2 = "2".repeat(32)
    const d2k1 = "3".repeat(32)

    await POST(
      postRequest({
        transactions: [
          { date: "2026-01-01", payee: "a", amount: 1, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: d1k1 },
          { date: "2026-01-01", payee: "b", amount: 2, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: d1k2 },
          { date: "2026-01-02", payee: "c", amount: 3, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: d2k1 },
        ],
        envelopeMapping: { Groceries: "env_groceries" },
      }),
    )

    // 3 rows, 2 distinct dates → only 2 price lookups.
    expect(vi.mocked(getBtcPriceForDate)).toHaveBeenCalledTimes(2)
  })

  it("counts envelope-skipped rows and stores null dedupeKey when absent", async () => {
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(
      postRequest({
        transactions: [
          { date: "2026-01-01", payee: "a", amount: 1, type: "expense", envelopeName: "Groceries", notes: null },
          { date: "2026-01-01", payee: "b", amount: 2, type: "expense", envelopeName: "Ignore", notes: null },
        ],
        envelopeMapping: { Groceries: "env_groceries", Ignore: "__skip__" },
      }),
    )

    const json = (await res.json()) as { imported: number; skipped: number; duplicates: number }
    expect(json.skipped).toBe(1)
    expect(json.imported).toBe(1)

    const call = createManyArg()
    expect(call.data).toHaveLength(1)
    expect(call.data[0].dedupeKey).toBeNull()
  })

  it("returns 401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never)
    const res = await POST(postRequest({ transactions: [], envelopeMapping: {} }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when a dedupeKey is not 32 lowercase hex chars", async () => {
    const res = await POST(
      postRequest({
        transactions: [
          {
            date: "2026-01-01",
            payee: "enc1",
            amount: 5,
            type: "expense",
            envelopeName: "Groceries",
            notes: null,
            dedupeKey: "UPPERCASE_NOT_HEX",
          },
        ],
        envelopeMapping: { Groceries: "env_groceries" },
      }),
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/dedupeKey/)
  })

  it("returns importBatchId for statement_import when rows are inserted", async () => {
    vi.mocked(prisma.envelopeFundingBatch.create).mockResolvedValue({ id: "batch_1" } as never)
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 1 } as never)

    const key = "d".repeat(32)
    const res = await POST(
      postRequest({
        source: "statement_import",
        transactions: [
          {
            date: "2026-01-01",
            payee: "enc1",
            amount: 5,
            type: "expense",
            envelopeName: "Groceries",
            notes: null,
            dedupeKey: key,
            envelopeId: "env_groceries",
          },
        ],
        envelopeMapping: {},
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { imported: number; importBatchId: string | null }
    expect(json.imported).toBe(1)
    expect(json.importBatchId).toBe("batch_1")
    expect(prisma.envelopeFundingBatch.delete).not.toHaveBeenCalled()
  })

  it("deletes statement_import batch and omits importBatchId when every row dedupes", async () => {
    vi.mocked(prisma.envelopeFundingBatch.create).mockResolvedValue({ id: "batch_orphan" } as never)
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 0 } as never)

    const key = "e".repeat(32)
    const res = await POST(
      postRequest({
        source: "statement_import",
        transactions: [
          {
            date: "2026-01-01",
            payee: "enc1",
            amount: 5,
            type: "expense",
            envelopeName: "Groceries",
            notes: null,
            dedupeKey: key,
            envelopeId: "env_groceries",
          },
        ],
        envelopeMapping: {},
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { imported: number; duplicates: number; importBatchId: string | null }
    expect(json.imported).toBe(0)
    expect(json.duplicates).toBe(1)
    expect(json.importBatchId).toBeNull()
    expect(prisma.envelopeFundingBatch.delete).toHaveBeenCalledWith({
      where: { id: "batch_orphan", userId },
    })
  })

  it("inserts rows without dedupeKey when client omits it (force-import path)", async () => {
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 1 } as never)

    const res = await POST(
      postRequest({
        transactions: [
          {
            date: "2026-01-01",
            payee: "enc1",
            amount: 5,
            type: "expense",
            envelopeName: "Groceries",
            notes: null,
            envelopeId: "env_groceries",
          },
        ],
        envelopeMapping: {},
      }),
    )

    expect(res.status).toBe(200)
    const call = createManyArg()
    expect(call.data[0].dedupeKey).toBeNull()
  })
})
