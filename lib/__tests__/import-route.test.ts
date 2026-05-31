// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    envelope: { findMany: vi.fn(), create: vi.fn() },
    transaction: { createMany: vi.fn() },
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

    const res = await POST(
      postRequest({
        transactions: [
          { date: "2026-01-01", payee: "enc1", amount: 5, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "key1" },
          { date: "2026-01-01", payee: "enc2", amount: 9, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "key2" },
          { date: "2026-01-02", payee: "enc3", amount: 3, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "key3" },
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
    expect(call.data[0]).toMatchObject({ source: "csv_import", dedupeKey: "key1", envelopeId: "env_groceries" })
  })

  it("memoizes BTC price lookups per distinct date", async () => {
    vi.mocked(prisma.transaction.createMany).mockResolvedValue({ count: 3 } as never)

    await POST(
      postRequest({
        transactions: [
          { date: "2026-01-01", payee: "a", amount: 1, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "k1" },
          { date: "2026-01-01", payee: "b", amount: 2, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "k2" },
          { date: "2026-01-02", payee: "c", amount: 3, type: "expense", envelopeName: "Groceries", notes: null, dedupeKey: "k3" },
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
})
