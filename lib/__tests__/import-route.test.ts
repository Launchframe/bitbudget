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
      where: { id: "batch_orphan" },
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

  it("rejects malformed dedupeKey before creating envelopes", async () => {
    const res = await POST(
      postRequest({
        transactions: [
          {
            date: "2026-01-01",
            payee: "enc1",
            amount: 5,
            type: "expense",
            envelopeName: "Brand New",
            notes: null,
            dedupeKey: "d".repeat(32),
          },
          {
            date: "2026-01-02",
            payee: "enc2",
            amount: 9,
            type: "expense",
            envelopeName: "Brand New",
            notes: null,
            dedupeKey: "bad-key",
          },
        ],
        envelopeMapping: { "Brand New": "__new__" },
      }),
    )

    expect(res.status).toBe(400)
    expect(vi.mocked(prisma.envelope.findMany)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.envelope.create)).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.transaction.createMany)).not.toHaveBeenCalled()
  })

  it("treats empty-string dedupeKey as absent (stored as null, not rejected)", async () => {
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
            dedupeKey: "",
          },
        ],
        envelopeMapping: { Groceries: "env_groceries" },
      }),
    )

    expect(res.status).toBe(200)
    const call = createManyArg()
    // Empty string is normalized to null — the row is inserted without idempotency key.
    expect(call.data[0].dedupeKey).toBeNull()
  })

  describe("soft-deleted envelope protection", () => {
    const DELETED_AT = "2026-10-10T00:00:00.000Z"

    it("skips transactions whose envelope name matches a soft-deleted envelope when NEW_ENVELOPE mapping is used", async () => {
      // Setup: "Restaurants" is soft-deleted; no active "Restaurants" exists.
      vi.mocked(prisma.envelope.findMany).mockResolvedValue([
        { id: "env_del_restaurants", name: "Restaurants", userId, deletedAt: new Date(DELETED_AT) },
      ] as never)
      vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 0 } as never)

      const res = await POST(
        postRequest({
          transactions: [
            { date: "2026-01-05", payee: "enc_burger", amount: 12.5, type: "expense", envelopeName: "Restaurants", notes: null },
            { date: "2026-01-06", payee: "enc_pizza", amount: 20, type: "expense", envelopeName: "Restaurants", notes: null },
          ],
          envelopeMapping: { Restaurants: "__new__" },
        }),
      )

      expect(res.status).toBe(200)
      const json = (await res.json()) as { imported: number; skipped: number }
      // Both transactions must be skipped — NOT routed to the soft-deleted envelope.
      expect(json.skipped).toBe(2)
      expect(json.imported).toBe(0)

      // No attempt to create a new envelope (would violate the unique constraint).
      expect(vi.mocked(prisma.envelope.create)).not.toHaveBeenCalled()

      // If createMany was called at all, verify the soft-deleted envelope ID is not in any row.
      const createManyCalls = vi.mocked(prisma.transaction.createMany).mock.calls
      for (const [call] of createManyCalls) {
        const arg = call as { data: Array<{ envelopeId: string }> }
        for (const row of arg.data) {
          expect(row.envelopeId).not.toBe("env_del_restaurants")
        }
      }
    })

    it("does not silently route transactions via txn.envelopeId to a soft-deleted envelope", async () => {
      // Setup: only a soft-deleted envelope exists for the user.
      vi.mocked(prisma.envelope.findMany).mockResolvedValue([
        { id: "env_del_travel", name: "Travel", userId, deletedAt: new Date(DELETED_AT) },
      ] as never)
      vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 0 } as never)

      const res = await POST(
        postRequest({
          transactions: [
            {
              date: "2026-01-07",
              payee: "enc_flight",
              amount: 300,
              type: "expense",
              envelopeName: "Travel",
              notes: null,
              // Client attempts to bypass name resolution by providing the deleted envelope's ID directly.
              envelopeId: "env_del_travel",
            },
          ],
          // No mapping provided — relies on envelopeId bypass.
          envelopeMapping: {},
        }),
      )

      expect(res.status).toBe(200)
      const json = (await res.json()) as { imported: number; skipped: number }
      // The deleted envelope ID must NOT bypass routing.
      // The transaction should be skipped (soft-deleted name, no fallback active envelope).
      expect(json.skipped).toBe(1)
      expect(json.imported).toBe(0)

      // The deleted envelope's ID must not appear in any createMany call.
      const calls = vi.mocked(prisma.transaction.createMany).mock.calls
      for (const [call] of calls) {
        const arg = call as { data: Array<{ envelopeId: string }> }
        for (const row of arg.data) {
          expect(row.envelopeId).not.toBe("env_del_travel")
        }
      }
    })

    it("routes to an active envelope even when a soft-deleted envelope has the same name", async () => {
      // Rare edge case: soft-deleted "Old Restaurants" AND active "Restaurants" coexist.
      vi.mocked(prisma.envelope.findMany).mockResolvedValue([
        { id: "env_del_groceries", name: "Groceries", userId, deletedAt: new Date(DELETED_AT) },
        { id: "env_active_groceries2", name: "Groceries 2", userId, deletedAt: null },
      ] as never)
      vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 1 } as never)

      const res = await POST(
        postRequest({
          transactions: [
            { date: "2026-01-01", payee: "enc1", amount: 5, type: "expense", envelopeName: "Groceries 2", notes: null },
          ],
          envelopeMapping: { "Groceries 2": "env_active_groceries2" },
        }),
      )

      expect(res.status).toBe(200)
      const json = (await res.json()) as { imported: number; skipped: number }
      expect(json.imported).toBe(1)
      expect(json.skipped).toBe(0)

      const call = createManyArg()
      expect(call.data[0].envelopeId).toBe("env_active_groceries2")
    })

    it("rejects a direct envelopeMapping target that references a soft-deleted envelope ID", async () => {
      vi.mocked(prisma.envelope.findMany).mockResolvedValue([
        { id: "env_del_food", name: "Food", userId, deletedAt: new Date(DELETED_AT) },
      ] as never)

      const res = await POST(
        postRequest({
          transactions: [
            { date: "2026-01-01", payee: "enc1", amount: 5, type: "expense", envelopeName: "Food", notes: null },
          ],
          // Explicit mapping to the deleted envelope's ID — must be rejected (not in userEnvelopeIds).
          envelopeMapping: { Food: "env_del_food" },
        }),
      )

      expect(res.status).toBe(400)
      const json = (await res.json()) as { error: string }
      expect(json.error).toContain("Invalid envelope mapping")
    })
  })
})
